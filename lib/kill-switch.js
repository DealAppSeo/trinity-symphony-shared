'use strict';

/**
 * C1 — killSwitch.check(scope): may this capability act right now?
 * (HARNESS_ARCHITECTURE_SYNTHESIS 2026-10-16 §2; SECURITY_RUN §4 item 1.)
 *
 * Scopes: 'global' | 'agent:<id>' | 'cap:egress' | 'cap:chain' | 'cap:db_write'.
 *
 * Every scope reads the ONE global flag, `trinity_system_config.emergency_halt`, through
 * emergency-halt.js's readHalt(): same 5 s cache, same failure rules (a read error can
 * neither start a halt nor lift one). The agent loops already park on that flag; this
 * extends it to the places a halt must also stop mid-run, starting with the toolbelt's
 * egress (lib/egress-fetch.js).
 * ponytail: no per-scope storage exists, so a scope cannot be halted on its own yet.
 * Add per-scope rows when an operator needs "stop egress, keep working".
 *
 * HARNESS_KILL_SWITCH_ENFORCE=1 makes callers refuse while halted. Unset (default) = shadow:
 * a halt is logged as "would halt" and nothing changes. This flag is separate from
 * EMERGENCY_HALT_MODE, which governs the agent loops and stays enforce-by-default.
 */

const { readHalt } = require('./emergency-halt');

const enforced = () => process.env.HARNESS_KILL_SWITCH_ENFORCE === '1';

/** @returns {Promise<{halted: boolean, reason: string|null}>} halted is true only when enforced. */
async function check(scope) {
  const { halted, source } = await readHalt();
  if (!halted) return { halted: false, reason: null };
  const reason = `emergency_halt is set (scope=${scope}, source=${source})`;
  if (!enforced()) {
    console.warn(`[kill-switch] SHADOW: would halt ${scope} — ${reason}; continuing (HARNESS_KILL_SWITCH_ENFORCE != 1).`);
    return { halted: false, reason };
  }
  console.warn(`[kill-switch] HALTED ${scope} — ${reason}.`);
  return { halted: true, reason };
}

module.exports = { check };
