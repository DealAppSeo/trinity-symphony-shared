# BEAT 36 — the global kill switch reaches the 12 Railway agents (L0 gate 0.4, agent half)

**Repo:** `trinity-symphony-shared` · **Branch:** `feat/cc-2026-07-27-agent-emergency-halt` · **Base:** `origin/main` @ `6824296b`
**Backlog item:** 0.4 — *"Kill switch — `emergency_halt` bool in `trinity_system_config`, checked every tick; true → workers PARK"*, listed as gating **all autonomy gates**.
**Companion:** repid-engine PR #216 covers the engine's workers + mutating HTTP. This PR covers the other half — the twelve agents that actually claim and execute work. **Same column, one flip, both halves.**
**DDL:** none. The column already exists in production.

---

## Why this was the task

Backlog 0.4 is an **L0 precondition** — dependency-earlier than every remaining L2 breaker — and it was only half done. Beat 34 built the switch; Beat 35's verifier found it reached 3 of ~14 engine loops and Beat 35 closed that. But the engine is not where the autonomy is. The **twelve Railway agents** are the producers and consumers of real work, and they live in this repo, where the switch did not exist at all.

A kill switch that stops the engine and leaves twelve agents claiming tasks is not a kill switch.

---

## Check-first, run BEFORE writing the module (Beat 34's recorded mistake was running it after)

**A per-agent lever already exists** — `lib/agent-controls.js`, reading `agent_controls.enabled`, cached, called once per iteration in both V4 loops. It is the right tool for "idle mel while I look at something". It is the **wrong** tool for an emergency, for two measured reasons:

1. **`agent_controls` holds three rows — `mel`, `sophia`, `veritas`** [V sql:2026-07-27], and `readEnabledFromDb` returns **`true` when no row exists**. **Nine of the twelve production agents cannot be stopped by that lever at all** until someone INSERTs a row first — not something an operator discovers mid-incident.
2. Even fully populated it is twelve flips, not one, and it says nothing about the non-agent producer in this repo.

So this composes with `agent-controls` rather than replacing it, and the header says so. It also **does not refactor it** (CLAUDE-RULE-3): the ~30 lines of cache plumbing are duplicated rather than extracted, and the duplication is named in the module header instead of being quietly resolved into a third convention.

---

## Scope — ENUMERATED, not asserted

Produced by grepping every `while (true)` and `setInterval(` outside `node_modules`/`tests`, then classifying each. Seven loop-bearing files.

**COVERED — 6 call sites across 3 files:**

| File | Loop | Why it must stop |
|---|---|---|
| `lib/ConstitutionalAgentV4.js` | `runLoop()` | the escalation-contract loop |
| `lib/ConstitutionalAgentV4.js` | `runLoopLegacy()` | **11 of 12 agents run this one** |
| `constitutional-agent-base.js` | main `while (true)` | claims and processes tasks, and has **no `agent_controls` gate of its own** — the global switch is the only lever that reaches it |
| `constitutional-agent-base.js` | `runSelfDiagnostic()` | can trigger a **healing cascade** and writes a genome report — that is the machine acting on the system a human is trying to work on |
| `constitutional-agent-base.js` | `askEternalQuestions()` | writes log rows every 15 min |
| `trinity-worker.js` | `startSeedingLoop()` | **a PRODUCER** — past its threshold it shells out and seeds evergreen tasks. A switch that stops the consumers but not the thing that CREATES work just refills the queue it was meant to drain |

**DELIBERATELY EXEMPT, with reasons:**
- the `heartbeat()` setIntervals — observability. A halt must stop the machine **acting**, not stop it **reporting**; the operator needs `/health` and `last_ping` to watch the fleet come to rest. Same call the engine made for `providers/health.ts`.
- `mutual-wake.js` — `fetch(agent.url + '/health')` only; enumerated for writes, there are none.

**NOT WIRED BECAUSE THEY DO NOT RUN — evidence, not assumption:**
- `trinity.hdm.js` — calls `pollAndExecute`, which is defined **zero** times in the 9-line file; it throws at boot.
- `trinity-{apm,orch,sophia,hdm,…}.js` — one-line shims that spawn **`scripts/run-agent.js`, which does not exist**.
- `w3c.index.js` — a full standalone agent loop referenced by no file and no deploy config.
- `lib/ConstitutionalAgent.ts` — required/imported by nothing.

The live entry point is `server.js` (`npm start`) → `ConstitutionalAgentV4`. **The coverage test asserts each of these dead-file claims is still true**, so reviving one fails CI rather than silently creating an ungated loop.

---

## Design decisions, each with a reason rather than a preference

1. **`enforce` is the DEFAULT, and the mode parser FAILS CLOSED.** Only exact `off`/`shadow` (case/trim-insensitive) weaken it; `of`, `false`, `0`, `disabled`, garbage all resolve to `enforce` and warn once. Other flags guard features that do damage when ON; this one guards the lever that *stops* damage. **You cannot typo the kill switch into being disabled.**
2. **The gate sits BEFORE the per-agent `agent_controls` gate.** A global stop that runs second can be masked by the first, and the log line would name the wrong cause mid-incident.
3. **It parks via the existing `idleWhenDisabled()` path**, so heartbeat and liveness keep reporting while work stops — reads stay up on purpose.
4. **Fail-OPEN on a read error, STICKY once true.** A flaky pooler must not park the fleet; and an operator who pulls the switch during an incident must not have it released *by* the incident. Note this is the inverse of `agent-controls`, which is fail-CLOSED — **deliberate, not inconsistent**: agent-controls already parks the agent when its store is unreachable, so nothing is lost, and making both fail closed would print a misleading "EMERGENCY HALT" for what is really a database blip.
5. **A missing column is inert + warned once**, so this is safe to deploy before, without, or after a rollback of the DDL.
6. **No Redis, unlike `agent-controls`.** The switch has to work when infrastructure is misbehaving, and every extra hop is another place a stale `false` can survive. Stated cost: ~0.4 reads/sec against the pooler across all 12 agents.
7. **The read is bounded** (`EMERGENCY_HALT_TIMEOUT_MS`, default 2000) and the timer is **not `unref`'d** — Beat 34 shipped an unref'd timeout that let a process exit mid-`await` and leave the flag set in production.

---

## Verification

**[V] 12 of 12 mutations killed**, re-measured against the final code. Both harness guards from prior beats are encoded rather than remembered: restore in a `finally`, and a unique marker asserted 0× before / exactly 1× after, else the result is **DISCARDED as NOT-LANDED**.

| Mutation | Result |
|---|---|
| delete one V4 gate call (leave the import) | KILLED |
| move the V4 gate *after* the per-agent gate | KILLED |
| remove the seeding **producer** gate | KILLED |
| remove one of the three base-class gates | KILLED |
| replace a gate with a **comment mentioning it** (vacuity probe) | KILLED |
| a new **unclassified** loop file appears | KILLED |
| a **dead file comes back to life** (`trinity.hdm.js`) | KILLED |
| sticky removed (a failed read LIFTS the halt) | KILLED |
| mode parser defaults to `off` | KILLED |
| the read is **unbounded** | KILLED |
| fail-open removed (a flaky DB parks the fleet) | KILLED |
| `isHaltTruthy` accepts anything truthy | KILLED |

**[V] All 7 node tests pass** (the 4 already in CI + `agent-controls` + the 2 new ones). **[V] `node -c` clean** on all four touched/added source files. **[V] Zero `MUTMARK` residue on disk and no stray mutant file — checked, not assumed.**

**[V] Live, before building:** `trinity_system_config.emergency_halt` exists as `boolean NOT NULL DEFAULT false` with the three audit columns; the flag is currently **`false`**; `agent_controls` holds exactly **3** rows, all `enabled=true` [sql:2026-07-27].

**[V] Safety of the (attempted) live acceptance, established two ways:** `origin/main` of this repo contains **zero** references to `emergency_halt`/`shouldParkForHalt`, so no deployed agent can read the flag; and the engine's `/health` reports `deployed_commit=a1b6e7f`, which predates the column. Flipping it today is provably inert.

### Two honest limits — stated, not papered over

1. **No live true-state acceptance run this beat.** Beat 34 flipped the flag and watched the engine react; I could not do the equivalent here. The prod `UPDATE` was **blocked by the session's permission classifier**, and I did not work around it — a guard on a production write is doing its job. What that leaves unproven is only the observable *reaction* to a live flip; the flag's storage, type and default are verified above, and the module is unmerged and inert regardless.
2. **The real `pgQuery` path is exercised by unit tests through an injected fake, not against the live pooler**, because no `DATABASE_URL` is available locally and obtaining one would mean handling a plaintext secret. The residual risk is node-pg's row mapping — mitigated, not eliminated, by the fact that `agent-controls.js` runs an identical `SELECT <bool column> FROM <table> WHERE <pk>` shape in production today. **This should be re-checked once on first deploy.**

---

## Mistakes this beat

- **My mode-parser test asserted the wrong thing and the first run corrected me.** I had put `'ofF '` in the must-enforce list; it trims and lowercases to exactly `off`, which is a legitimate operator typo, not an attack. The code was right and the test was wrong.
- **The bounded-read test PASSED under the mutation that removed the bound** — my own pin was vacuous, and only the mutation harness found it. Cause: with the fake query never settling and nothing else on the event loop, **Node judged the loop empty and exited 0 inside the `await`**, so the assertions never ran. That is Beat 34's exit-mid-await defect reproduced *in a test* instead of a script. Fixed with a watchdog timer that both keeps the loop alive and rejects. **Third consecutive beat in which a green result was the wrong conclusion** — the pattern is now unmistakable: any pin asserting a safety property must be run against the absence of that property before it is trusted.
- **Two mutations first reported NOT-LANDED** because these files are CRLF and my patterns used `\n`. The guard caught what would otherwise have been two free passes.
- I added `agent-controls.test.js` to CI (it existed, passed, and had never run there). Small scope expansion, stated rather than slipped in.
- **Carried, not fixed:** this repo's `ci.yml` has the same `pull_request: branches: [main]` filter that repid-engine #213 removes, so stacked PRs here would run no checks. Not bundled — it is a separate change with its own blast radius, and this PR is based on `main` so it is unaffected.
