// Survivor liveness — the frozen-sensor regression test.
// Run: node tests/survivorLiveness.test.js
//
// WHAT THIS PINS (measured against the live DB on 2026-08-17):
// runSurvivorResurrection() used to read `trinity_heartbeat.last_seen`. Agent-side
// heartbeat writes were removed on 2026-07-17 (HEARTBEAT_MODE='off'), so that column
// froze on that date for all 12 trinity agents while every one of them was returning
// HTTP 200 with an advancing loop_count. Every agent therefore alerted about all 11
// others, forever, and the alert could never clear because nothing wrote the field it
// read. Those alerts were also the only writer to trinity_agent_logs, so the dead sensor
// manufactured a fake `liveness_signal='work'` two surfaces downstream.
//
// Every fixture below feeds the SAME database state to old and new code: a frozen
// trinity_heartbeat row set (44,000 minutes stale, exactly as measured) plus real
// agent_health_probes rows. That is what makes the suite honest — it is not testing a
// new function in isolation, it is testing the verdict the agent reaches about a fleet
// whose actual condition we know. Against the pre-fix file every case below FAILS.
//
// No jest in this repo (CI runs plain `node tests/*.test.js`). Style mirrors
// tests/heartbeatDbWritesGate.test.js: env stubs so require() does not crash, and the
// agent built with Object.create so the real constructor never runs.

'use strict';

const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';

const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

// --- fixtures ---------------------------------------------------------------
const NOW = Date.now();
const MIN = 60 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// The measured frozen value: 2026-07-17, ~44,000 minutes before "now".
const FROZEN_MINUTES = 43974;
const GROUP = 'GAMMA';
const SELF = 'trinity-sophia';
const PEERS = ['trinity-hdm', 'trinity-nexus', 'trinity-w3c'];

function frozenRoster() {
    // Includes last_seen / current_task_summary deliberately: the pre-fix code reads
    // them, the post-fix code must not. Same rows, both files.
    return [SELF, ...PEERS].map(agent => ({
        agent,
        last_seen: iso(FROZEN_MINUTES * MIN),
        current_task_summary: 'Working on task 4711',
        config: { group: GROUP, tier: 'specialist' }
    }));
}

// A healthy probe row, shaped like the real ones: alive true, HTTP 200, loop advancing.
function healthyProbe(agent, { probeAgeMin = 3.7, iterAgeMin = 4.2, alive = true } = {}) {
    return {
        agent_name: agent,
        probed_at: iso(probeAgeMin * MIN),
        ok: true,
        http_status: 200,
        alive,
        loop_count: 15630,
        last_iteration_at: iso(iterAgeMin * MIN),
        current_task_id: 'task-4711'
    };
}

// Minimal supabase double. Returns a thenable builder per table so `await
// client.from(t).select().filter()...` resolves to the fixture for that table.
function fakeSupabase(tables) {
    const calls = [];
    const client = {
        calls,
        from(table) {
            calls.push(table);
            const builder = {};
            for (const m of ['select', 'filter', 'in', 'gte', 'lt', 'order', 'limit', 'eq', 'contains']) {
                builder[m] = () => builder;
            }
            builder.then = (onOk, onErr) =>
                Promise.resolve(tables[table] || { data: [], error: null }).then(onOk, onErr);
            return builder;
        }
    };
    return client;
}

function makeAgent({ probes = [], roster = frozenRoster(), now = NOW } = {}) {
    const agent = Object.create(ConstitutionalAgentV4.prototype);
    agent.name = SELF;
    agent.groupName = GROUP;
    agent.isSurvivor = true;
    agent.version = 'test';
    agent.wisdom = { squad: GROUP, tier: 'specialist' };
    agent.supabase = fakeSupabase({
        trinity_heartbeat: { data: roster, error: null },
        agent_health_probes: { data: probes, error: null }
    });
    agent.logs = [];
    agent.log = async (action, message, metadata) => { agent.logs.push({ action, message, metadata }); };
    agent._nowValue = now;
    agent._now = () => agent._nowValue;
    return agent;
}

// Silence the alert console during a run — the assertions read agent.logs.
async function run(agent) {
    const realLog = console.log;
    const realErr = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        await agent.runSurvivorResurrection();
    } finally {
        console.log = realLog;
        console.error = realErr;
    }
    return agent.logs;
}

const results = [];
async function test(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
        console.log(`  ✅ ${name}`);
    } catch (e) {
        results.push(['FAIL', name, e]);
        console.log(`  ❌ ${name}\n     ${e && e.message}`);
    }
}

(async () => {
    console.log('survivorLiveness.test.js');

    // ------------------------------------------------------------------ (1)
    // The bug itself. Frozen trinity_heartbeat, demonstrably healthy fleet.
    // Pre-fix: three "is DOWN" alerts about three healthy agents.
    await test('healthy fleet + frozen trinity_heartbeat ⇒ ZERO alerts', async () => {
        const agent = makeAgent({ probes: PEERS.map(p => healthyProbe(p)) });
        const logs = await run(agent);
        assert.deepEqual(logs, [], `expected no alerts, got ${JSON.stringify(logs.map(l => l.action))}`);
    });

    // ------------------------------------------------------------------ (2)
    // The durable invariant: when every reading is the failure value, suspect the
    // instrument. ONE alert naming the sensor, not N naming N agents.
    await test('every peer reads dead ⇒ ONE sensor alert, not N agent alerts', async () => {
        const probes = PEERS.map(p => healthyProbe(p, { alive: false }));
        const logs = await run(makeAgent({ probes }));
        assert.equal(logs.length, 1, `expected exactly 1 alert, got ${logs.length}`);
        assert.equal(logs[0].action, 'survivor_sensor_suspect');
        assert.equal(logs[0].metadata.peers, PEERS.length);
        // It must not name an agent as the culprit in the action.
        assert.ok(/SENSOR SUSPECT/.test(logs[0].message));
    });

    // ------------------------------------------------------------------ (3)
    // Absence is not death (v_fleet_truth's rule, same defect class).
    await test('a peer with NO probe row is UNKNOWN, never DOWN', async () => {
        const probes = [healthyProbe(PEERS[0]), healthyProbe(PEERS[1])]; // PEERS[2] never probed
        const logs = await run(makeAgent({ probes }));
        assert.deepEqual(logs, [], `silence must stay silent, got ${JSON.stringify(logs)}`);
    });

    // ------------------------------------------------------------------ (4)
    await test('all probes stale ⇒ ONE sensor alert (the prober stopped, not the fleet)', async () => {
        const probes = PEERS.map(p => healthyProbe(p, { probeAgeMin: 120, iterAgeMin: 121 }));
        const logs = await run(makeAgent({ probes }));
        assert.equal(logs.length, 1);
        assert.equal(logs[0].action, 'survivor_sensor_suspect');
        assert.ok(logs[0].metadata.reasons.every(r => r.reason === 'stale-probe'),
            `expected all stale-probe, got ${JSON.stringify(logs[0].metadata.reasons)}`);
    });

    // ------------------------------------------------------------------ (5)
    // A real death still alerts — the fix must not be a mute button.
    await test('one genuinely down peer among live peers ⇒ exactly 1 survivor_alert', async () => {
        const dead = { ...healthyProbe(PEERS[2]), ok: false, http_status: 502, alive: null };
        const logs = await run(makeAgent({ probes: [healthyProbe(PEERS[0]), healthyProbe(PEERS[1]), dead] }));
        assert.equal(logs.length, 1, `expected 1, got ${logs.length}`);
        assert.equal(logs[0].action, 'survivor_alert');
        assert.equal(logs[0].metadata.subject, PEERS[2]);
        assert.equal(logs[0].metadata.reason, 'probe-failed-http-502');
    });

    // ------------------------------------------------------------------ (6)
    // Rate limiting: one per loop iteration is what flooded trinity_agent_logs.
    await test('repeat iterations are de-duplicated, and the cooldown expires', async () => {
        const dead = { ...healthyProbe(PEERS[2]), ok: false, http_status: 502, alive: null };
        const agent = makeAgent({ probes: [healthyProbe(PEERS[0]), healthyProbe(PEERS[1]), dead] });
        await run(agent);
        await run(agent);
        await run(agent);
        assert.equal(agent.logs.length, 1, `3 loop iterations must yield 1 alert, got ${agent.logs.length}`);

        // Past the cooldown the outage is re-announced — suppression is bounded, not
        // permanent. Probes are re-stamped fresh relative to the advanced clock,
        // otherwise every peer would read stale-probe and trip the sensor guard instead.
        agent._nowValue = NOW + ConstitutionalAgentV4.SURVIVOR_ALERT_COOLDOWN_MS + MIN;
        const freshAt = new Date(agent._nowValue - 3 * MIN).toISOString();
        agent.supabase = fakeSupabase({
            trinity_heartbeat: { data: frozenRoster(), error: null },
            agent_health_probes: {
                data: [healthyProbe(PEERS[0]), healthyProbe(PEERS[1]), dead].map(p => ({
                    ...p,
                    probed_at: freshAt,
                    last_iteration_at: freshAt
                })),
                error: null
            }
        });
        await run(agent);
        assert.equal(agent.logs.length, 2, `expected re-alert after cooldown, got ${agent.logs.length}`);
    });

    // ------------------------------------------------------------------ (7)
    // HTTP 200 forever with a wedged loop — the thing a port check cannot see.
    await test('HTTP 200 but last_iteration_at stale ⇒ DOWN (loop hung)', async () => {
        const hung = healthyProbe(PEERS[2], { iterAgeMin: 45 });
        const logs = await run(makeAgent({ probes: [healthyProbe(PEERS[0]), healthyProbe(PEERS[1]), hung] }));
        assert.equal(logs.length, 1);
        assert.equal(logs[0].action, 'survivor_alert');
        assert.ok(/^loop-hung-/.test(logs[0].metadata.reason), `got reason ${logs[0].metadata.reason}`);
    });

    // ------------------------------------------------------------------ (8)
    // alive IS NULL is the majority state of that column in the real table. Treating
    // NULL as "not alive" would recreate the original bug in a new column.
    await test('alive IS NULL with HTTP 200 ⇒ LIVE (null is unknown, not dead)', async () => {
        const probes = PEERS.map(p => healthyProbe(p, { alive: null }));
        const logs = await run(makeAgent({ probes }));
        assert.deepEqual(logs, []);
    });

    // ------------------------------------------------------------------ (9)
    // The pure truth table, no DB and no clock.
    await test('classifySurvivorLiveness truth table', async () => {
        const c = ConstitutionalAgentV4.classifySurvivorLiveness;
        assert.equal(c(undefined, NOW).verdict, 'UNKNOWN');
        assert.equal(c(undefined, NOW).reason, 'no-probe');
        assert.equal(c({ probed_at: null }, NOW).verdict, 'UNKNOWN');
        assert.equal(c({ probed_at: 'not-a-date' }, NOW).verdict, 'UNKNOWN');
        assert.equal(c(healthyProbe('x'), NOW).verdict, 'LIVE');
        assert.equal(c(healthyProbe('x', { probeAgeMin: 999 }), NOW).verdict, 'UNKNOWN');
        assert.equal(c(healthyProbe('x', { alive: false }), NOW).verdict, 'DOWN');
        assert.equal(c({ ...healthyProbe('x'), http_status: 503 }, NOW).verdict, 'DOWN');
        // last_iteration_at absent ⇒ that dimension is unknown; it must not overturn
        // the process-up evidence that IS present.
        assert.equal(c({ ...healthyProbe('x'), last_iteration_at: null }, NOW).verdict, 'LIVE');
    });

    // ------------------------------------------------------------------ (10)
    await test('an unreadable sensor produces silence, not death notices', async () => {
        const agent = makeAgent();
        agent.supabase = fakeSupabase({
            trinity_heartbeat: { data: frozenRoster(), error: null },
            agent_health_probes: { data: null, error: { message: 'connection reset' } }
        });
        const logs = await run(agent);
        assert.deepEqual(logs, [], 'our own blindness is not evidence about them');
    });

    // ------------------------------------------------------------------ (11)
    await test('the observer never alerts about itself', async () => {
        // Self has no probe row at all; if self were evaluated it would be a peer
        // reading UNKNOWN and would change the sensor-guard arithmetic.
        const probes = PEERS.map(p => healthyProbe(p));
        const agent = makeAgent({ probes });
        await run(agent);
        assert.deepEqual(agent.logs, []);
    });

    const failed = results.filter(r => r[0] === 'FAIL');
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        console.log('FAILED:');
        for (const f of failed) console.log(`  - ${f[1]}`);
        process.exit(1);
    }
})();
