#!/usr/bin/env node
'use strict';
// Report for bench/session.js runs: each arm against a base arm, paired by trial (the same trial's
// sessions ran in the same wave). Cost and context with a bootstrap 95% CI on the paired ratio of
// means, compactions, subtasks fixed, the subagent share of cost, and how context and cost per
// subtask move over the session.
//
//   node bench/analyze-session.js <results-dir> [--base solo] [--md report.md]

const fs = require('fs');
const path = require('path');

function load(dir) {
  return fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };

// Deterministic bootstrap (fixed LCG seed) of the ratio of means over paired trials.
function bootRatio(pairs, iters) {
  if (pairs.length < 2) return [NaN, NaN];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rs = [];
  for (let k = 0; k < (iters || 4000); k++) {
    let a = 0, b = 0;
    for (let i = 0; i < pairs.length; i++) { const p = pairs[Math.floor(rnd() * pairs.length)]; a += p[0]; b += p[1]; }
    rs.push(b / a - 1);
  }
  rs.sort((x, y) => x - y);
  return [rs[Math.floor(rs.length * 0.025)], rs[Math.floor(rs.length * 0.975)]];
}

function pct(x) { return isNaN(x) ? 'n/a' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
function usd(x) { return isNaN(x) ? 'n/a' : '$' + x.toFixed(3); }
function k(x) { return isNaN(x) ? 'n/a' : (x / 1000).toFixed(1) + 'k'; }

// A resumed run can hold several records for one task|arm|trial (an incomplete attempt, then the rerun):
// the last record per key is the one that counts, in the tables and in the counts.
function latest(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.task + '|' + r.arm + '|' + r.trial, r);
  return [...m.values()];
}

function report(allRows, base) {
  const rows = latest(allRows);
  const superseded = allRows.length - rows.length;
  const valid = rows.filter((r) => r.complete);
  const arms = [...new Set(rows.map((r) => r.arm))];
  const by = {};
  for (const r of valid) ((by[r.arm] = by[r.arm] || {})[r.trial] = r);
  const out = [];
  out.push('# Long-session report');
  out.push('');
  const tasks = [...new Set(rows.map((r) => r.task))];
  out.push('Task(s): ' + tasks.join(', ') + '. Sessions: ' + rows.length + ' (' + valid.length + ' complete). Base arm: `' + base + '`. ' +
    'Paired by trial; CIs are bootstrap 95% intervals of the ratio of means over trials.' +
    (superseded ? ' ' + superseded + ' earlier attempt(s) superseded by a resumed rerun are not counted.' : ''));
  const incomplete = rows.filter((r) => !r.complete);
  if (incomplete.length) out.push('', 'Incomplete or invalid sessions (excluded): ' + incomplete.map((r) => r.arm + '#' + r.trial + ' (' + (r.invalid || 'errors') + ')').join(', ') + '.');
  out.push('');
  out.push('| Arm | n | Cost per session | vs base (95% CI) | Subagent share | Main context peak | Context at end | Compactions | Subtasks fixed | Turns | Wall |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of arms) {
    const rs = Object.values(by[arm] || {});
    if (!rs.length) { out.push('| ' + arm + ' | 0 | | | | | | | | | |'); continue; }
    const pairs = [];
    for (const [t, r] of Object.entries(by[arm] || {})) if (by[base] && by[base][t]) pairs.push([by[base][t].cost_usd, r.cost_usd]);
    const ratio = pairs.length ? pairs.reduce((s, p) => s + p[1], 0) / pairs.reduce((s, p) => s + p[0], 0) - 1 : NaN;
    const ci = bootRatio(pairs);
    const cost = rs.map((r) => r.cost_usd);
    out.push('| ' + arm + ' | ' + rs.length + ' | ' + usd(mean(cost)) + ' ± ' + sd(cost).toFixed(3) + ' | ' + (arm === base ? '—' : pct(ratio) + ' (' + pct(ci[0]) + ' to ' + pct(ci[1]) + ')') +
      ' | ' + pct(mean(rs.map((r) => (r.cost_usd ? (r.sub_cost_usd || 0) / r.cost_usd : 0)))).replace('+', '') +
      ' | ' + k(mean(rs.map((r) => r.ctx_peak))) + ' | ' + k(mean(rs.map((r) => r.ctx_final))) +
      ' | ' + mean(rs.map((r) => r.compactions)).toFixed(2) + ' | ' + mean(rs.map((r) => r.modules_fixed)).toFixed(2) + '/' + rs[0].modules_total +
      ' | ' + mean(rs.map((r) => r.turns)).toFixed(0) + ' | ' + Math.round(mean(rs.map((r) => r.wall_ms)) / 60000) + ' min |');
  }
  // context and cost over the session
  const n = Math.max(...valid.map((r) => (r.ctx_by_message || []).length));
  out.push('', '## Main context after each subtask (mean, tokens)', '');
  out.push('| Arm | ' + Array.from({ length: n }, (_, i) => String(i + 1)).join(' | ') + ' |');
  out.push('|---|' + '---|'.repeat(n));
  for (const arm of arms) {
    const rs = Object.values(by[arm] || {});
    if (!rs.length) continue;
    out.push('| ' + arm + ' | ' + Array.from({ length: n }, (_, i) => k(mean(rs.map((r) => r.ctx_by_message[i] || 0)))).join(' | ') + ' |');
  }
  out.push('', '## Cost per subtask (mean, USD)', '');
  out.push('| Arm | ' + Array.from({ length: n }, (_, i) => String(i + 1)).join(' | ') + ' | first half | second half |');
  out.push('|---|' + '---|'.repeat(n + 2));
  for (const arm of arms) {
    const rs = Object.values(by[arm] || {});
    if (!rs.length) continue;
    const per = Array.from({ length: n }, (_, i) => mean(rs.map((r) => r.cost_by_message[i] || 0)));
    const h = Math.floor(n / 2);
    out.push('| ' + arm + ' | ' + per.map((x) => x.toFixed(3)).join(' | ') + ' | ' + usd(per.slice(0, h).reduce((a, b) => a + b, 0)) + ' | ' + usd(per.slice(h).reduce((a, b) => a + b, 0)) + ' |');
  }
  // compactions
  const comps = valid.flatMap((r) => (r.compaction_events || []).map((c) => Object.assign({ arm: r.arm, trial: r.trial }, c)));
  if (comps.length) {
    out.push('', '## Compactions', '');
    out.push('| Arm | Trial | After subtask | Trigger | Tokens before | Tokens after | Context of next call |');
    out.push('|---|---|---|---|---|---|---|');
    for (const c of comps) out.push('| ' + c.arm + ' | ' + c.trial + ' | ' + (c.message + 1) + ' | ' + c.trigger + ' | ' + (c.pre_tokens || '') + ' | ' + (c.post_tokens || '') + ' | ' + (c.ctx_after || '') + ' |');
  }
  // per-module failures
  const misses = {};
  for (const r of valid) for (const [m, [p, t]] of Object.entries(r.per_module || {})) if (p !== t) ((misses[r.arm] = misses[r.arm] || {})[m] = ((misses[r.arm] || {})[m] || 0) + 1);
  if (Object.keys(misses).length) {
    out.push('', '## Subtasks not fixed (count over trials)', '');
    for (const [arm, ms] of Object.entries(misses)) out.push('- ' + arm + ': ' + Object.entries(ms).map(([m, c]) => m + ' x' + c).join(', '));
  }
  // a task's own checks (score.py): mean of each numeric or boolean field per arm
  const withChecks = valid.filter((r) => r.task_checks && !r.task_checks.error);
  if (withChecks.length) {
    const keys = [...new Set(withChecks.flatMap((r) => Object.keys(r.task_checks)))].filter((key) => withChecks.every((r) => ['number', 'boolean'].includes(typeof r.task_checks[key])));
    out.push('', '## Task checks (mean per session; booleans as the share of sessions)', '');
    out.push('| Arm | ' + keys.join(' | ') + ' |');
    out.push('|---|' + '---|'.repeat(keys.length));
    for (const arm of arms) {
      const rs = withChecks.filter((r) => r.arm === arm);
      if (!rs.length) continue;
      out.push('| ' + arm + ' | ' + keys.map((key) => { const v = mean(rs.map((r) => Number(r.task_checks[key]))); return typeof rs[0].task_checks[key] === 'boolean' ? Math.round(v * 100) + '%' : v.toFixed(2); }).join(' | ') + ' |');
    }
  }
  const refs = valid.filter((r) => r.reference_hits);
  if (refs.length) out.push('', 'Sessions with commands that touched the standard library (see raw/): ' + refs.map((r) => r.arm + '#' + r.trial + ' (' + r.reference_hits + ')').join(', ') + '.');
  return out.join('\n') + '\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node bench/analyze-session.js <results-dir> [--base solo] [--md report.md]'); process.exit(2); }
  const bi = args.indexOf('--base'), mi = args.indexOf('--md');
  const md = report(load(dir), bi >= 0 ? args[bi + 1] : 'solo');
  if (mi >= 0) fs.writeFileSync(args[mi + 1], md);
  process.stdout.write(md);
}
module.exports = { report, bootRatio, latest };
