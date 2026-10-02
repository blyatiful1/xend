#!/usr/bin/env node
'use strict';
// Long-session runner. Replays a task's `session` messages as consecutive user turns of ONE Claude
// Code session (stream-json in and out), the way a person works through many independent subtasks
// in one sitting, and records how the main session's context grows, when it compacts, what
// subagents cost, and the hidden-test score at the end.
//
//   node bench/session.js --arms-file arms.json --model claude-sonnet-5-5 --effort medium \
//     --tasks 'session-*' --runs 6 -j 6 --autocompact 200000 --out bench/results/r15-long-session
//
// Arms-file entries take the run.js shape ({label, kind, model, mode, pluginDir, env, args,
// promptSuffix, extraTools}) plus `sessionMode`: "continuous" (default: every message in one
// process) or "clear" (a fresh process per message in the same work dir, the habit of running
// /clear between subtasks). promptSuffix is appended to every message. Jobs run trial-major
// (all arms of trial 1, then trial 2, ...) so time-of-day drift spreads evenly over the arms.
//
// Per run (runs.jsonl): cost (Claude Code reported, subagents included), per-message main-context
// size at the message's last main call and its peak, compactions (compact_boundary events),
// subagents spawned by type, model usage, and the hidden-test score. Main-context size is
// input + cache_read + cache_creation of a main-thread request; subagent requests (those with a
// parent_tool_use_id) are counted separately and never enter it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const run = require('./run.js');

// Host variables a child must not inherit: run.js's list plus the ones that change compaction or
// subagent behaviour in a hosted session.
const EXTRA_STRIP = ['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT', 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', 'CLAUDE_CODE_FORK_SUBAGENT',
  'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_DEBUG', 'CLAUDE_CODE_REMOTE_SESSION_ID'];

function parseArgs(argv) {
  const o = { armsFile: '', model: 'sonnet', effort: 'medium', tasks: 'session-*', runs: 1, concurrency: 2, out: '',
    autocompact: '', toolset: 'local', warmup: true, keep: false, dryRun: false, help: false, messages: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--arms-file') { o.armsFile = v; i++; }
    else if (a === '--model') { o.model = v; i++; }
    else if (a === '--effort') { o.effort = v; i++; }
    else if (a === '--tasks') { o.tasks = v; i++; }
    else if (a === '--runs') { o.runs = Number(v); i++; }
    else if (a === '-j' || a === '--concurrency') { o.concurrency = Number(v); i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--autocompact') { o.autocompact = v; i++; }
    else if (a === '--toolset') { o.toolset = v; i++; }
    else if (a === '--messages') { o.messages = Number(v); i++; }
    else if (a === '--no-warmup') o.warmup = false;
    else if (a === '--keep') o.keep = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else return Object.assign(o, { error: 'unknown argument: ' + a });
  }
  if (!o.help && !o.armsFile) o.error = '--arms-file is required';
  return o;
}

function normalizeSessionArm(a, defaults) {
  const arm = run.normalizeArm(a, defaults);
  arm.sessionMode = a.sessionMode === 'clear' ? 'clear' : 'continuous';
  return arm;
}

// Pure: the claude argument list for one process of a session.
function sessionArgs(task, arm, opts) {
  const ta = run.toolArgs((task.tools || 'Bash,Read,Edit,Write,MultiEdit,Grep,Glob') + (arm.extraTools ? ',' + arm.extraTools : ''), opts.toolset);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', arm.model, '--max-turns', String(task.max_turns || 400), '--max-budget-usd', String(task.budget_usd || 30),
    '--allowedTools', ta.allowedTools, '--strict-mcp-config', '--no-session-persistence'];
  if (ta.tools) args.push('--tools', ta.tools);
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.autocompact) args.push('--autocompact', String(opts.autocompact));
  if (arm.kind === 'xend') args.push('--plugin-dir', arm.pluginDir ? path.resolve(arm.pluginDir) : run.ROOT || path.resolve(__dirname, '..'));
  if (arm.args) args.push(...arm.args);
  return args;
}

function sessionEnv(arm, opts) {
  const env = run.cleanEnv(arm.env || {});
  for (const k of EXTRA_STRIP) if (!(arm.env && k in arm.env)) delete env[k];
  if (arm.kind === 'xend') {
    env.XEND_PROFILE = env.XEND_PROFILE || 'balanced';
    env.XEND_UPSTREAM_PONYTAIL = 'ignore';
    env.XEND_ARCHITECT = arm.mode === 'architect' ? '1' : '0';
    env.XEND_TRUST_TESTS = '1';
  }
  return env;
}

// Pure accounting over the events of one process. `stats` is mutated; `msgIndex` maps the
// process-local turn number to the session-wide message index.
function newStats(nMessages) {
  return { perMessage: Array.from({ length: nMessages }, (_, i) => ({ i, cost: 0, turns: 0, main_calls: 0, sub_calls: 0, ctx_end: 0, ctx_max: 0, spawned: 0, spawned_types: {}, compactions: 0, error: null })),
    compactions: [], seen: new Set(), modelUsage: {}, cost: 0, errors: [] };
}

function accountEvent(stats, e, msgIndex, proc) {
  const pm = stats.perMessage[msgIndex];
  if (!pm) return;
  if (e.type === 'assistant' && e.message) {
    const id = e.message.id || JSON.stringify(e.message.usage) + ':' + (e.parent_tool_use_id || '');
    const fresh = !stats.seen.has(id);
    stats.seen.add(id);
    if (!e.parent_tool_use_id) {
      for (const c of e.message.content || []) {
        if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) {
          pm.spawned++;
          const t = (c.input && c.input.subagent_type) || 'default';
          pm.spawned_types[t] = (pm.spawned_types[t] || 0) + 1;
        }
      }
    }
    if (!fresh) return;
    const u = e.message.usage || {};
    if (e.parent_tool_use_id) { pm.sub_calls++; return; }
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    pm.main_calls++;
    pm.ctx_end = ctx;
    if (ctx > pm.ctx_max) pm.ctx_max = ctx;
  } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
    pm.compactions++;
    const meta = e.compact_metadata || {};
    stats.compactions.push({ message: msgIndex, trigger: meta.trigger || null, pre_tokens: meta.pre_tokens || null });
  } else if (e.type === 'result') {
    // total_cost_usd and modelUsage are cumulative for the process
    const delta = (e.total_cost_usd || 0) - proc.lastCost;
    proc.lastCost = e.total_cost_usd || 0;
    pm.cost += delta;
    pm.turns += e.num_turns || 0;
    if (e.is_error || (e.subtype && e.subtype !== 'success')) pm.error = e.subtype || 'error';
    proc.modelUsage = e.modelUsage || proc.modelUsage;
  }
}

// One claude process fed `messages` one at a time; each next message is written after the
// previous turn's result event. Resolves when the process exits.
function runProcess(messages, firstIndex, args, env, cwd, timeoutMs, stats) {
  return new Promise((resolve) => {
    const p = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const proc = { lastCost: 0, modelUsage: {} };
    let sent = 0, buf = '', stderr = '', done = false;
    const send = () => {
      if (sent >= messages.length) { p.stdin.end(); return; }
      p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: messages[sent] } }) + '\n');
      sent++;
    };
    const timer = setTimeout(() => { stats.errors.push('timeout after ' + timeoutMs + ' ms at message ' + (firstIndex + sent)); p.kill('SIGTERM'); }, timeoutMs);
    p.stdout.on('data', (d) => {
      buf += d;
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n); buf = buf.slice(n + 1);
        let e; try { e = JSON.parse(line); } catch (_) { continue; }
        accountEvent(stats, e, firstIndex + Math.max(0, sent - 1), proc);
        if (e.type === 'result') send();
      }
    });
    p.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    p.stdin.on('error', () => {});
    p.on('close', (code) => {
      if (done) return; done = true;
      clearTimeout(timer);
      stats.cost += proc.lastCost;
      for (const [m, u] of Object.entries(proc.modelUsage || {})) {
        const t = stats.modelUsage[m] || (stats.modelUsage[m] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 });
        for (const k of Object.keys(t)) t[k] += u[k] || 0;
      }
      if (sent < messages.length) stats.errors.push('process exited (' + code + ') after ' + sent + ' of ' + messages.length + ' messages: ' + stderr.slice(-300));
      resolve();
    });
    send();
  });
}

async function runSession(task, arm, opts, work) {
  const messages = task.session.map((m) => (arm.promptSuffix ? m + '\n\n' + arm.promptSuffix : m));
  const stats = newStats(messages.length);
  const args = sessionArgs(task, arm, opts), env = sessionEnv(arm, opts);
  const timeoutMs = (task.timeout_s || 5400) * 1000;
  const started = Date.now();
  if (arm.sessionMode === 'clear') {
    for (let i = 0; i < messages.length; i++) await runProcess([messages[i]], i, args, env, work, Math.ceil(timeoutMs / messages.length) * 2, stats);
  } else {
    await runProcess(messages, 0, args, env, work, timeoutMs, stats);
  }
  return { stats, wall_ms: Date.now() - started, args };
}

function summarize(job, opts, res, test) {
  const { stats } = res;
  const pm = stats.perMessage;
  const tot = run.sumModelUsage(stats.modelUsage);
  const spawnedTypes = {};
  for (const m of pm) for (const [t, c] of Object.entries(m.spawned_types)) spawnedTypes[t] = (spawnedTypes[t] || 0) + c;
  return {
    task: job.task.name, category: job.task.category, arm: job.arm.label, trial: job.trial,
    arm_kind: job.arm.kind, arm_model: job.arm.model, session_mode: job.arm.sessionMode,
    arm_env: job.arm.env || {}, arm_args: job.arm.args || null, arm_prompt_suffix: job.arm.promptSuffix || null,
    effort: opts.effort, autocompact: opts.autocompact || 'auto',
    pass: test.pass, score: test.score, score_passed: test.score_passed, score_total: test.score_total, reason: test.reason,
    cost_usd: stats.cost, wall_ms: res.wall_ms,
    messages: pm.length, messages_errored: pm.filter((m) => m.error).length, errors: stats.errors,
    turns: pm.reduce((s, m) => s + m.turns, 0), main_calls: pm.reduce((s, m) => s + m.main_calls, 0), sub_calls: pm.reduce((s, m) => s + m.sub_calls, 0),
    spawned: pm.reduce((s, m) => s + m.spawned, 0), spawned_types: spawnedTypes,
    compactions: stats.compactions.length, compaction_events: stats.compactions,
    ctx_peak: Math.max(0, ...pm.map((m) => m.ctx_max)), ctx_final: pm.length ? pm[pm.length - 1].ctx_end : 0,
    ctx_by_message: pm.map((m) => m.ctx_end), cost_by_message: pm.map((m) => Math.round(m.cost * 1e5) / 1e5),
    per_message: pm,
    usage_all: tot, model_usage: run.normalizeModelUsage(stats.modelUsage),
    ts: new Date().toISOString(),
  };
}

async function warmup(arm, opts, outDir, workRoot) {
  const task = { session: ['Run the shell command `echo ok` with the Bash tool, then reply with the single word: ok'], max_turns: 3, timeout_s: 180, budget_usd: 1, tools: 'Bash' };
  const work = fs.mkdtempSync(path.join(workRoot, 'warmup-'));
  const res = await runSession(task, Object.assign({}, arm, { sessionMode: 'continuous', promptSuffix: null }), opts, work);
  const tot = run.sumModelUsage(res.stats.modelUsage);
  const w = { arm: arm.label, cache_creation: tot.cache_creation, cache_read: tot.cache_read, cost_usd: res.stats.cost, errors: res.stats.errors };
  fs.appendFileSync(path.join(outDir, 'warmup.jsonl'), JSON.stringify(w) + '\n');
  console.log('warm-up ' + arm.label.padEnd(14) + ' cache_write=' + w.cache_creation + ' cache_read=' + w.cache_read + ' $' + w.cost_usd.toFixed(3) + (w.errors.length ? ' ERR ' + w.errors[0] : ''));
}

async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } });
  await Promise.all(workers);
}

function usage() {
  return 'usage: node bench/session.js --arms-file arms.json [--model m] [--effort e] [--tasks glob] [--runs k] [-j n]\n' +
    '                                [--autocompact tokens] [--messages N] [--out dir] [--toolset local|host] [--no-warmup] [--keep] [--dry-run]';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return; }
  if (opts.error) { console.error(opts.error + '\n' + usage()); process.exit(2); }
  const arms = JSON.parse(fs.readFileSync(opts.armsFile, 'utf8')).map((a) => normalizeSessionArm(a, { model: opts.model }));
  const tasks = run.loadTasks(opts.tasks, '').filter((t) => Array.isArray(t.session) && t.session.length);
  // --messages N: only the first N messages of each session (smoke tests); the score then covers modules not yet attempted
  if (opts.messages > 0) for (const t of tasks) t.session = t.session.slice(0, opts.messages);
  if (!tasks.length) { console.error('no session tasks match ' + opts.tasks); process.exit(2); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(opts.out || path.join(__dirname, 'results', 'session-' + stamp));
  fs.mkdirSync(outDir, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-session-'));
  const jobs = [];
  for (let trial = 1; trial <= opts.runs; trial++) for (const task of tasks) for (const arm of arms) jobs.push({ task, arm, trial });
  fs.writeFileSync(path.join(outDir, 'config.json'), JSON.stringify({ opts, arms, tasks: tasks.map((t) => t.name), claude: run.claudeVersion ? run.claudeVersion() : null, started: new Date().toISOString() }, null, 2));
  fs.writeFileSync(path.join(outDir, 'arms.json'), JSON.stringify(JSON.parse(fs.readFileSync(opts.armsFile, 'utf8')), null, 1));
  console.log('xend session bench: ' + tasks.length + ' task(s) x ' + arms.length + ' arms (' + arms.map((a) => a.label).join(', ') + ') x ' + opts.runs + ' runs = ' + jobs.length + ' sessions; effort=' + opts.effort + ' autocompact=' + (opts.autocompact || 'auto') + ' -> ' + outDir);
  if (opts.dryRun) { for (const j of jobs) console.log(j.trial, j.task.name, j.arm.label, JSON.stringify(sessionArgs(j.task, j.arm, opts))); return; }
  if (opts.warmup) for (const arm of arms) await warmup(arm, opts, outDir, workRoot);
  let finished = 0;
  await pool(jobs, opts.concurrency, async (job) => {
    const work = run.prepareFixture(job.task, workRoot);
    const res = await runSession(job.task, job.arm, opts, work);
    const test = run.runTest(job.task, work, '');
    const rec = summarize(job, opts, res, test);
    fs.appendFileSync(path.join(outDir, 'runs.jsonl'), JSON.stringify(rec) + '\n');
    finished++;
    console.log('[' + String(finished).padStart(3) + '/' + jobs.length + '] ' + job.arm.label.padEnd(12) + ' #' + job.trial + ' score=' + rec.score_passed + '/' + rec.score_total +
      ' $' + rec.cost_usd.toFixed(3) + ' ctx_peak=' + rec.ctx_peak + ' ctx_final=' + rec.ctx_final + ' compactions=' + rec.compactions +
      ' spawned=' + rec.spawned + ' turns=' + rec.turns + ' ' + Math.round(rec.wall_ms / 1000) + 's' + (rec.errors.length ? ' ERR ' + rec.errors[0].slice(0, 120) : ''));
    if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
  });
  console.log('done -> ' + outDir);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseArgs, normalizeSessionArm, sessionArgs, sessionEnv, newStats, accountEvent, summarize, EXTRA_STRIP };
