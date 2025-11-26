# TRINITY_TRUTH.md — Single Source of Truth (v0.2)

## Schema
* tasks: id (uuid), title (text), priority (float 0-1), status (text), assigned_manager (text), unity_score (float), created_at (timestamp)
* managers: id (uuid), name (text unique), style (text)
* audits: id (uuid), route_log (jsonb), redemptive_score (float), created_at (timestamp)
* user_keys: id (uuid), user_id (uuid), grok_key_enc (text), claude_key_enc (text), chatgpt_key_enc (text), trinity_api_key (uuid)
* hyperdag_nodes: id (uuid), label (text), chaos_level (float), connectedTo (array), created_at (timestamp)

## Forget-Me-Not Checklist
[x] 1. Tables: tasks=1+, managers=4 ✅ (2025-11-26)
[ ] 2. RLS: Anon access
[ ] 3. Realtime: Instant updates
[ ] 4. GitHub: mvp-controller branch
[ ] 5. BYOK: /onboard QR
[ ] 6. Voice: Demo mode confetti
[ ] 7. ANFIS: Routes + logs
[ ] 8. No Polling: Realtime only
[ ] 9. PWA: Installable
[ ] 10. Guardrails: Scripture filter
[ ] 11. Tests: 100% pass
[ ] 12. HyperDAG: /hyperdag live

## 🔄 Handoff Log (Newest First)
=== 2025-11-26 → GROK → Activate n8n-automation-workflow.json from repo
=== 2025-11-26 → CLAUDE → Enable Realtime on tasks + managers tables (#3)

## Progress
- 2025-11-26: Tables created, managers seeded (HDM, APM, MEL, GCM)
- 2025-11-08: Initial schema defined

Updated: Nov 26, 2025. No drift.
