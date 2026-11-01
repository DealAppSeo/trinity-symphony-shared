# Free tokens: where the T12 agents get them, and what happens when they run out

The T12 agents run on free LLM tiers only. `lib/free-tier-gate.js` keeps them there:
`allow_paid` is false until Sean writes `paid <loop>` (recorded as env `SEAN_PAID_LOOP`).

## The free providers, in the order the gate tries them

Read from code on main (2026-10-31). Which of these keys each Railway service actually
holds is not in the repo: read each agent's boot line, `[LLM] providers key_present=… eligible=…`.

| Order | Provider | Model the agent calls | Counts as free when | Status |
|---|---|---|---|---|
| 1 | Groq | `openai/gpt-oss-20b` | always (free tier, rate-limited) | in use |
| 2 | Cerebras | `PARKED` | never: no model is shipped | parked, never called |
| 3 | OpenRouter | `OPENROUTER_MODEL`, default `deepseek/deepseek-chat` | only for a model id ending `:free` | the default id is **not** free, so OpenRouter counts only if `OPENROUTER_MODEL` is set to a `:free` id |
| 4 | NVIDIA | `meta/llama-3.1-8b-instruct` | always (developer trial credits) | in use when `NVIDIA_API_KEY` or `NVIDIA_NIM_API_KEY` is set |
| 5 | Together | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | always, per the gate | **flag for Sean, see below** |

So the top three that can actually serve a call are normally **Groq, OpenRouter (`:free` only), NVIDIA**.

**Together is a flag, not a fix.** together.ai's own model page says Llama 3.3 70B is not
available on its serverless API (checked 2026-10-31), so that slot fails and the runtime
demotes it. Today it costs nothing. But Together's free models were the `-Free` ids, which
are also gone, and the gate treats every `together` slot as free whatever the model. If
someone points it at a model Together does serve, the call is billed with `allow_paid` false.
Removing `together` from `FREE_TRY_ORDER` is the fix; it touches spend, so it is Sean's call.

## When they run out: the breaker

`lib/free-token-breaker.js`. A 429 or `insufficient_quota` marks a provider exhausted until
the next UTC midnight (the gate already did this). The breaker looks at this agent's top three
free providers and, in the default mode, pauses when **all** of them are exhausted:

- the loop stops claiming tasks and stops spawning evergreens, after the emergency halt and
  `agent_controls` checks and before `getNextTask`;
- it logs one line when it trips and one when it resets at midnight:
  `[FREE_TOKEN_BREAKER] {"event":"free_tokens_exhausted","agent":"trinity-mel",…}`;
- `/health` shows `"freeTokens":"EXHAUSTED_PAUSED"` while paused (`"available"` otherwise).

It never turns on a paid model. It does not pause when it cannot see the quota (litellm
gateway first) or when Sean allowed paid calls.

`FREE_TOKEN_BREAKER_MODE`: `all` (default: out of free tokens for the day), `any` (pause at
the first exhausted provider), `off`.

## Getting a text when it fires (Sean's side)

The agent only emits the event. The cheapest wiring uses what already exists: UptimeRobot
already polls each agent's `/health`. Add a keyword monitor per agent that alerts when the
page **contains** `EXHAUSTED_PAUSED`, with SMS as the alert contact. No new credentials go
into any agent.

Why the old check never fired: `gate.allFreeExhausted()` waits for all five providers, and a
provider an agent has no key for is never called, so never marked exhausted.
