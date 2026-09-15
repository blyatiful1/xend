'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyze, signTest, bootstrap, renderMarkdown } = require('../bench/analyze.js');

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

test('analyze: multi-arm shape has one comparison per non-base arm, each paired against base', () => {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(run('t' + i, 'arch-fable', 1, 40000));
    runs.push(run('t' + i, 'arch-sonnet', 1, 60000));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.strictEqual(a.base, 'baseline');
  assert.strictEqual(a.comparisons.length, 2);
  const labels = a.comparisons.map((c) => c.treat).sort();
  assert.deepStrictEqual(labels, ['arch-fable', 'arch-sonnet']);
  for (const c of a.comparisons) {
    assert.strictEqual(c.overall.base_arm, 'baseline');
    assert.strictEqual(c.overall.treat_arm, c.treat);
    assert.strictEqual(c.overall.n_tasks, 10);
    assert.ok('quality' in c.gates && 'cost' in c.gates && 'turns' in c.gates);
    assert.ok(Array.isArray(c.rows) && c.rows.length === 10);
    assert.ok(Array.isArray(c.categories));
  }
  // three arms -> no backward-compatible top-level keys
  assert.strictEqual(a.overall, undefined);
  assert.strictEqual(a.verdict, undefined);
});

test('analyze: two-arm shape still exposes the old top-level keys (overall/verdict/gates/gate/rows/categories)', () => {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(run('t' + i, 'xend', 1, 60000));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.strictEqual(a.comparisons.length, 1);
  assert.strictEqual(a.overall, a.comparisons[0].overall);
  assert.strictEqual(a.verdict, a.comparisons[0].verdict);
  assert.strictEqual(a.gates, a.comparisons[0].gates);
  assert.strictEqual(a.rows, a.comparisons[0].rows);
  assert.strictEqual(a.categories, a.comparisons[0].categories);
  assert.strictEqual(a.gate, -0.03);
});

test('analyze: --base override picks the named arm even when "baseline" is also present', () => {
  const runs = [];
  for (let i = 0; i < 8; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(run('t' + i, 'solo-fable', 1, 90000));
    runs.push(run('t' + i, 'arch-fable', 1, 40000));
  }
  const a = analyze(runs, { gate: -0.03, base: 'solo-fable' });
  assert.strictEqual(a.base, 'solo-fable');
  const labels = a.comparisons.map((c) => c.treat).sort();
  assert.deepStrictEqual(labels, ['arch-fable', 'baseline']);
});

test('analyze: falls back to the first arm_kind === "baseline" arm, then the first arm seen, when no arm is literally labelled "baseline"', () => {
  const runs = [];
  for (let i = 0; i < 6; i++) {
    runs.push(Object.assign(run('t' + i, 'solo-sonnet', 1, 100000), { arm_kind: 'baseline' }));
    runs.push(Object.assign(run('t' + i, 'arch-sonnet', 1, 60000), { arm_kind: 'xend' }));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.strictEqual(a.base, 'solo-sonnet');

  // no arm_kind at all (old runs) -> first arm seen
  const oldRuns = [];
  for (let i = 0; i < 6; i++) {
    oldRuns.push(run('t' + i, 'solo-sonnet', 1, 100000));
    oldRuns.push(run('t' + i, 'arch-sonnet', 1, 60000));
  }
  const b = analyze(oldRuns, { gate: -0.03 });
  assert.strictEqual(b.base, 'solo-sonnet');
});

test('analyze: score falls back to pass for records without a score field, and computes d_score', () => {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(Object.assign(run('t' + i, 'xend', 1, 60000), { score: 0.5 }));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.ok(Math.abs(a.overall.score_base - 1) < 1e-9);
  assert.ok(Math.abs(a.overall.score_treat - 0.5) < 1e-9);
  assert.ok(Math.abs(a.overall.d_score - (-0.5)) < 1e-9);
});

test('analyze: cost splits into main/sub and falls back to the whole cost as "main" for old records', () => {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000)); // no cost_main_usd/cost_sub_usd -> falls back
    runs.push(Object.assign(run('t' + i, 'xend', 1, 60000), { cost_main_usd: 0.02, cost_sub_usd: 0.08, cost_usd: 0.1 }));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.ok(Math.abs(a.overall.cost_main_base - a.overall.cost_base) < 1e-9);
  assert.ok(Math.abs(a.overall.cost_sub_base) < 1e-9);
  assert.ok(Math.abs(a.overall.cost_main_treat - 0.02) < 1e-9);
  assert.ok(Math.abs(a.overall.cost_sub_treat - 0.08) < 1e-9);
});

test('analyze: subagents-spawned mean is only meaningful when subagent_stats is present', () => {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(Object.assign(run('t' + i, 'xend', 1, 60000), { subagent_stats: { spawned: 3, completed: 3, failed: 0 } }));
  }
  const a = analyze(runs, { gate: -0.03 });
  assert.strictEqual(a.overall.has_subagent_stats, true);
  assert.ok(isNaN(a.overall.subagents_base));
  assert.ok(Math.abs(a.overall.subagents_treat - 3) < 1e-9);

  const noSub = runs.map((r) => { const c = Object.assign({}, r); delete c.subagent_stats; return c; });
  const b = analyze(noSub, { gate: -0.03 });
  assert.strictEqual(b.overall.has_subagent_stats, false);
});

test('analyze: model_table averages tokens and cost per task-record for arms carrying model_usage', () => {
  const runs = [];
  for (let i = 0; i < 4; i++) {
    runs.push(run('t' + i, 'baseline', 1, 100000));
    runs.push(Object.assign(run('t' + i, 'xend', 1, 60000), {
      model_usage: {
        'claude-sonnet-5': { input: 100, cache_creation: 0, cache_read: 0, output: 100, cost: 0.08 },
        'claude-haiku-4-5': { input: 50, cache_creation: 0, cache_read: 0, output: 50, cost: 0.02 },
      },
    }));
  }
  const a = analyze(runs, { gate: -0.03 });
  const table = a.comparisons[0].model_table;
  const sonnetRow = table.find((r) => r.arm === 'xend' && r.model === 'claude-sonnet-5');
  const haikuRow = table.find((r) => r.arm === 'xend' && r.model === 'claude-haiku-4-5');
  assert.ok(sonnetRow && haikuRow);
  assert.ok(Math.abs(sonnetRow.tokens_per_task - 200) < 1e-9);
  assert.ok(Math.abs(sonnetRow.cost_per_task - 0.08) < 1e-9);
  assert.ok(Math.abs(haikuRow.cost_per_task - 0.02) < 1e-9);
  // baseline never carried model_usage -> no rows for it
  assert.strictEqual(table.some((r) => r.arm === 'baseline'), false);
});

test('renderMarkdown renders a heading per comparison and does not throw on old records missing every new field', () => {
  const runs = [];
  for (let i = 0; i < 4; i++) { runs.push(run('t' + i, 'baseline', 1, 1000)); runs.push(run('t' + i, 'xend', 1, 900)); }
  const a = analyze(runs, { gate: -0.03 });
  const md = renderMarkdown(a);
  assert.ok(md.includes('## xend vs baseline'));
  assert.ok(md.includes('Score (fraction of hidden tests passed)'));
  assert.ok(md.includes('Cost split (main model / subagents)'));
});
