'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyze, signTest, bootstrap } = require('../bench/analyze.js');

function run(task, arm, pass, tokens, extra) {
  return Object.assign({ task, category: 'bugfix', difficulty: 1, arm, trial: 1, pass, is_error: false, num_turns: 5, cost_usd: tokens / 1e6, usage: { output: 100 }, total_tokens: tokens, uncached_input: tokens / 4 }, extra || {});
}

test('sign test exact binomial', () => {
  const s = signTest([1, 1, 1, -1, 0, 0]);
  assert.strictEqual(s.pos, 3); assert.strictEqual(s.neg, 1); assert.strictEqual(s.n, 4);
  assert.ok(Math.abs(s.p - 0.625) < 1e-9);
  assert.strictEqual(signTest([0, 0]).p, 1);
});

test('bootstrap CI brackets the mean and is deterministic', () => {
  const v = [0.1, -0.1, 0.05, 0, 0.02, -0.03, 0.04, 0.01];
  const a = bootstrap(v, 2000, 3), b = bootstrap(v, 2000, 3);
  assert.deepStrictEqual(a, b);
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  assert.ok(a.lo95 <= m && m <= a.hi95);
});

test('analyze pairs arms per task and reaches a PASS verdict on identical quality with fewer tokens', () => {
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const pass = i % 5 === 0 ? 0 : 1;
    runs.push(run('t' + i, 'baseline', pass, 100000));
    runs.push(run('t' + i, 'xend', pass, 60000));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.strictEqual(a.overall.n_tasks, 20);
  assert.strictEqual(a.overall.d_pass, 0);
  assert.ok(Math.abs(a.overall.token_change + 0.4) < 1e-9);
  assert.strictEqual(a.gates.quality, 'PASS');
  assert.strictEqual(a.gates.cost, 'PASS');
  assert.strictEqual(a.gates.turns, 'PASS');
  assert.strictEqual(a.verdict, 'PASS');
  // same quality but no cost saving -> not promotable
  const flat = runs.map((r) => Object.assign({}, r, { cost_usd: 0.1 }));
  assert.notStrictEqual(analyze(flat, { gate: -0.03 }).verdict, 'PASS');
});

test('analyze flags a clear regression as FAIL and small samples as INCONCLUSIVE', () => {
  const bad = [];
  for (let i = 0; i < 30; i++) { bad.push(run('t' + i, 'baseline', 1, 1000)); bad.push(run('t' + i, 'xend', i % 2 ? 0 : 1, 900)); }
  assert.strictEqual(analyze(bad, { gate: -0.03 }).verdict, 'FAIL');
  const few = [];
  for (let i = 0; i < 6; i++) { few.push(run('t' + i, 'baseline', 1, 1000)); few.push(run('t' + i, 'xend', i === 0 ? 0 : 1, 900)); }
  const r = analyze(few, { gate: -0.03 });
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  assert.ok(r.overall.mde_pp > 0.03);
});
