<div align="center">
  <h1>trinity-symphony-shared</h1>
  <p><strong>Part of the HyperDAG Ecosystem</strong></p>
  <p>
    <img src="https://img.shields.io/badge/status-active-success.svg" alt="Status" />
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" />
  </p>
</div>

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Core](https://img.shields.io/badge/Logic-Constitutional-orange)](https://aitrinitysymphony.com)

**The code for the Trinity Symphony agents.**

Each agent runs `node server.js`. That creates one `ConstitutionalAgentV4`, from
`lib/ConstitutionalAgentV4.js`, named by `AGENT_NAME`. The class extends nothing. Every agent runs
the same class; the name picks its squad and role.

**Read the "Live today vs designed" table below before relying on anything here.** An earlier version of
this README described three components — an ANFIS bid resolver, an Evolutionary Logger and a Pruning
Engine — that do not exist in this repository, alongside a fuzzy-membership code sample that was never
lifted from any file here. Those claims have been removed rather than softened.

Two more were removed on 2026-10-07, because the code contradicts them:

- It said every agent extends a shared base, `constitutional-agent-base.js`. None does. See "What runs".
- It showed a "BFT 3x3+3" diagram with executor, verifier and ANFIS layers. Those layers are not in
  this code, so the diagram is gone. No new picture replaces it; "Where this sits" lists the real edges.

---

## What runs

| File | What it is |
|---|---|
| `server.js` | The entry point. `npm start` runs it. It creates one agent. |
| `lib/ConstitutionalAgentV4.js` | The agent class: claim loop, LLM calls, tool-call loop, a `/health` endpoint. It extends nothing. |
| `lib/swarm-toolbelt.js` | The tools an agent can call: `http_get`, `read_engine_stats`, `report_unmeasurable`. Off unless `SWARM_TOOLBELT=on`. |
| `lib/emergency-halt.js` | The L0 global halt. Both run loops check it before doing work. |
| `constitutional-agent-base.js` | An older agent class. It cannot load from this tree: it requires `./utils/merkle`, which does not exist. Its only launcher, `trinity-worker.js`, also requires a missing file, `./routes/analyze`. So no agent built from this tree runs it. |

**Why the toolbelt matters more than it looks.** Before it existed the agents had exactly one tool —
`save_artifact` — so an agent asked to *measure* something had no instrument and one affordance: write
prose. 18 of 18 nightly smoke reports contained zero real measurements. That was fabrication by
construction, not by disposition. `report_unmeasurable` is the tool that lets an agent decline.

---

## Live today vs designed

| Live today | How to check |
|---|---|
| 12 agents, one class | `server.js` creates a `ConstitutionalAgentV4`; the roster is under "Squads" |
| Tool-call loop with a real toolbelt | `lib/swarm-toolbelt.js`, off unless `SWARM_TOOLBELT=on`; proven 2026-08-05 — three probes returned live engine values matching independently-captured ground truth, and a fourth **declined to answer** a question no tool could reach |
| `report_unmeasurable` — an agent can refuse | same file; this is what makes the refusal above possible |
| L0 global emergency halt | filesystem-scanning coverage test fails when a new tick loop is added ungated |
| Tool calls written to `tool_call_log`, which a database trigger hash-chains | `lib/tool-call-logger.js`; off unless `TOOL_CALL_LOGGING=true` |
| Tests | `tests/` holds plain `node` scripts; `.github/workflows/ci.yml` lists the ones CI runs |

| Designed or partial — **not** live here | Actual state |
|---|---|
| ANFIS fuzzy inference / bid resolution | name only; the one ANFIS call fails every time (see below) |
| Self-healing provider demotion | not built; the running class records no provider performance |
| Evolutionary pruning | not present in this repository |
| Confidence on LLM calls | hardcoded `0.9`, written to `tool_call_log` as if measured |

---

## Squads

Four squads, from `AGENT_WISDOM` in `lib/ConstitutionalAgentV4.js`. Each agent's role is in the same table.

| Squad | Agents |
|---|---|
| ORCHESTRATION | ORCH, W3C, SHOFET |
| ALPHA | TORCH, VERITAS, GCM |
| BETA | CHESED, MEL, APM |
| GAMMA | SOPHIA, NEXUS, HDM |

---

## 🛠️ Implementation Details

### What "ANFIS" means in the code that runs

Nothing here does fuzzy inference.

- `callAnfisReward()` in `lib/ConstitutionalAgentV4.js` runs after each finished task. It calls
  `trackProviderPerformance()`, which the V4 class does not have. So the call throws, the catch logs
  "Reward failed", and nothing is recorded.
- Every LLM call is logged with `confidenceAtCall: 0.9`. The number is hardcoded, then written to
  `tool_call_log.confidence_at_call` as though it had been measured.
- `constitutional-agent-base.js` does have a `trackProviderPerformance()`, and a `selectStorageTier()`
  with `let confidence = 0.9`. No agent runs that file (see "What runs"). It also declares an
  `ANFIS_ROUTER` flag, off and inert.

The adaptive-neuro-fuzzy design is specified elsewhere in the project. It is **not implemented here**,
and this README previously implied otherwise with a code sample that exists in no file in this
repository.

### Self-healing — designed, not built

The running class collects no provider performance: its one recording call fails, as above. Automatic
demotion of underperforming providers and reputation-based re-routing are **not wired**.

The one safety loop that IS live is the opposite of self-healing — it is self-stopping. The L0 emergency
halt can stop every tick loop, and its coverage test scans the filesystem for tick loops so that adding a
new ungated one fails the build.

---

## Where this sits

The agents run `server.js`, which creates one `ConstitutionalAgentV4`. This section names only what that code calls and what calls it. [The pin test](tests/readme-edges.test.js) fails if it drifts from the code.

**Calls:**

- **DealAppSeo/repid-engine**, at `REPID_API_URL`, with `REPID_API_KEY` as the bearer token:
  - Peer checks: `POST /api/v1/peer-verification/respond`. If `REPID_API_URL` is unset, this one falls back to `http://localhost:3000`.
  - Substance gate: `POST /api/v1/substance-gate/events`. Nothing is recorded if `REPID_API_URL` is unset.
  - Service contracts, when the agent has no task: `POST /api/v1/agent/process-contracts`. Skipped if `REPID_API_URL` is unset.
  - Model gateway: `POST /api/v1/llm/complete`, only when `ENGINE_LLM_PROXY=true` and paid calls are allowed (`lib/free-tier-gate.js`). The base is `REPID_API_URL`, else `ENGINE_URL`. If the gateway fails, the agent calls providers directly.
  - Engine stats: `GET /api/v1/stats` at `REPID_ENGINE_URL`, default `https://repid-engine-production.up.railway.app`. Only when `SWARM_TOOLBELT=on`.
- **Supabase**, one project:
  - `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) with a service key. The task queue, `trinity_tasks`, and most reads and writes.
  - Postgres at `DATABASE_URL` (or `SUPABASE_DB_URL`). The kill switch, `trinity_system_config.emergency_halt`. The per-agent switch, `agent_controls`. And `tool_call_log`, only when `TOOL_CALL_LOGGING=true`.
  - The kill switch is a database row that repid-engine also reads. It is not a call to repid-engine.
- **The zkp-postcard prover**: `GET /health` at `https://zkp-postcard-production.up.railway.app`, only for a ZKP_PROOF_SELF_TEST pulse task. It checks health. It asks for no proof.
- **LLM providers, directly**, when the gateway is off or fails. The list is the provider table near the top of `lib/ConstitutionalAgentV4.js`. Also Tavily web search.
- **Upstash Redis**, optional, at `UPSTASH_REDIS_REST_URL`.

**Called by:**

- Nothing calls the agents' code. Each agent is a loop. Work reaches it through the database: it claims rows from `trinity_tasks`.
- Each agent serves `GET /health` and a catch-all GET route that returns a fixed status. Railway's health check calls `/health`. That check is set on each Railway service, not in this repo.

**The whole map:** https://github.com/DealAppSeo/hyperdag-protocol/blob/main/BUILDERS.md#how-the-pieces-fit

---

## 🤝 Contributing

Community contributions are welcome. See [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) to get started — bug fixes, documentation improvements, and feature proposals are all appreciated.

---

[Constitution](CONSTITUTION.md) • [Contributing](CONTRIBUTING.md) • [Security](SECURITY.md)

**On-chain:** the agents' code makes no on-chain calls. The ERC-8004 registries on Base Sepolia
(chain 84532) are the ERC-8004 team's deployments.
[hyperdag-protocol](https://github.com/DealAppSeo/hyperdag-protocol) is the published interface spec
and defaults, and documents them.

Apache 2.0 licensed. Micah 6:8.
