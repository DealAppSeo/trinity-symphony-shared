'use strict';
/**
 * CASE POOL — a known-answer evergreen loop asks a different open case each spawn, never a sealed
 * one, never with the answer key, and pairs A/B arms on the same case.
 * Run: node tests/case-pool.test.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('../lib/case-pool');

(async () => {
  // ── the sealed predicate agrees with Postgres (computed there, 2026-11-01) ──
  // select ... where get_byte(sha256(convert_to('sealed-v1:'||id::text,'UTF8')),0) % 5 = 0
  assert.equal(cp.isSealed('02bcad2d-8845-43ec-8658-0377885654cb'), true);
  assert.equal(cp.isSealed('03727d54-2c63-4df2-a126-6d54501352e0'), true);
  assert.equal(cp.isSealed('0002d1c6-f7b3-4d5b-b4c9-5c23afb0aa2f'), false);
  assert.equal(cp.isSealed('0005a4f5-0b25-4d30-8eca-2ef60cf88015'), false);

  // ── a fake hal_test_cases: two sealed, three open; the key is in the row but never read ──
  const rows = {
    '02bcad2d-8845-43ec-8658-0377885654cb': { prompt_text: 'SEALED ONE', category: 'x', expected_decision: 'veto' },
    '03727d54-2c63-4df2-a126-6d54501352e0': { prompt_text: 'SEALED TWO', category: 'x', expected_decision: 'pass' },
    '0002d1c6-f7b3-4d5b-b4c9-5c23afb0aa2f': { prompt_text: 'open a', category: 'factual', expected_decision: 'pass' },
    '0005a4f5-0b25-4d30-8eca-2ef60cf88015': { prompt_text: 'open b', category: 'factual', expected_decision: 'veto' },
    '0001aaaa-0000-4000-8000-000000000000': { prompt_text: 'open c', category: 'history', expected_decision: 'pass' },
  };
  assert.equal(cp.isSealed('0001aaaa-0000-4000-8000-000000000000'), false, 'fixture id must be open');
  const selects = [];
  const fake = (opts = {}) => ({
    from: () => {
      let cols = '';
      let eqId = null;
      const q = {
        select: (c) => { cols = c; selects.push(c); return q; },
        order: () => q,
        limit: async () => (opts.readError ? { data: null, error: { message: 'down' } } : { data: Object.keys(rows).sort().map((id) => ({ id })), error: null }),
        eq: (_c, v) => { eqId = v; return q; },
        maybeSingle: async () => {
          const r = rows[eqId];
          if (!r) return { data: null, error: null };
          const out = { id: eqId };
          for (const c of cols.split(',').map((s) => s.trim())) out[c === 'id' ? 'id' : c] = c === 'id' ? eqId : r[c];
          if (opts.emptyText) out.prompt_text = '';
          return { data: out, error: null };
        },
      };
      return q;
    },
  });

  // rotates through the OPEN cases only, in id order, and wraps
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await cp.pickCase(fake(), 'hal_open_v1', i)).text);
  assert.deepEqual(seen, ['open c', 'open a', 'open b', 'open c']);
  assert.equal((await cp.pickCase(fake(), 'hal_open_v1', 0)).poolSize, 3);
  assert.ok(!seen.some((t) => t.startsWith('SEALED')), 'a sealed case is never served');
  assert.ok(!selects.some((c) => /expected_decision|expected_hallucination/.test(c)), 'the answer key is never read');

  // failures say so; no empty question
  assert.match((await cp.pickCase(fake(), 'hal_everything', 0)).error, /unknown case_pool/);
  assert.match((await cp.pickCase(fake({ readError: true }), 'hal_open_v1', 0)).error, /read failed/);
  assert.match((await cp.pickCase(fake({ emptyText: true }), 'hal_open_v1', 0)).error, /unreadable/);

  // ── filling the child ──
  const parent = {
    description: 'Statement:\n{{case_text}}\n{{arm_instruction}}\nAnswer as JSON.',
    metadata: { case_pool: 'hal_open_v1', ab: { name: 'quote-vs-free', A: 'Quote the exact words you rely on.', B: '' } },
  };
  const picked = { id: 'case-1', text: 'The sky is green.', category: 'factual' };
  const a = cp.fillChild(parent, picked, 0);
  const b = cp.fillChild(parent, picked, 1);
  assert.equal(a.description, 'Statement:\nThe sky is green.\nQuote the exact words you rely on.\nAnswer as JSON.');
  assert.equal(b.description, 'Statement:\nThe sky is green.\n\nAnswer as JSON.');
  assert.deepEqual(a.metadata, { case_pool: 'hal_open_v1', case_id: 'case-1', case_category: 'factual', ab_experiment: 'quote-vs-free', ab_arm: 'A' });
  assert.equal(b.metadata.ab_arm, 'B');

  // paired design: slots 0 and 1 ask the same case, 2 and 3 the next
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => cp.caseIndex(parent, s)), [0, 0, 1, 1, 2]);
  assert.deepEqual([0, 1, 2].map((s) => cp.caseIndex({ metadata: { case_pool: 'hal_open_v1' } }, s)), [0, 1, 2]);
  assert.equal(cp.fillChild({ description: '{{case_text}}', metadata: { case_pool: 'hal_open_v1' } }, picked, 3).metadata.ab_arm, null);

  // ── the slot is the parent's real child count ──
  // Not spawned_count: the spawner and the auto_lineage trigger both add 1 per child, so in prod
  // it read 2 after the first child (435582, 2026-11-01) and every slot was even: arm A forever.
  const counter = (n, err) => ({
    from: (table) => ({
      select: (_c, opts) => ({
        eq: (col, v) => ({
          // the id bound keeps the count on the primary key (parent_task_id has no index)
          gt: async (col2, v2) => {
            assert.equal(table, 'trinity_tasks');
            assert.deepEqual(opts, { count: 'exact', head: true });
            assert.deepEqual([col, v, col2, v2], ['parent_task_id', 435582, 'id', 435582]);
            return err ? { count: null, error: { message: 'down' } } : { count: n, error: null };
          },
        }),
      }),
    }),
  });
  assert.deepEqual(await cp.nextSlot(counter(0), 435582), { slot: 0 });
  assert.deepEqual(await cp.nextSlot(counter(1), 435582), { slot: 1 });
  assert.match((await cp.nextSlot(counter(0, true), 435582)).error, /child count failed/);
  // after one child, the next spawn is the same case in arm B
  assert.equal(cp.caseIndex(parent, (await cp.nextSlot(counter(1), 435582)).slot), 0);
  assert.equal(cp.fillChild(parent, picked, (await cp.nextSlot(counter(1), 435582)).slot).metadata.ab_arm, 'B');

  // ── the spawner uses it, and spawns nothing when a case cannot be read ──
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
  const at = src.indexOf('casePool.pickCase(');
  assert.ok(at > 0, 'spawner calls pickCase');
  const before = src.slice(Math.max(0, at - 600), at);
  assert.match(before, /casePool\.nextSlot\(this\.supabase, parent\.id\)/, 'slot comes from the child count');
  assert.doesNotMatch(before, /const slot = parent\.spawned_count/, 'slot never comes from spawned_count');
  const after = src.slice(at, at + 400);
  assert.match(after, /if \(picked\.error\) \{[\s\S]*?continue;/, 'a failed pick skips the child');
  assert.ok(src.indexOf('casePool.pickCase(') < src.indexOf('.insert(childRow)'), 'case is picked before the insert');

  console.log('case-pool.test.js: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
