#!/usr/bin/env node
'use strict';
// Paired A/B benchmark runner: the same tasks under a baseline Claude Code and under xend.
//   node bench/run.js [--arms baseline,xend] [--runs 1] [--model sonnet] [--effort low]
//                     [--tasks a,b|glob] [--category bugfix] [--concurrency 2] [--max-budget-usd 2]
//                     [--profile balanced] [--out bench/results/<ts>] [--keep] [--dry-run] [--list]
// Each run is a `claude -p` child. Results append to <out>/runs.jsonl; raw JSON per run in <out>/raw/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(__dirname, 'tasks');
const TOOLS = 'Bash,Read,Edit,Write,MultiEdit,Grep,Glob';

function parseArgs(argv) {
  const o = { arms: ['baseline', 'xend'], runs: 1, model: 'sonnet', effort: 'low', tasks: '*', category: '', concurrency: 2, maxBudget: 2, profile: 'balanced', out: '', keep: false, dryRun: false, list: false, extra: [] };
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
    else if (a === '--profile') { o.profile = v; i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--keep') o.keep = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--extra') { o.extra.push(v); i++; }
  }
  return o;
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
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'XEND_PROFILE', 'XEND_TERSE', 'XEND_SHAPE']) delete env[k];
  return Object.assign(env, extra);
}

function runClaude(task, arm, opts, work, stateDir) {
  const args = ['-p', task.prompt, '--model', opts.model, '--max-turns', String(task.max_turns || 40),
    '--max-budget-usd', String(opts.maxBudget), '--output-format', 'json', '--allowedTools', TOOLS,
    '--strict-mcp-config', '--no-session-persistence'];
  if (opts.effort) args.push('--effort', opts.effort);
  if (arm === 'xend') args.push('--plugin-dir', ROOT);
  for (const e of opts.extra) args.push(...e.split(' '));
  const extraEnv = { XEND_STATE_DIR: stateDir };
  if (arm === 'xend') extraEnv.XEND_PROFILE = opts.profile;
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

function runTest(task, work, answer) {
  if (task.category === 'qa') fs.writeFileSync(path.join(work, '.xend_answer.txt'), answer || '');
  try {
    const out = execFileSync('bash', [path.join(task.dir, 'test.sh')], { cwd: work, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { pass: 1, reason: String(out).trim().slice(0, 300) };
  } catch (e) {
    const msg = ((e.stdout ? String(e.stdout) : '') + ' ' + (e.stderr ? String(e.stderr) : '')).trim();
    return { pass: 0, reason: (msg || String(e.message)).slice(0, 300) };
  }
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

async function runJob(job, opts, outDir, workRoot) {
  const { task, arm, trial } = job;
  const stateDir = path.join(outDir, 'state', task.name + '-' + arm + '-' + trial);
  fs.mkdirSync(stateDir, { recursive: true });
  const work = prepareFixture(task, workRoot);
  const r = await runClaude(task, arm, opts, work, stateDir);
  const j = r.json || {};
  const u = j.usage || {};
  const all = sumModelUsage(j.modelUsage);
  const test = runTest(task, work, j.result || '');
  const rec = {
    task: task.name, category: task.category, difficulty: task.difficulty, arm, trial,
    pass: test.pass, reason: test.reason,
    is_error: !!(j.is_error || r.err), subtype: j.subtype || (r.err ? 'spawn_error' : 'unknown'),
    num_turns: j.num_turns || 0, duration_ms: j.duration_ms || r.wall_ms, wall_ms: r.wall_ms,
    cost_usd: j.total_cost_usd || 0,
    usage: { input: u.input_tokens || 0, cache_creation: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 },
    usage_all: all,
    total_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0),
    total_tokens_all: all.input + all.cache_creation + all.cache_read + all.output,
    uncached_input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    models: Object.keys(j.modelUsage || {}),
    shaping: shapingSummary(stateDir),
    model: opts.model, effort: opts.effort, profile: arm === 'xend' ? opts.profile : null,
    answer_chars: (j.result || '').length,
    ts: new Date().toISOString(),
  };
  const rawDir = path.join(outDir, 'raw'); fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, task.name + '-' + arm + '-' + trial + '.json'), JSON.stringify({ result: j, stderr: (r.stderr || '').slice(0, 4000), err: r.err ? String(r.err.message) : null, args: r.args }, null, 2));
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
  const tasks = loadTasks(opts.tasks, opts.category);
  if (opts.list) { for (const t of tasks) console.log(t.name.padEnd(24) + t.category.padEnd(12) + 'd' + t.difficulty + '  ' + t.prompt.slice(0, 70).replace(/\n/g, ' ')); return; }
  if (!tasks.length) { console.error('no tasks matched'); process.exit(1); }
  // absolute: hooks run with cwd = the fixture copy, and XEND_STATE_DIR must not resolve relative to it
  const outDir = path.resolve(opts.out || path.join(__dirname, 'results', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
  fs.mkdirSync(outDir, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-bench-'));
  const jobs = [];
  for (let trial = 1; trial <= opts.runs; trial++) for (const task of tasks) for (const arm of opts.arms) jobs.push({ task, arm, trial });
  fs.writeFileSync(path.join(outDir, 'config.json'), JSON.stringify({ opts, tasks: tasks.map((t) => t.name), claude_version: claudeVersion(), started: new Date().toISOString() }, null, 2));
  console.log('xend bench: ' + tasks.length + ' tasks x ' + opts.arms.length + ' arms x ' + opts.runs + ' runs = ' + jobs.length + ' jobs; model=' + opts.model + ' effort=' + opts.effort + ' -> ' + outDir);
  if (opts.dryRun) { for (const j of jobs) console.log('  ' + j.task.name + ' ' + j.arm + ' #' + j.trial); return; }
  let done = 0;
  await pool(jobs, opts.concurrency, async (job) => {
    const rec = await runJob(job, opts, outDir, workRoot);
    done++;
    console.log('[' + String(done).padStart(3) + '/' + jobs.length + '] ' + rec.task.padEnd(22) + rec.arm.padEnd(9) + '#' + rec.trial + ' pass=' + rec.pass + ' turns=' + String(rec.num_turns).padStart(3) + ' tokens=' + String(rec.total_tokens).padStart(7) + ' out=' + String(rec.usage.output).padStart(6) + ' $' + rec.cost_usd.toFixed(3) + ' ' + Math.round(rec.wall_ms / 1000) + 's' + (rec.is_error ? ' ERROR ' + rec.subtype : '') + (rec.pass ? '' : ' | ' + rec.reason.split('\n')[0].slice(0, 80)));
    return rec;
  });
  if (!opts.keep) fs.rmSync(workRoot, { recursive: true, force: true });
  console.log('done -> ' + outDir + '\nanalyze: node bench/analyze.js ' + outDir);
}

function claudeVersion() { try { return execFileSync('claude', ['--version'], { timeout: 10000 }).toString().trim(); } catch (_) { return 'unknown'; } }

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { loadTasks, sumModelUsage, shapingSummary, parseArgs };
