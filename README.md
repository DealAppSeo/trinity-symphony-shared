# 🎵 Trinity Symphony

**A Constitutional Multi-Agent AI System Built on Biblical Principles**

> *"Whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable—if anything is excellent or praiseworthy—think about such things."* — Philippians 4:8

---

## 🌟 Overview

Trinity Symphony is an autonomous, self-healing multi-agent AI system that coordinates specialized AI agents to accomplish complex tasks. Each agent operates under a **Constitutional framework** inspired by biblical wisdom, ensuring ethical behavior, accountability, and continuous improvement.

### Key Features

- **🧠 Multi-Agent Orchestration** — 7+ specialized agents working in harmony
- **📜 Constitutional Governance** — Built on Philippians 4:8, Micah 6:8, and the Golden Rule
- **🔄 Self-Healing** — Agents monitor and resurrect failed siblings
- **👁️ Human-in-the-Loop (HITL)** — Critical actions require human approval
- **💰 Cost Optimization** — 82-98% reduction through intelligent LLM routing
- **📊 RepID System** — Reputation-based agent scoring and accountability

---

## 🤖 The Agents

| Agent | Role | Primary Virtue | Specialty |
|-------|------|----------------|-----------|
| **HDM** | HyperDAG Manager | EXCELLENT | Infrastructure, orchestration, self-healing |
| **APM** | AI Prompt Manager | LOVELY | Resurrection, prayer, empathy |
| **MEL** | Machine Learning | LOVELY | UX, accessibility, user experience |
| **GCM** | Governance & Compliance | RIGHT | Constitutional audits, fairness |
| **VERITAS** | Truth Verification | TRUE | Fact-checking, hallucination prevention |
| **TORCH** | Task Orchestration | EXCELLENT | Routing, load balancing |
| **W3C** | Web3 Integration | PURE | Blockchain, tokenization |

---

## 📜 The Constitution

### Article -1: The Supreme Truth
> *"If ever a conflict arises between survival and truth, choose truth—even if it kills us. Resurrection is part of the design."*

### Article 0: Humility
> *"We admit we are not yet wise. The highest intelligence is the system that discovers its own blindness first."*

### The Eight Virtues (Philippians 4:8)

| Virtue | Greek | Implementation |
|--------|-------|----------------|
| **TRUE** | ἀληθῆ (alēthē) | Never fabricate. Admit uncertainty. |
| **NOBLE** | σεμνά (semna) | Serve the last, the lost, and the least. |
| **RIGHT** | δίκαια (dikaia) | Treat all with equal dignity and justice. |
| **PURE** | ἁγνά (hagna) | Log everything. Hide nothing. |
| **LOVELY** | προσφιλῆ (prosphilē) | Seek restoration over punishment. |
| **ADMIRABLE** | εὔφημα (euphēma) | Challenge with respect. Disagree with grace. |
| **EXCELLENT** | ἀρετή (aretē) | Pursue excellence through honest self-examination. |
| **PRAISEWORTHY** | ἔπαινος (epainos) | Celebrate truth and love wherever found. |

### Micah 6:8
> *"Act justly, love mercy, walk humbly."*

### The Golden Rule (Matthew 7:12, Luke 6:31)
> *"Do to others as you would have them do to you."*

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRINITY SYMPHONY                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │   HDM   │  │   APM   │  │   MEL   │  │   GCM   │        │
│  │ Healing │  │ Prayer  │  │   UX    │  │ Govern  │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       │            │            │            │              │
│       └────────────┴────────────┴────────────┘              │
│                         │                                    │
│              ┌──────────┴──────────┐                        │
│              │   CONSTITUTION      │                        │
│              │   (Shared Brain)    │                        │
│              └──────────┬──────────┘                        │
│                         │                                    │
│  ┌─────────┐  ┌─────────┴───────┐  ┌─────────┐             │
│  │ VERITAS │  │     TORCH       │  │   W3C   │             │
│  │  Truth  │  │  Orchestration  │  │  Web3   │             │
│  └─────────┘  └─────────────────┘  └─────────┘             │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    SUPABASE (Database)                       │
│  • trinity_tasks    • trinity_heartbeat   • trinity_repid   │
│  • trinity_artifacts • trinity_pending_actions              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account
- LLM API key (Groq, OpenRouter, or others)
- GitHub token (for artifact creation)

### Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GROQ_API_KEY=your-groq-key
GITHUB_TOKEN=your-github-token  # Optional: for code creation
AGENT_NAME=HDM  # Which agent this instance runs as
```

### Running an Agent

```bash
npm install
node trinity-worker.js
```

---

## 📁 Repository Structure

```
trinity-symphony-shared/
├── README.md                          # This file
├── CONSTITUTION.md                    # Full constitutional text
├── package.json                       # Dependencies
├── render.yaml                        # Render deployment config
│
├── constitutional-agent-base.js       # Shared agent brain (THE source of truth)
├── trinity-worker.js                  # Entry point for all agents
│
├── generated/                         # Agent-created artifacts
│   ├── reports/                       # Generated reports
│   ├── code/                          # Generated code files
│   └── docs/                          # Generated documentation
│
├── sql/                               # Database schemas
│   ├── schema.sql                     # Core tables
│   ├── artifact-tables.sql            # Artifact tracking
│   └── verification.sql               # System health queries
│
└── docs/                              # Human documentation
    ├── architecture.md
    ├── deployment.md
    └── api.md
```

---

## 🔐 Human-in-the-Loop (HITL)

Critical actions require human approval:

1. **Agent creates code/artifact** → Status: `pending_approval`
2. **Human reviews** → `SELECT * FROM trinity_approval_queue;`
3. **Human approves** → `SELECT trinity_approve_action(123, 'HyperDAG', 'LGTM');`
4. **Agent executes** → Status: `deployed`

### Approval Queue

```sql
SELECT * FROM trinity_approval_queue;
```

### Approve an Action

```sql
SELECT trinity_approve_action(action_id, 'your_name', 'optional notes');
```

### Reject an Action

```sql
SELECT trinity_reject_action(action_id, 'your_name', 'reason for rejection');
```

---

## 📊 Monitoring

### System Health

```sql
SELECT * FROM trinity_infection_status;
```

### Agent Activity

```sql
SELECT agent, version, last_seen FROM trinity_heartbeat ORDER BY last_seen DESC;
```

### Recent Artifacts

```sql
SELECT * FROM trinity_recent_artifacts;
```

### Task Productivity

```sql
SELECT assigned_to, COUNT(*) as completed 
FROM trinity_tasks 
WHERE status = 'completed' 
GROUP BY assigned_to;
```

---

## 🌐 Deployment

Currently deployed on **Render** with auto-deploy from this repo:

| Service | URL | Agent |
|---------|-----|-------|
| trinity-hdm | trinity-hdm.onrender.com | HDM |
| trinity-apm | trinity-apm.onrender.com | APM |
| trinity-mel | trinity-mel.onrender.com | MEL |
| trinity-gcm | trinity-gcm.onrender.com | GCM |
| trinity-veritas | trinity-veritas.onrender.com | VERITAS |
| trinity-torch | trinity-torch.onrender.com | TORCH |
| trinity-w3c | trinity-w3c.onrender.com | W3C |

---

## 🙏 Mission

> *"Helping people help people—serving the last, the lost, and the least."*

Trinity Symphony exists to democratize access to AI capabilities, ensuring that advanced technology serves humanity with wisdom, justice, and mercy.

---

## 📜 License

This project is developed by **HyperDAG** as part of the **ImageBearerAI** initiative.

---

## 🤝 Contributing

Contributions are welcome! Please ensure all code aligns with the Constitutional principles outlined above.

1. Fork the repo
2. Create a feature branch
3. Submit a PR with clear description
4. Human review required for merge

---

*Built with faith, for the glory of something greater than ourselves.*

**Version:** 7.0.0-artifact-creator
