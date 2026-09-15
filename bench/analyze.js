#!/usr/bin/env node
'use strict';
// Paired analysis of bench results: pass-rate delta with bootstrap CI, sign test, minimum
// detectable effect, token/turn/cost deltas, per-category breakdown, and the promotion gate.
//   node bench/analyze.js [resultsDir ...] [--json] [--md report.md] [--gate -0.03]
// With no directories, every bench/results/*/runs.jsonl is merged (evidence accumulates over runs).
const fs = require('fs');
const path = require('path');

const Z_ONE_SIDED_05 = 1.6449, Z_POWER_80 = 0.8416;

function loadRuns(dirs) {
  const runs = [];
  for (const d of dirs) {
    const f = fs.statSync(d).isDirectory() ? path.join(d, 'runs.jsonl') : d;
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { runs.push(JSON.parse(line)); } catch (_) {}
    }
  }
  return runs;
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function sd(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
function quantile(sorted, q) { if (!sorted.length) return NaN; const pos = (sorted.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }

// deterministic PRNG so reports are reproducible
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function bootstrap(values, reps, seed) {
  const r = rng(seed || 42); const n = values.length; const means = [];
  for (let i = 0; i < reps; i++) { let s = 0; for (let k = 0; k < n; k++) s += values[Math.floor(r() * n)]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return { lo95: quantile(means, 0.025), hi95: quantile(means, 0.975), lo90: quantile(means, 0.05), hi90: quantile(means, 0.95) };
}

function signTest(diffs) {
  const pos = diffs.filter((d) => d > 1e-9).length, neg = diffs.filter((d) => d < -1e-9).length, n = pos + neg;
  if (!n) return { pos, neg, n, p: 1 };
  const k = Math.min(pos, neg);
  let p = 0; for (let i = 0; i <= k; i++) p += binom(n, i) * Math.pow(0.5, n);
  return { pos, neg, n, p: Math.min(1, 2 * p) };
}
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

function perTask(runs) {
  const byTask = {};
  for (const r of runs) {
    const t = byTask[r.task] || (byTask[r.task] = { task: r.task, category: r.category, arms: {} });
    const a = t.arms[r.arm] || (t.arms[r.arm] = []);
    a.push(r);
  }
  return byTask;
}

function armStats(list) {
  const ok = list.filter((r) => !r.is_error || r.pass);
  return {
    n: list.length, pass: mean(list.map((r) => r.pass)), tokens: mean(list.map((r) => r.total_tokens_all || r.total_tokens)),
    tokens_main: mean(list.map((r) => r.total_tokens)), uncached: mean(list.map((r) => r.uncached_input || 0)),
    output: mean(list.map((r) => r.usage.output)), turns: mean(list.map((r) => r.num_turns)), cost: mean(list.map((r) => r.cost_usd)),
    errors: list.length - ok.length, answer_chars: mean(list.map((r) => r.answer_chars || 0)),
  };
}

function analyze(runs, opts) {
  opts = opts || {};
  const gate = opts.gate == null ? -0.03 : opts.gate;
  const arms = Array.from(new Set(runs.map((r) => r.arm)));
  const base = arms.includes('baseline') ? 'baseline' : arms[0];
  const treat = arms.find((a) => a !== base) || base;
  const byTask = perTask(runs);
  const tasks = Object.values(byTask).filter((t) => t.arms[base] && t.arms[treat]);
  const rows = tasks.map((t) => {
    const b = armStats(t.arms[base]), x = armStats(t.arms[treat]);
    return { task: t.task, category: t.category, base: b, treat: x, dPass: x.pass - b.pass, tokenRatio: b.tokens ? x.tokens / b.tokens : NaN, outputRatio: b.output ? x.output / b.output : NaN, dTurns: x.turns - b.turns, dCost: x.cost - b.cost, costRatio: b.cost ? x.cost / b.cost : NaN };
  });
  const dPass = rows.map((r) => r.dPass);
  const n = rows.length;
  const boot = n ? bootstrap(dPass, 4000, 7) : null;
  const sdD = sd(dPass);
  const mde = n > 1 ? (Z_ONE_SIDED_05 + Z_POWER_80) * sdD / Math.sqrt(n) : NaN;
  const tokenChange = rows.map((r) => r.tokenRatio - 1).filter((x) => !isNaN(x));
  const tokenBoot = tokenChange.length ? bootstrap(tokenChange, 4000, 11) : null;
  const outputChange = rows.map((r) => r.outputRatio - 1).filter((x) => !isNaN(x));
  const costChange = rows.map((r) => r.costRatio - 1).filter((x) => !isNaN(x));
  const costBoot = costChange.length ? bootstrap(costChange, 4000, 13) : null;
  const turnDelta = rows.map((r) => r.dTurns).filter((x) => !isNaN(x));
  const turnBoot = turnDelta.length ? bootstrap(turnDelta, 4000, 17) : null;
  const overall = {
    n_tasks: n, n_runs: runs.length, base_arm: base, treat_arm: treat,
    pass_base: mean(rows.map((r) => r.base.pass)), pass_treat: mean(rows.map((r) => r.treat.pass)),
    d_pass: mean(dPass), d_pass_ci95: boot ? [boot.lo95, boot.hi95] : null, d_pass_lower90: boot ? boot.lo90 : null,
    sign: signTest(dPass), mde_pp: mde,
    token_change: mean(tokenChange), token_change_ci95: tokenBoot ? [tokenBoot.lo95, tokenBoot.hi95] : null,
    output_change: mean(outputChange), cost_change: mean(costChange), cost_change_ci95: costBoot ? [costBoot.lo95, costBoot.hi95] : null, cost_change_upper90: costBoot ? costBoot.hi90 : null,
    turn_delta: mean(turnDelta), turn_delta_ci95: turnBoot ? [turnBoot.lo95, turnBoot.hi95] : null, turn_delta_upper90: turnBoot ? turnBoot.hi90 : null,
    tokens_base: mean(rows.map((r) => r.base.tokens)), tokens_treat: mean(rows.map((r) => r.treat.tokens)),
    uncached_base: mean(rows.map((r) => r.base.uncached)), uncached_treat: mean(rows.map((r) => r.treat.uncached)),
    turns_base: mean(rows.map((r) => r.base.turns)), turns_treat: mean(rows.map((r) => r.treat.turns)),
    cost_base: mean(rows.map((r) => r.base.cost)), cost_treat: mean(rows.map((r) => r.treat.cost)),
    errors_base: rows.reduce((s, r) => s + r.base.errors, 0), errors_treat: rows.reduce((s, r) => s + r.treat.errors, 0),
  };
  // Three-part gate: quality not worse than the bound, cost confidently lower, turns not higher.
  const gates = {
    quality: boot ? (boot.lo90 >= gate ? 'PASS' : boot.hi90 < gate ? 'FAIL' : 'INCONCLUSIVE') : 'INCONCLUSIVE',
    cost: costBoot ? (costBoot.hi90 < 0 ? 'PASS' : costBoot.lo90 > 0 ? 'FAIL' : 'INCONCLUSIVE') : 'INCONCLUSIVE',
    turns: turnBoot ? (turnBoot.hi90 <= 0.25 ? 'PASS' : turnBoot.lo90 > 0.25 ? 'FAIL' : 'INCONCLUSIVE') : 'INCONCLUSIVE',
  };
  let verdict = 'INCONCLUSIVE';
  if (Object.values(gates).some((g) => g === 'FAIL')) verdict = 'FAIL';
  else if (Object.values(gates).every((g) => g === 'PASS')) verdict = 'PASS';
  const byCat = {};
  for (const r of rows) {
    const c = byCat[r.category] || (byCat[r.category] = { n: 0, dPass: [], tokenChange: [] });
    c.n++; c.dPass.push(r.dPass); if (!isNaN(r.tokenRatio)) c.tokenChange.push(r.tokenRatio - 1);
  }
  const categories = Object.entries(byCat).map(([k, v]) => ({ category: k, n: v.n, d_pass: mean(v.dPass), token_change: mean(v.tokenChange) }));
  return { overall, verdict, gates, gate, rows, categories };
}

function pct(x, digits) { return isNaN(x) ? 'n/a' : (x * 100).toFixed(digits == null ? 1 : digits) + '%'; }
function pp(x) { return isNaN(x) || x == null ? 'n/a' : (x * 100 >= 0 ? '+' : '') + (x * 100).toFixed(1) + ' pp'; }
function num(x, d) { return isNaN(x) || x == null ? 'n/a' : Number(x).toFixed(d == null ? 0 : d); }

function renderMarkdown(a) {
  const o = a.overall; const L = [];
  L.push('# xend bench report');
  L.push('');
  L.push('Paired comparison of `' + o.treat_arm + '` against `' + o.base_arm + '` on ' + o.n_tasks + ' tasks (' + o.n_runs + ' runs).');
  L.push('');
  L.push('| Metric | ' + o.base_arm + ' | ' + o.treat_arm + ' | change |');
  L.push('|---|---|---|---|');
  L.push('| Pass rate | ' + pct(o.pass_base) + ' | ' + pct(o.pass_treat) + ' | ' + pp(o.d_pass) + (o.d_pass_ci95 ? ' (95% CI ' + pp(o.d_pass_ci95[0]) + ' to ' + pp(o.d_pass_ci95[1]) + ')' : '') + ' |');
  L.push('| Tokens per task (all models incl. subagents, all four meters) | ' + num(o.tokens_base) + ' | ' + num(o.tokens_treat) + ' | ' + pct(o.token_change) + (o.token_change_ci95 ? ' (95% CI ' + pct(o.token_change_ci95[0]) + ' to ' + pct(o.token_change_ci95[1]) + ')' : '') + ' |');
  L.push('| Uncached input tokens per task | ' + num(o.uncached_base) + ' | ' + num(o.uncached_treat) + ' | ' + pct(o.uncached_base ? o.uncached_treat / o.uncached_base - 1 : NaN) + ' |');
  L.push('| Output tokens per task | | | ' + pct(o.output_change) + ' |');
  L.push('| Turns per task | ' + num(o.turns_base, 1) + ' | ' + num(o.turns_treat, 1) + ' | ' + num(o.turns_treat - o.turns_base, 1) + ' |');
  L.push('| Cost per task (USD, Claude Code reported, subagents included) | ' + num(o.cost_base, 3) + ' | ' + num(o.cost_treat, 3) + ' | ' + pct(o.cost_change) + (o.cost_change_ci95 ? ' (95% CI ' + pct(o.cost_change_ci95[0]) + ' to ' + pct(o.cost_change_ci95[1]) + ')' : '') + ' |');
  L.push('| Runs with errors | ' + o.errors_base + ' | ' + o.errors_treat + ' | |');
  L.push('');
  L.push('Sign test on non-tied tasks: ' + o.sign.pos + ' better, ' + o.sign.neg + ' worse, p = ' + o.sign.p.toFixed(2) + '.');
  L.push('Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): ' + (isNaN(o.mde_pp) ? 'n/a' : (o.mde_pp * 100).toFixed(1) + ' pp') + '.');
  L.push('');
  L.push('**Verdict: ' + a.verdict + '** (all three must pass)');
  L.push('- quality: ' + a.gates.quality + ' (one-sided 95% lower bound of pass-rate delta ' + pp(o.d_pass_lower90) + ' vs gate ' + (a.gate * 100).toFixed(0) + ' pp)');
  L.push('- cost: ' + a.gates.cost + ' (one-sided 95% upper bound of cost change ' + pct(o.cost_change_upper90) + '; must be below 0%)');
  L.push('- turns: ' + a.gates.turns + ' (one-sided 95% upper bound of turn delta ' + num(o.turn_delta_upper90, 2) + '; must be at most +0.25)');
  L.push('');
  if (a.categories.length) {
    L.push('| Category | tasks | pass delta | token change |');
    L.push('|---|---|---|---|');
    for (const c of a.categories) L.push('| ' + c.category + ' | ' + c.n + ' | ' + pp(c.d_pass) + ' | ' + pct(c.token_change) + ' |');
    L.push('');
  }
  L.push('| Task | cat | pass base | pass xend | tokens base | tokens xend | ratio | turns Δ |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of a.rows) L.push('| ' + r.task + ' | ' + r.category + ' | ' + pct(r.base.pass, 0) + ' | ' + pct(r.treat.pass, 0) + ' | ' + num(r.base.tokens) + ' | ' + num(r.treat.tokens) + ' | ' + num(r.tokenRatio, 2) + ' | ' + num(r.dTurns, 1) + ' |');
  return L.join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const mdOut = argv.includes('--md') ? argv[argv.indexOf('--md') + 1] : null;
  const gate = argv.includes('--gate') ? Number(argv[argv.indexOf('--gate') + 1]) : -0.03;
  let dirs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--md' && argv[i - 1] !== '--gate');
  if (!dirs.length) {
    const root = path.join(__dirname, 'results');
    dirs = fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'runs.jsonl'))) : [];
  }
  const runs = loadRuns(dirs);
  if (!runs.length) { console.error('no runs found'); process.exit(1); }
  const a = analyze(runs, { gate });
  if (json) console.log(JSON.stringify(a, null, 2));
  else process.stdout.write(renderMarkdown(a));
  if (mdOut) fs.writeFileSync(mdOut, renderMarkdown(a));
}

if (require.main === module) main();
module.exports = { analyze, renderMarkdown, bootstrap, signTest, loadRuns };
