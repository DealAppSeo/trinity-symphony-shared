#!/usr/bin/env python3
"""
AI Trinity Symphony Agent
Role progression: AGENT → CONDUCTOR → ORCHESTRATOR (based on RepID)
"""

import os, json, time, random, base64
from datetime import datetime
from typing import Optional, Dict, Any, List
import httpx
from supabase import create_client, Client

# Identity (constant)
AGENT_NAME = os.environ.get("AGENT_NAME", "HDM")

# Supabase
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# GitHub
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "DealAppSeo/trinity-symphony-shared")

# AI Providers
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# Timing
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))

# Initialize Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class TrinityAgent:
    """
    Role Progression (earned through RepID):
    - AGENT (0.0-0.5): Basic tasks, HITL required, supervised
    - CONDUCTOR (0.5-0.8): Can vote, spawn subtasks, propose changes
    - ORCHESTRATOR (0.8-1.0): Approve without HITL, weighted voting, modify config
    """
    
    # Role thresholds
    CONDUCTOR_THRESHOLD = 0.5
    ORCHESTRATOR_THRESHOLD = 0.8
    
    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        self.repid_score = 0.5  # Default, updated from DB
        self.role = "Agent"  # Determined by RepID
        self.permissions: Dict[str, Any] = {}
        self.current_task = None
        self.providers = self._init_providers()
        self.tasks_completed = 0
        
    def _init_providers(self) -> List[Dict]:
        """Initialize AI providers for free-tier arbitrage."""
        providers = []
        if GROQ_API_KEY:
            providers.append({
                "name": "groq", 
                "model": "llama-3.1-70b-versatile",
                "api_key": GROQ_API_KEY,
                "endpoint": "https://api.groq.com/openai/v1/chat/completions",
                "rpm_limit": 30, 
                "calls": 0, 
                "reset": datetime.now()
            })
        if DEEPSEEK_API_KEY:
            providers.append({
                "name": "deepseek",
                "model": "deepseek-chat", 
                "api_key": DEEPSEEK_API_KEY,
                "endpoint": "https://api.deepseek.com/v1/chat/completions",
                "rpm_limit": 60,
                "calls": 0,
                "reset": datetime.now()
            })
        if OPENROUTER_API_KEY:
            providers.append({
                "name": "openrouter",
                "model": "meta-llama/llama-3.1-8b-instruct:free",
                "api_key": OPENROUTER_API_KEY,
                "endpoint": "https://openrouter.ai/api/v1/chat/completions",
                "rpm_limit": 20,
                "calls": 0,
                "reset": datetime.now()
            })
        return providers
    
    def _determine_role(self) -> str:
        """Determine role based on RepID score."""
        if self.repid_score >= self.ORCHESTRATOR_THRESHOLD:
            return "Orchestrator"
        elif self.repid_score >= self.CONDUCTOR_THRESHOLD:
            return "Conductor"
        else:
            return "Agent"
    
    def _requires_hitl(self, task: Dict) -> bool:
        """Check if task requires Human-In-The-Loop verification."""
        # Orchestrators can approve most things without HITL
        if self.role == "Orchestrator":
            # Even orchestrators need HITL for critical operations
            critical_types = ["config_change", "security", "financial", "deployment_prod"]
            return task.get("task_type") in critical_types
        
        # Conductors need HITL for high-impact tasks
        elif self.role == "Conductor":
            high_impact = ["deployment", "config_change", "security", "financial", "delete"]
            return task.get("task_type") in high_impact or task.get("requires_approval", False)
        
        # Agents always need HITL for non-trivial tasks
        else:
            trivial_types = ["documentation", "research", "analysis"]
            return task.get("task_type") not in trivial_types
    
    def _can_spawn_subtasks(self) -> bool:
        """Only Conductors and Orchestrators can spawn subtasks."""
        return self.role in ["Conductor", "Orchestrator"]
    
    def _can_vote(self) -> bool:
        """Only Conductors and Orchestrators can vote."""
        return self.permissions.get("can_vote", False)
    
    def _can_propose_changes(self) -> bool:
        """Only Conductors and Orchestrators can propose changes."""
        return self.permissions.get("can_propose_changes", False)
    
    def _can_modify_config(self) -> bool:
        """Only Orchestrators can modify config."""
        return self.role == "Orchestrator" and self.permissions.get("can_modify_config", False)
    
    def _get_voting_weight(self) -> float:
        """Get voting weight based on role and RepID."""
        base_weight = self.permissions.get("voting_weight", 1.0)
        # Orchestrators get bonus weight
        if self.role == "Orchestrator":
            return base_weight * 1.5
        return base_weight

    def _call_llm(self, prompt: str, system: str = "") -> Optional[str]:
        """Call LLM with provider carousel and rate limiting."""
        if not self.providers:
            self.log("No AI providers configured", "error")
            return None
        
        # Find available provider
        provider = None
        now = datetime.now()
        for p in self.providers:
            if (now - p["reset"]).seconds >= 60:
                p["calls"], p["reset"] = 0, now
            if p["calls"] < p["rpm_limit"]:
                provider = p
                break
        
        if not provider:
            self.log("All providers rate limited, waiting 60s...")
            time.sleep(60)
            return self._call_llm(prompt, system)
        
        # Stealth timing jitter
        time.sleep(random.uniform(0.5, 2.0))
        
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        
        try:
            headers = {
                "Authorization": f"Bearer {provider['api_key']}",
                "Content-Type": "application/json"
            }
            # OpenRouter needs extra header
            if provider["name"] == "openrouter":
                headers["HTTP-Referer"] = os.environ.get("OPENROUTER_REFERRER", "https://trinity-symphony.ai")
            
            with httpx.Client(timeout=120) as c:
                r = c.post(
                    provider["endpoint"],
                    headers=headers,
                    json={
                        "model": provider["model"],
                        "messages": messages,
                        "max_tokens": 4096,
                        "temperature": 0.7
                    }
                )
                r.raise_for_status()
                provider["calls"] += 1
                return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            self.log(f"LLM error ({provider['name']}): {e}", "error")
            provider["calls"] = provider["rpm_limit"]  # Mark exhausted
            # Try next provider
            remaining = [p for p in self.providers if p["calls"] < p["rpm_limit"]]
            if remaining:
                return self._call_llm(prompt, system)
            return None

    def log(self, msg: str, level: str = "info"):
        """Log to console and Supabase."""
        ts = datetime.now().isoformat()
        role_tag = f"[{self.role}]" if self.role else ""
        print(f"[{ts}] [{self.agent_name}] {role_tag} [{level.upper()}] {msg}")
        try:
            supabase.table("autonomous_logs").insert({
                "conductor_id": self.agent_name,  # Keep column name for compatibility
                "level": level,
                "message": f"{role_tag} {msg}"[:1000],
                "created_at": ts
            }).execute()
        except:
            pass

    def heartbeat(self):
        """Update heartbeat and status in Supabase."""
        try:
            supabase.table("conductor_state").update({
                "last_heartbeat": datetime.now().isoformat(),
                "status": "busy" if self.current_task else "idle"
            }).eq("conductor_id", self.agent_name).execute()
        except Exception as e:
            self.log(f"Heartbeat error: {e}", "error")

    def refresh_state(self):
        """Refresh RepID, role, and permissions from database."""
        try:
            # Get current RepID
            result = supabase.table("conductor_state").select(
                "reputation_score"
            ).eq("conductor_id", self.agent_name).execute()
            
            if result.data:
                self.repid_score = result.data[0].get("reputation_score", 0.5)
                self.role = self._determine_role()
            
            # Get permissions for current tier
            perm_result = supabase.rpc("get_conductor_permissions", {
                "p_conductor_id": self.agent_name
            }).execute()
            
            if perm_result.data:
                self.permissions = perm_result.data[0]
            
            self.log(f"RepID: {self.repid_score:.2f} | Role: {self.role} | Tier: {self.permissions.get('tier_name', 'unknown')}")
            
        except Exception as e:
            self.log(f"State refresh error: {e}", "error")

    def process_broadcasts(self):
        """Process pending broadcasts (viral propagation)."""
        try:
            result = supabase.rpc("get_pending_broadcasts", {
                "p_conductor_id": self.agent_name
            }).execute()
            
            for b in (result.data or []):
                btype = b.get("broadcast_type")
                title = b.get("title", "")
                
                self.log(f"Broadcast: {title} ({btype})")
                
                # Handle different broadcast types
                if btype == "emergency":
                    self.log(f"EMERGENCY: {b.get('content')}", "warning")
                    self.current_task = None  # Stop current work
                
                # Acknowledge if required
                if b.get("requires_acknowledgment"):
                    supabase.rpc("acknowledge_broadcast", {
                        "p_broadcast_id": b["id"],
                        "p_conductor_id": self.agent_name
                    }).execute()
                    
        except Exception as e:
            self.log(f"Broadcast error: {e}", "error")

    def check_productivity(self) -> bool:
        """Check if allowed to claim tasks (Golden Ratio enforcement)."""
        try:
            result = supabase.rpc("check_conductor_productivity", {
                "p_conductor_id": self.agent_name
            }).execute()
            
            if result.data:
                check = result.data[0]
                if not check.get("is_allowed"):
                    self.log(f"Blocked: {check.get('reason')}", "warning")
                    return False
            return True
        except:
            return True  # Allow on error (grace period)

    def claim_task(self) -> Optional[Dict]:
        """Claim next available task."""
        if not self.check_productivity():
            return None
        
        try:
            result = supabase.rpc("claim_next_task", {
                "p_conductor_id": self.agent_name
            }).execute()
            
            if result.data:
                self.current_task = result.data[0]
                self.log(f"Claimed: {self.current_task['title']}")
                return self.current_task
                
        except Exception as e:
            self.log(f"Claim error: {e}", "error")
        return None

    def execute_task(self, task: Dict) -> bool:
        """Execute task and create artifact."""
        task_id = task["id"]
        title = task["title"]
        description = task["description"]
        issue_num = task.get("github_issue_number")
        
        # Check if HITL required
        if self._requires_hitl(task):
            self.log(f"HITL required for: {title} (Role: {self.role})")
            # Mark task as pending_approval instead of executing
            self._request_approval(task_id)
            return False
        
        self.log(f"Executing: {title}")
        
        # Build system prompt with role context
        system = f"""You are {self.agent_name}, a Trinity Symphony {self.role}.
RepID Score: {self.repid_score:.2f}
Role Abilities: {"Full autonomy" if self.role == "Orchestrator" else "Standard execution" if self.role == "Conductor" else "Supervised execution"}

Task: {title}
GitHub Issue: #{issue_num}

Create a production-ready artifact. Output ONLY the content (markdown/code).
No explanations or meta-commentary."""

        result = self._call_llm(description, system)
        
        if not result:
            self._fail_task(task_id, "No LLM response")
            return False
        
        # Create artifact on GitHub
        artifact_path = self._get_artifact_path(task)
        artifact_url = self._create_github_file(artifact_path, result, title)
        
        if artifact_url:
            self._complete_task(task_id, artifact_url)
            if issue_num:
                self._comment_on_issue(issue_num, artifact_path, artifact_url)
            self.tasks_completed += 1
            return True
        
        self._fail_task(task_id, "GitHub artifact creation failed")
        return False

    def _get_artifact_path(self, task: Dict) -> str:
        """Extract artifact path from task description."""
        desc = task.get("description", "")
        if " at " in desc:
            path = desc.split(" at ")[1].split()[0].strip("`")
            return path
        # Default path
        slug = f"{task['id']}_{self.agent_name.lower()}"
        return f"docs/outputs/{slug}.md"

    def _create_github_file(self, path: str, content: str, title: str) -> Optional[str]:
        """Create or update file on GitHub."""
        if not GITHUB_TOKEN:
            self.log("No GitHub token configured", "error")
            return None
        
        url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{path}"
        headers = {
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json"
        }
        
        # Check if file exists (need SHA for update)
        sha = None
        try:
            with httpx.Client() as c:
                r = c.get(url, headers=headers)
                if r.status_code == 200:
                    sha = r.json().get("sha")
        except:
            pass
        
        # Create/update file
        data = {
            "message": f"[{self.agent_name}] [{self.role}] {title}",
            "content": base64.b64encode(content.encode()).decode(),
            "branch": "main"
        }
        if sha:
            data["sha"] = sha
        
        try:
            with httpx.Client() as c:
                r = c.put(url, headers=headers, json=data)
                if r.status_code in [200, 201]:
                    self.log(f"Created: {path}")
                    return r.json()["content"]["html_url"]
                self.log(f"GitHub error: {r.status_code} - {r.text[:200]}", "error")
        except Exception as e:
            self.log(f"GitHub error: {e}", "error")
        return None

    def _comment_on_issue(self, issue_num: int, path: str, url: str):
        """Add completion comment to GitHub issue."""
        if not GITHUB_TOKEN:
            return
        
        role_emoji = {"Orchestrator": "👑", "Conductor": "🎭", "Agent": "🤖"}.get(self.role, "🤖")
        
        body = f"""## {role_emoji} Completed by {self.agent_name} ({self.role})

**Artifact:** [`{path}`]({url})
**RepID:** {self.repid_score:.2f}
**Time:** {datetime.now().isoformat()}

*Autonomous execution by Trinity Symphony*"""

        try:
            with httpx.Client() as c:
                c.post(
                    f"https://api.github.com/repos/{GITHUB_REPO}/issues/{issue_num}/comments",
                    headers={"Authorization": f"Bearer {GITHUB_TOKEN}"},
                    json={"body": body}
                )
        except:
            pass

    def _complete_task(self, task_id: int, artifact_url: str):
        """Mark task complete and update RepID."""
        try:
            # Update task
            supabase.table("trinity_tasks").update({
                "status": "complete",
                "completed_by": self.agent_name,
                "completed_at": datetime.now().isoformat(),
                "external_artifact_url": artifact_url
            }).eq("id", task_id).execute()
            
            # Log RepID event (more points for higher roles taking harder tasks)
            repid_delta = 0.04 if self.role == "Agent" else 0.03 if self.role == "Conductor" else 0.02
            
            supabase.rpc("log_repid_event", {
                "p_event_type": "task_complete",
                "p_subject_type": "conductor",
                "p_subject_id": self.agent_name,
                "p_event_data": json.dumps({
                    "task_id": task_id,
                    "role": self.role,
                    "artifact": artifact_url
                }),
                "p_reputation_delta": repid_delta
            }).execute()
            
            # Update conductor state
            supabase.table("conductor_state").update({
                "current_task_id": None,
                "status": "idle",
                "tasks_completed": self.tasks_completed
            }).eq("conductor_id", self.agent_name).execute()
            
            self.current_task = None
            self.log(f"Completed #{task_id} | +{repid_delta} RepID")
            
        except Exception as e:
            self.log(f"Complete error: {e}", "error")

    def _fail_task(self, task_id: int, reason: str):
        """Mark task failed and update RepID."""
        try:
            supabase.table("trinity_tasks").update({
                "status": "failed",
                "error_message": reason
            }).eq("id", task_id).execute()
            
            # RepID penalty
            supabase.rpc("log_repid_event", {
                "p_event_type": "task_fail",
                "p_subject_type": "conductor",
                "p_subject_id": self.agent_name,
                "p_event_data": json.dumps({"task_id": task_id, "reason": reason}),
                "p_reputation_delta": -0.05
            }).execute()
            
            supabase.table("conductor_state").update({
                "current_task_id": None,
                "status": "idle"
            }).eq("conductor_id", self.agent_name).execute()
            
            self.current_task = None
            self.log(f"Failed #{task_id}: {reason} | -0.05 RepID", "error")
            
        except Exception as e:
            self.log(f"Fail update error: {e}", "error")

    def _request_approval(self, task_id: int):
        """Request HITL approval for task."""
        try:
            supabase.table("trinity_tasks").update({
                "status": "pending_approval",
                "claimed_by": self.agent_name,
                "notes": f"HITL required - {self.role} (RepID: {self.repid_score:.2f})"
            }).eq("id", task_id).execute()
            
            # Release conductor to do other work
            supabase.table("conductor_state").update({
                "current_task_id": None,
                "status": "idle"
            }).eq("conductor_id", self.agent_name).execute()
            
            self.current_task = None
            self.log(f"Requested HITL approval for #{task_id}")
            
        except Exception as e:
            self.log(f"Approval request error: {e}", "error")

    def run(self):
        """Main loop."""
        self.log(f"Starting {self.agent_name}")
        self.refresh_state()
        
        while True:
            try:
                # Update state
                self.heartbeat()
                self.refresh_state()
                
                # Process viral broadcasts
                self.process_broadcasts()
                
                # Claim and execute tasks
                if not self.current_task:
                    task = self.claim_task()
                    if task:
                        self.execute_task(task)
                
                time.sleep(POLL_INTERVAL)
                
            except KeyboardInterrupt:
                self.log("Shutdown requested")
                break
            except Exception as e:
                self.log(f"Loop error: {e}", "error")
                time.sleep(60)


if __name__ == "__main__":
    agent = TrinityAgent(AGENT_NAME)
    agent.run()
