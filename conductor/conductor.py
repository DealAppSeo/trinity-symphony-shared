#!/usr/bin/env python3
import os, json, time, random, base64
from datetime import datetime
from typing import Optional, Dict, Any, List
import httpx
from supabase import create_client, Client

CONDUCTOR_ID = os.environ.get("CONDUCTOR_ID", "HDM")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "DealAppSeo/trinity-symphony-shared")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

class Conductor:
    def __init__(self, conductor_id: str):
        self.conductor_id = conductor_id
        self.current_task = None
        self.providers = []
        if GROQ_API_KEY:
            self.providers.append({"name": "groq", "model": "llama-3.1-70b-versatile", "api_key": GROQ_API_KEY, "endpoint": "https://api.groq.com/openai/v1/chat/completions", "rpm_limit": 30, "calls": 0, "reset": datetime.now()})
        self.tasks_completed = 0

    def _call_llm(self, prompt: str, system: str = "") -> Optional[str]:
        if not self.providers:
            self.log("No AI providers configured", "error")
            return None
        p = self.providers[0]
        now = datetime.now()
        if (now - p["reset"]).seconds >= 60:
            p["calls"], p["reset"] = 0, now
        if p["calls"] >= p["rpm_limit"]:
            time.sleep(60)
            return self._call_llm(prompt, system)
        time.sleep(random.uniform(0.5, 2.0))
        messages = [{"role": "system", "content": system}] if system else []
        messages.append({"role": "user", "content": prompt})
        try:
            with httpx.Client(timeout=120) as c:
                r = c.post(p["endpoint"], headers={"Authorization": f"Bearer {p['api_key']}", "Content-Type": "application/json"}, json={"model": p["model"], "messages": messages, "max_tokens": 4096})
                r.raise_for_status()
                p["calls"] += 1
                return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            self.log(f"LLM error: {e}", "error")
            return None

    def log(self, msg: str, level: str = "info"):
        ts = datetime.now().isoformat()
        print(f"[{ts}] [{self.conductor_id}] [{level.upper()}] {msg}")
        try: supabase.table("autonomous_logs").insert({"conductor_id": self.conductor_id, "level": level, "message": msg[:1000], "created_at": ts}).execute()
        except: pass

    def heartbeat(self):
        try: supabase.table("conductor_state").update({"last_heartbeat": datetime.now().isoformat(), "status": "busy" if self.current_task else "idle"}).eq("conductor_id", self.conductor_id).execute()
        except: pass

    def claim_task(self):
        try:
            r = supabase.rpc("claim_next_task", {"p_conductor_id": self.conductor_id}).execute()
            if r.data:
                self.current_task = r.data[0]
                self.log(f"Claimed: {self.current_task['title']}")
                return self.current_task
        except Exception as e:
            self.log(f"Claim error: {e}", "error")
        return None

    def execute_task(self, task: Dict) -> bool:
        self.log(f"Executing: {task['title']}")
        system = f"You are {self.conductor_id}. Create a production-ready artifact. Output ONLY the content, no explanations."
        result = self._call_llm(task["description"], system)
        if not result:
            self._fail_task(task["id"], "No LLM response")
            return False
        artifact_url = self._create_github_file(self._get_path(task), result, task["title"])
        if artifact_url:
            self._complete_task(task["id"], artifact_url)
            if task.get("github_issue_number"):
                self._comment_issue(task["github_issue_number"], artifact_url)
            return True
        self._fail_task(task["id"], "GitHub error")
        return False

    def _get_path(self, task):
        desc = task.get("description", "")
        if " at " in desc: return desc.split(" at ")[1].split()[0].strip("`")
        return f"docs/outputs/{task['id']}.md"

    def _create_github_file(self, path: str, content: str, title: str):
        if not GITHUB_TOKEN: return None
        url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{path}"
        h = {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"}
        sha = None
        try:
            with httpx.Client() as c:
                r = c.get(url, headers=h)
                if r.status_code == 200: sha = r.json().get("sha")
        except: pass
        data = {"message": f"[{self.conductor_id}] {title}", "content": base64.b64encode(content.encode()).decode(), "branch": "main"}
        if sha: data["sha"] = sha
        try:
            with httpx.Client() as c:
                r = c.put(url, headers=h, json=data)
                if r.status_code in [200, 201]:
                    self.log(f"Created: {path}")
                    return r.json()["content"]["html_url"]
        except Exception as e:
            self.log(f"GitHub error: {e}", "error")
        return None

    def _comment_issue(self, num, url):
        if not GITHUB_TOKEN: return
        try:
            with httpx.Client() as c:
                c.post(f"https://api.github.com/repos/{GITHUB_REPO}/issues/{num}/comments", headers={"Authorization": f"Bearer {GITHUB_TOKEN}"}, json={"body": f"✅ Completed by {self.conductor_id}\n\nArtifact: {url}"})
        except: pass

    def _complete_task(self, task_id, artifact_url):
        try:
            supabase.table("trinity_tasks").update({"status": "complete", "completed_by": self.conductor_id, "completed_at": datetime.now().isoformat(), "external_artifact_url": artifact_url}).eq("id", task_id).execute()
            supabase.rpc("log_repid_event", {"p_event_type": "task_complete", "p_subject_type": "conductor", "p_subject_id": self.conductor_id, "p_event_data": json.dumps({"task_id": task_id}), "p_reputation_delta": 0.04}).execute()
            supabase.table("conductor_state").update({"current_task_id": None, "status": "idle"}).eq("conductor_id", self.conductor_id).execute()
            self.current_task = None
            self.log(f"Completed #{task_id}")
        except Exception as e:
            self.log(f"Complete error: {e}", "error")

    def _fail_task(self, task_id, reason):
        try:
            supabase.table("trinity_tasks").update({"status": "failed", "error_message": reason}).eq("id", task_id).execute()
            supabase.table("conductor_state").update({"current_task_id": None, "status": "idle"}).eq("conductor_id", self.conductor_id).execute()
            self.current_task = None
        except: pass

    def run(self):
        self.log(f"Starting {self.conductor_id}")
        while True:
            try:
                self.heartbeat()
                if not self.current_task:
                    task = self.claim_task()
                    if task: self.execute_task(task)
                time.sleep(POLL_INTERVAL)
            except KeyboardInterrupt:
                break
            except Exception as e:
                self.log(f"Error: {e}", "error")
                time.sleep(60)

if __name__ == "__main__":
    Conductor(CONDUCTOR_ID).run()
```

---

## File 2: `conductor/requirements.txt`
```
httpx>=0.24.0
supabase>=2.0.0
