#!/usr/bin/env node
'use strict';
// Multi-arm benchmark runner: the same tasks under N arms (baseline Claude Code and/or xend,
// any model, xend optionally in architect mode where the main model plans and cheap subagents build).
//   node bench/run.js [--arms baseline,xend] [--runs 1] [--model sonnet] [--effort low]
//                     [--tasks a,b|glob] [--category bugfix] [--concurrency 2] [--max-budget-usd 2]
//                     [--tools Bash,Read,Edit,Write,MultiEdit,Grep,Glob]
//                     [--profile balanced] [--ponytail off|lite|full|ultra] [--ponytail-text adapted|upstream]
//                     [--ponytail-strict] [--arm-env "K=V,K2=V2"] [--out bench/results/<ts>] [--keep] [--dry-run] [--list]
// Each run is a `claude -p` child. Results append to <out>/runs.jsonl; raw JSON per run in <out>/raw/.
//
// --arms accepts either the legacy bare label (`baseline`, `xend` — kind = label, model = --model,
// mode = plain) or the full spec `label:kind:model[:mode]`, e.g.
//   --arms "solo-sonnet:baseline:sonnet,solo-fable:baseline:fable,arch-fable:xend:fable:architect"
// kind is `baseline` (no plugin) or `xend` (adds --plugin-dir + XEND_PROFILE). model overrides the
// global --model for that arm. mode (xend only) is `architect` (XEND_ARCHITECT=1: main model plans,
// subagents build) or `plain` (default, XEND_ARCHITECT=0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(__dirname, 'tasks');
const TOOLS = 'Bash,Read,Edit,Write,MultiEdit,Grep,Glob';

function parseArgs(argv) {
  const o = { arms: ['baseline', 'xend'], runs: 1, model: 'sonnet', effort: 'low', tasks: '*', category: '', concurrency: 2, maxBudget: 2, tools: '', profile: 'balanced', ponytail: '', ponytailText: '', ponytailStrict: false, armEnv: '', out: '', keep: false, dryRun: false, list: false, extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--arms') { o.arms = v.split(','); i++; }
    else if (a === '--runs') { o.runs = Number(v); i++; }
    else if (a === '--model') { o.model = v; i++; }
    else if (a === '--effort') { o.effort = v; i++; }
    else if (a === '--tasks') { o.tasks = v; i++; }
    else if (a === '--category') { o.category = v; i++; }
    else if (a === '--concurrency' || a === '-j') { o.concurrency = Number(v); i++; }
    else if (a === '--max-budget-usd') { o.maxBudget = Number(v); i++; }
    else if (a === '--tools') { o.tools = v; i++; }
    else if (a === '--profile') { o.profile = v; i++; }
    else if (a === '--ponytail') { o.ponytail = v; i++; }
    else if (a === '--ponytail-text') { o.ponytailText = v; i++; }
    else if (a === '--ponytail-strict') o.ponytailStrict = true;
    else if (a === '--arm-env') { o.armEnv = v; i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--keep') o.keep = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--extra') { o.extra.push(v); i++; }
  }
  return o;
}

// Pure: parse one --arms entry. Legacy bare label ("baseline", "xend"): kind = label, model =
// defaults.model, mode = 'plain'. Full spec "label:kind:model[:mode]": mode only takes effect for
// kind === 'xend' ("architect" -> 'architect', anything else/absent -> 'plain').
function parseArm(str, defaults) {
  defaults = defaults || {};
  const parts = String(str).split(':');
  if (parts.length === 1) {
    const label = parts[0];
    return { label, kind: label, model: defaults.model, mode: 'plain' };
  }
  const label = parts[0];
  const kind = parts[1];
  const model = parts[2] || defaults.model;
  const mode = kind === 'xend' && parts[3] === 'architect' ? 'architect' : 'plain';
  return { label, kind, model, mode };
}

// Pure: parse a "K=V,K2=V2" string into a plain object -- extra env vars applied to every
// xend-kind arm (not baseline, which gets no --plugin-dir and so no XEND_* vars at all). Pairs
// split on ",", each pair on its first "=" so a value may itself contain "=". Empty/undefined -> {}.
function parseArmEnv(str) {
  const out = {};
  if (!str) return out;
  for (const pair of String(str).split(',')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    if (!k) continue;
    out[k] = pair.slice(idx + 1);
  }
  return out;
}

function globToRe(g) { return new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); }

function loadTasks(filter, category) {
  const names = fs.existsSync(TASKS_DIR) ? fs.readdirSync(TASKS_DIR).filter((d) => fs.existsSync(path.join(TASKS_DIR, d, 'task.json'))).sort() : [];
  const wanted = filter.includes(',') ? new Set(filter.split(',')) : null;
  const re = wanted ? null : globToRe(filter);
  return names.filter((n) => (wanted ? wanted.has(n) : re.test(n))).map((n) => {
    const t = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, n, 'task.json'), 'utf8'));
    t.name = t.name || n; t.dir = path.join(TASKS_DIR, n);
    return t;
  }).filter((t) => !category || t.category === category);
}

function prepareFixture(task, workRoot) {
  const work = fs.mkdtempSync(path.join(workRoot, task.name + '-'));
  fs.cpSync(path.join(task.dir, 'fixture'), work, { recursive: true });
  const gen = path.join(work, 'gen.sh');
  if (fs.existsSync(gen)) {
    execFileSync('bash', [gen], { cwd: work, stdio: 'ignore', timeout: 30000 });
    fs.unlinkSync(gen);
  }
  return work;
}

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra);
  // The baseline arm is structurally immune (it gets no --plugin-dir), so an ambient export
  // — or an upstream ponytail install on the operator's machine — would contaminate one side
  // only and look like a real effect.
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'XEND_PROFILE', 'XEND_TERSE', 'XEND_SHAPE',
    'XEND_PONYTAIL', 'XEND_PONYTAIL_TEXT', 'XEND_UPSTREAM_PONYTAIL', 'XEND_PONYTAIL_STRICT', 'PONYTAIL_DEFAULT_MODE', 'XEND_ARCHITECT']) delete env[k];
  return Object.assign(env, extra);
}

function runClaude(task, arm, opts, work, stateDir) {
  const tools = opts.tools || task.tools || TOOLS;
  const budget = task.budget_usd != null ? task.budget_usd : opts.maxBudget;
  const args = ['-p', task.prompt, '--model', arm.model, '--max-turns', String(task.max_turns || 40),
    '--max-budget-usd', String(budget), '--output-format', 'json', '--allowedTools', tools,
    '--strict-mcp-config', '--no-session-persistence'];
  if (opts.effort) args.push('--effort', opts.effort);
  if (arm.kind === 'xend') args.push('--plugin-dir', ROOT);
  for (const e of opts.extra) args.push(...e.split(' '));
  const extraEnv = { XEND_STATE_DIR: stateDir };
  if (arm.kind === 'xend') {
    extraEnv.XEND_PROFILE = opts.profile;
    // never let a benchmark depend on what happens to be installed on the runner
    extraEnv.XEND_UPSTREAM_PONYTAIL = 'ignore';
    if (opts.ponytail) extraEnv.XEND_PONYTAIL = opts.ponytail;
    if (opts.ponytailText) extraEnv.XEND_PONYTAIL_TEXT = opts.ponytailText;
    if (opts.ponytailStrict) extraEnv.XEND_PONYTAIL_STRICT = '1';
    extraEnv.XEND_ARCHITECT = arm.mode === 'architect' ? '1' : '0';
    Object.assign(extraEnv, opts.arm_env);
  }
  return new Promise((resolve) => {
    const started = Date.now();
    execFile('claude', args, { cwd: work, env: cleanEnv(extraEnv), timeout: (task.timeout_s || 600) * 1000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let json = null;
        try { json = JSON.parse(stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() || 'null'); } catch (_) { json = null; }
        resolve({ json, stdout, stderr, err, wall_ms: Date.now() - started, args });
      });
  });
}

// Pure: find a `SCORE: passed/total` line (anywhere, any line) in test.sh output. Returns
// { passed, total } or null. total === 0 is treated as "no score" (avoids a divide-by-zero score).
function parseScore(text) {
  const m = /^SCORE:\s*(\d+)\s*\/\s*(\d+)/m.exec(text || '');
  if (!m) return null;
  const total = Number(m[2]);
  if (!total) return null;
  return { passed: Number(m[1]), total };
}

function runTest(task, work, answer) {
  if (task.category === 'qa') fs.writeFileSync(path.join(work, '.xend_answer.txt'), answer || '');
  const r = spawnSync('bash', [path.join(task.dir, 'test.sh')], { cwd: work, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const stdout = r.stdout || '', stderr = r.stderr || '';
  const pass = !r.error && r.status === 0 ? 1 : 0;
  const reason = ((pass ? stdout : stdout + ' ' + stderr).trim() || (r.error ? String(r.error.message) : '')).slice(0, 300);
  const out = { pass, reason };
  const scored = parseScore(stdout + '\n' + stderr);
  if (scored) { out.score = scored.passed / scored.total; out.score_passed = scored.passed; out.score_total = scored.total; }
  else out.score = pass;
  return out;
}

function shapingSummary(stateDir) {
  const s = { count: 0, before: 0, after: 0, kinds: {} };
  let dirs = [];
  try { dirs = fs.readdirSync(stateDir); } catch (_) { return s; }
  for (const d of dirs) {
    const f = path.join(stateDir, d, 'shaping.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        s.count++; s.before += r.before || 0; s.after += r.after || 0;
        for (const k of r.kinds || []) { const key = k.split(':')[0]; s.kinds[key] = (s.kinds[key] || 0) + 1; }
      } catch (_) {}
    }
  }
  return s;
}

function sumModelUsage(mu) {
  const t = { input: 0, cache_creation: 0, cache_read: 0, output: 0, cost: 0 };
  for (const m of Object.values(mu || {})) {
    t.input += m.inputTokens || 0; t.cache_creation += m.cacheCreationInputTokens || 0;
    t.cache_read += m.cacheReadInputTokens || 0; t.output += m.outputTokens || 0; t.cost += m.costUSD || 0;
  }
  return t;
}

// modelUsage as returned by `claude -p --output-format json` (keyed by model id, camelCase fields)
// normalized to the snake_case shape we record ({ input, cache_creation, cache_read, output, cost }).
function normalizeModelUsage(mu) {
  const out = {};
  for (const [k, m] of Object.entries(mu || {})) {
    out[k] = { input: m.inputTokens || 0, cache_creation: m.cacheCreationInputTokens || 0, cache_read: m.cacheReadInputTokens || 0, output: m.outputTokens || 0, cost: m.costUSD || 0 };
  }
  return out;
}

// Pure: split total cost between the arm's main model and everything else (subagents). modelUsage
// is the normalized { [modelId]: { ..., cost } } shape (see normalizeModelUsage). The main model is
// the key that contains the arm's model alias (haiku/sonnet/opus/fable) or equals it exactly; if no
// key matches, the model with the highest cost is treated as main.
function splitCost(modelUsage, armModel) {
  const entries = Object.entries(modelUsage || {});
  const result = { cost_main_usd: 0, cost_sub_usd: 0, main_model: null };
  if (!entries.length) return result;
  const alias = armModel ? String(armModel).toLowerCase() : '';
  let mainKey = null;
  for (const [k] of entries) {
    if (k === armModel || (alias && k.toLowerCase().includes(alias))) { mainKey = k; break; }
  }
  if (!mainKey) {
    let best = entries[0];
    for (const e of entries) if ((e[1].cost || 0) > (best[1].cost || 0)) best = e;
    mainKey = best[0];
  }
  for (const [k, v] of entries) {
    if (k === mainKey) result.cost_main_usd += v.cost || 0;
    else result.cost_sub_usd += v.cost || 0;
  }
  result.main_model = mainKey;
  return result;
}

async function runJob(job, opts, outDir, workRoot) {
  const { task, arm, trial } = job;
  const stateDir = path.join(outDir, 'state', task.name + '-' + arm.label + '-' + trial);
  fs.mkdirSync(stateDir, { recursive: true });
  const work = prepareFixture(task, workRoot);
  const r = await runClaude(task, arm, opts, work, stateDir);
  const j = r.json || {};
  const u = j.usage || {};
  const all = sumModelUsage(j.modelUsage);
  const modelUsage = j.modelUsage ? normalizeModelUsage(j.modelUsage) : null;
  const split = splitCost(modelUsage || {}, arm.model);
  const test = runTest(task, work, j.result || '');
  const rec = {
    task: task.name, category: task.category, difficulty: task.difficulty, arm: arm.label, trial,
    arm_kind: arm.kind, arm_model: arm.model, arm_mode: arm.mode,
    pass: test.pass, reason: test.reason,
    score: test.score,
    is_error: !!(j.is_error || r.err), subtype: j.subtype || (r.err ? 'spawn_error' : 'unknown'),
    num_turns: j.num_turns || 0, duration_ms: j.duration_ms || r.wall_ms, wall_ms: r.wall_ms,
    cost_usd: j.total_cost_usd || 0,
    cost_main_usd: split.cost_main_usd, cost_sub_usd: split.cost_sub_usd,
    usage: { input: u.input_tokens || 0, cache_creation: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 },
    usage_all: all,
    total_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0),
    total_tokens_all: all.input + all.cache_creation + all.cache_read + all.output,
    uncached_input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    models: Object.keys(j.modelUsage || {}),
    model_usage: modelUsage,
    subagent_stats: j.subagent_stats || null,
    shaping: shapingSummary(stateDir),
    model: arm.model, effort: opts.effort, profile: arm.kind === 'xend' ? opts.profile : null,
    ponytail: arm.kind === 'xend' ? (opts.ponytail || null) : null,
    ponytail_text: arm.kind === 'xend' && opts.ponytail !== 'off' ? (opts.ponytailText || null) : null,
    ponytail_strict: arm.kind === 'xend' ? !!opts.ponytailStrict : false,
    arm_env: opts.arm_env || {},
    answer_chars: (j.result || '').length,
    ts: new Date().toISOString(),
  };
  if (test.score_total != null) { rec.score_passed = test.score_passed; rec.score_total = test.score_total; }
  const rawDir = path.join(outDir, 'raw'); fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, task.name + '-' + arm.label + '-' + trial + '.json'), JSON.stringify({ result: j, stderr: (r.stderr || '').slice(0, 4000), err: r.err ? String(r.err.message) : null, args: r.args }, null, 2));
  fs.appendFileSync(path.join(outDir, 'runs.jsonl'), JSON.stringify(rec) + '\n');
  if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
  return rec;
}

async function pool(jobs, n, fn) {
  const results = []; let i = 0;
  async function worker() { while (i < jobs.length) { const idx = i++; results[idx] = await fn(jobs[idx], idx); } }
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.arm_env = parseArmEnv(opts.armEnv); // parsed once; applied to every xend-kind arm
  const tasks = loadTasks(opts.tasks, opts.category);
  if (opts.list) {
    for (const t of tasks) {
      let line = t.name.padEnd(24) + t.category.padEnd(12) + 'd' + t.difficulty + '  ' + t.prompt.slice(0, 70).replace(/\n/g, ' ');
      if (t.tools) line += '  tools=' + t.tools;
      if (t.budget_usd != null) line += '  budget_usd=' + t.budget_usd;
      console.log(line);
    }
    return;
  }
  if (!tasks.length) { console.error('no tasks matched'); process.exit(1); }
  const armSpecs = opts.arms.map((s) => parseArm(s, { model: opts.model }));
  // absolute: hooks run with cwd = the fixture copy, and XEND_STATE_DIR must not resolve relative to it
  const outDir = path.resolve(opts.out || path.join(__dirname, 'results', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
  fs.mkdirSync(outDir, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-bench-'));
  const jobs = [];
  for (let trial = 1; trial <= opts.runs; trial++) for (const task of tasks) for (const arm of armSpecs) jobs.push({ task, arm, trial });
  fs.writeFileSync(path.join(outDir, 'config.json'), JSON.stringify({ opts, arms: armSpecs, tasks: tasks.map((t) => t.name), claude_version: claudeVersion(), started: new Date().toISOString() }, null, 2));
  console.log('xend bench: ' + tasks.length + ' tasks x ' + armSpecs.length + ' arms (' + armSpecs.map((a) => a.label).join(', ') + ') x ' + opts.runs + ' runs = ' + jobs.length + ' jobs; effort=' + opts.effort + ' -> ' + outDir);
  if (opts.dryRun) {
    for (const j of jobs) console.log('  ' + j.task.name + ' ' + j.arm.label + ' (' + j.arm.kind + ':' + j.arm.model + (j.arm.kind === 'xend' ? ':' + j.arm.mode : '') + ') #' + j.trial);
    if (Object.keys(opts.arm_env).length) console.log('arm-env (applied to xend-kind arms): ' + JSON.stringify(opts.arm_env));
    return;
  }
  let done = 0;
  await pool(jobs, opts.concurrency, async (job) => {
    const rec = await runJob(job, opts, outDir, workRoot);
    done++;
    let line = '[' + String(done).padStart(3) + '/' + jobs.length + '] ' + rec.task.padEnd(22) + rec.arm.padEnd(14) + rec.arm_model.padEnd(8) + '#' + rec.trial + ' pass=' + rec.pass;
    if (rec.score_total != null) line += ' score=' + rec.score.toFixed(2);
    line += ' turns=' + String(rec.num_turns).padStart(3) + ' tokens=' + String(rec.total_tokens).padStart(7) + ' out=' + String(rec.usage.output).padStart(6) + ' $' + rec.cost_usd.toFixed(3) + ' ' + Math.round(rec.wall_ms / 1000) + 's';
    if (rec.subagent_stats) line += ' sub=' + (rec.subagent_stats.spawned != null ? rec.subagent_stats.spawned : 0);
    if (rec.is_error) line += ' ERROR ' + rec.subtype;
    if (!rec.pass) line += ' | ' + rec.reason.split('\n')[0].slice(0, 80);
    console.log(line);
    return rec;
  });
  if (!opts.keep) fs.rmSync(workRoot, { recursive: true, force: true });
  console.log('done -> ' + outDir + '\nanalyze: node bench/analyze.js ' + outDir);
}

function claudeVersion() { try { return execFileSync('claude', ['--version'], { timeout: 10000 }).toString().trim(); } catch (_) { return 'unknown'; } }

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { loadTasks, sumModelUsage, normalizeModelUsage, shapingSummary, parseArgs, parseArm, parseScore, splitCost, parseArmEnv };
