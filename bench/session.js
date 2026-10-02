#!/usr/bin/env node
'use strict';
// Long-session runner. Replays a task's `session` messages as consecutive user turns of ONE Claude
// Code session (stream-json in and out), the way a person works through many independent subtasks
// in one sitting, and records how the main session's context grows, when it compacts, what
// subagents cost, and which subtasks the hidden tests say were done.
//
//   node bench/session.js --arms-file arms.json --model claude-sonnet-5-5 --effort medium \
//     --tasks 'session-*' --runs 6 -j 6 --autocompact 100000 --out bench/results/r15-long-session
//
// Arms-file entries take the run.js shape ({label, kind, model, mode, pluginDir, env, args,
// promptSuffix, extraTools}) plus `sessionMode`: "continuous" (default: every message in one
// process) or "clear" (a fresh process per message in the same work dir, the habit of running
// /clear between subtasks). promptSuffix is appended to every message. Jobs run trial-major (all
// arms of trial 1, then trial 2, ...) so drift over the run spreads evenly over the arms.
//
// Measurement rules (each one fixes a defect found by an adversarial review before r15):
// - A child gets an allowlisted environment (PATH, HOME, proxy and CA variables), never the hosting
//   session's: a hosted session exports MAX_THINKING_TOKENS, background-task and compaction overrides
//   that would change what every arm does.
// - Subagents run in the foreground (CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 unless an arm sets it):
//   by default an Agent call returns at launch, the turn's result arrives before the subtask is done,
//   and the next message would be sent while the subagent still works. The next message is also held
//   while the last result's subagent_stats shows a subagent still running.
// - Main-context size is input + cache_read + cache_creation of a main-thread request (no
//   parent_tool_use_id); synthetic messages (API-error notices, model "<synthetic>") are skipped.
//   Subagent requests are metered separately, per message. Cost per message is exact (deltas of the
//   cumulative result totals); its subagent share is estimated from the streamed per-call usage,
//   which undercounts output tokens. Claude Code emits no autocompact_state event in this mode, so
//   the compaction threshold shows only as pre_tokens on each compact_boundary.
// - Every stdout line, runner marker and stderr chunk is kept, gzipped, in <out>/raw/, with the
//   hidden-test output, so any number here can be recomputed and any surprise checked afterwards.
// - A rate limit, an API error, a crash, a timeout or a stall marks the session incomplete or
//   invalid instead of passing as a cheap, low-scoring run; a usage-limit rejection stops new jobs.
// - Quality is per subtask: each hidden test file runs on its own, and a module counts as fixed when
//   every one of its hidden tests passes (73 of 131 tests pass before any fix, so the total alone
//   says little).

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');
const run = require('./run.js');

const PRICES = { // USD per token, list prices; used only for the main/subagent split, never for cost_usd
  'claude-sonnet-5-5': { in: 2e-6, w1h: 4e-6, w5m: 2.5e-6, r: 0.2e-6, out: 10e-6 },
  'claude-haiku-4-5': { in: 1e-6, w1h: 2e-6, w5m: 1.25e-6, r: 0.1e-6, out: 5e-6 },
};
const ENV_ALLOW = ['PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'USER', 'TMPDIR', 'TZ',
  'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy', 'GLOBAL_AGENT_HTTPS_PROXY', 'GLOBAL_AGENT_NO_PROXY',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'PIP_CERT', 'GIT_SSL_CAINFO'];
const STALL_MS = 15 * 60 * 1000;
const STDLIB_RE = /\/usr\/lib\/python|sysconfig|site-packages|inspect\.getsource|\bimport\s+(textwrap|difflib|statistics|fractions|shlex|calendar|ipaddress|configparser|argparse|pprint|plistlib|fnmatch|_?pydecimal|decimal|heapq|graphlib)\b|from\s+(urllib|textwrap|difflib|statistics|fractions|shlex|calendar|ipaddress|configparser|argparse|pprint|plistlib|fnmatch|_pydecimal|decimal|heapq|graphlib)\b|urllib\.parse/;

function parseArgs(argv) {
  const o = { armsFile: '', model: 'sonnet', effort: 'medium', tasks: 'session-*', runs: 1, concurrency: 2, out: '',
    autocompact: '', toolset: 'local', warmup: true, keep: false, dryRun: false, help: false, messages: 0, resume: false };
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
    else if (a === '--resume') o.resume = true;
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
  if (arm.kind === 'xend') args.push('--plugin-dir', arm.pluginDir ? path.resolve(arm.pluginDir) : run.ROOT);
  if (arm.args) args.push(...arm.args);
  return args;
}

// Pure (given a source env): the child's environment, built from an allowlist, never inherited.
function sessionEnv(arm, source) {
  source = source || process.env;
  const env = {};
  for (const k of ENV_ALLOW) if (source[k] != null) env[k] = source[k];
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
  if (arm.kind === 'xend') Object.assign(env, { XEND_PROFILE: 'balanced', XEND_UPSTREAM_PONYTAIL: 'ignore', XEND_ARCHITECT: arm.mode === 'architect' ? '1' : '0', XEND_TRUST_TESTS: '1' });
  return Object.assign(env, arm.env || {});
}

function emptyMeter() { return { input: 0, cache_read: 0, cache_write_1h: 0, cache_write_5m: 0, output: 0, calls: 0 }; }
function addUsage(m, u) {
  const cc = u.cache_creation || {};
  const w = u.cache_creation_input_tokens || 0;
  const w1h = cc.ephemeral_1h_input_tokens != null ? cc.ephemeral_1h_input_tokens : 0;
  const w5m = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, w - w1h);
  m.input += u.input_tokens || 0; m.cache_read += u.cache_read_input_tokens || 0;
  m.cache_write_1h += w1h; m.cache_write_5m += w5m; m.output += u.output_tokens || 0; m.calls++;
}
function priceMeters(meters) { // {model: meter} -> USD at list prices
  let usd = 0;
  for (const [model, m] of Object.entries(meters)) {
    const p = PRICES[Object.keys(PRICES).find((k) => model.startsWith(k))] || PRICES['claude-sonnet-5-5'];
    usd += m.input * p.in + m.cache_read * p.r + m.cache_write_1h * p.w1h + m.cache_write_5m * p.w5m + m.output * p.out;
  }
  return usd;
}

function newStats(nMessages) {
  return {
    perMessage: Array.from({ length: nMessages }, (_, i) => ({ i, cost: 0, turns: 0, results: 0, ctx_end: 0, ctx_max: 0, ctx_after_compact: null,
      main: {}, sub: {}, spawned: 0, spawned_types: {}, compactions: 0, error: null, api_retries: 0, t_start: null, t_end: null, reply: '' })),
    compactions: [], seen: new Set(), modelUsage: {}, cost: 0, errors: [], autocompact: [], rateLimit: { max_utilization: null, statuses: {} },
    subagentStats: [], invalid: null, answered: 0, processes: 0, exits: [],
  };
}

// Pure accounting of one stream-json event. `idx` is the session-wide message index the event
// belongs to (the message whose answer is still pending).
function accountEvent(stats, e, idx, proc) {
  const pm = stats.perMessage[idx];
  if (!pm) return;
  if (e.type === 'assistant' && e.message) {
    const msg = e.message, u = msg.usage || {};
    const synthetic = msg.model === '<synthetic>' || (!(u.input_tokens || u.cache_read_input_tokens || u.cache_creation_input_tokens || u.output_tokens));
    if (!e.parent_tool_use_id) {
      for (const c of msg.content || []) {
        if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task')) {
          pm.spawned++;
          const t = (c.input && c.input.subagent_type) || 'default';
          pm.spawned_types[t] = (pm.spawned_types[t] || 0) + 1;
        }
        if (c.type === 'text' && c.text) pm.reply = (pm.reply + c.text).slice(-600);
      }
    }
    const id = (msg.id || '') + ':' + (e.parent_tool_use_id || '');
    if (synthetic || stats.seen.has(id)) return;
    stats.seen.add(id);
    const bucket = e.parent_tool_use_id ? pm.sub : pm.main;
    const model = msg.model || 'unknown';
    addUsage(bucket[model] || (bucket[model] = emptyMeter()), u);
    if (e.parent_tool_use_id) return;
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    pm.ctx_end = ctx;
    if (ctx > pm.ctx_max) pm.ctx_max = ctx;
    if (proc.pendingCompact) { proc.pendingCompact.ctx_after = ctx; if (pm.ctx_after_compact == null) pm.ctx_after_compact = ctx; proc.pendingCompact = null; }
  } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
    if (e.parent_tool_use_id) return; // a subagent compacting its own context is not the main session's
    pm.compactions++;
    const meta = e.compact_metadata || {};
    const c = { message: idx, trigger: meta.trigger || null, pre_tokens: meta.pre_tokens || null, post_tokens: meta.post_tokens || null, ctx_after: null };
    stats.compactions.push(c);
    proc.pendingCompact = c;
  } else if (e.type === 'system' && e.subtype === 'api_retry') {
    pm.api_retries++;
  } else if (e.type === 'autocompact_state') {
    if (stats.autocompact.length < 4) stats.autocompact.push(Object.assign({ message: idx }, e.value || {}));
  } else if (e.type === 'rate_limit_event') {
    const info = e.rate_limit_info || {};
    if (info.status) stats.rateLimit.statuses[info.status] = (stats.rateLimit.statuses[info.status] || 0) + 1;
    if (typeof info.utilization === 'number') stats.rateLimit.max_utilization = Math.max(stats.rateLimit.max_utilization || 0, info.utilization);
    if (info.status === 'rejected') stats.invalid = stats.invalid || 'rate_limit_rejected';
  } else if (e.type === 'result') {
    const delta = (e.total_cost_usd || 0) - proc.lastCost; // cumulative per process
    proc.lastCost = e.total_cost_usd || 0;
    pm.cost += delta;
    pm.turns += e.num_turns || 0;
    pm.results++;
    proc.modelUsage = e.modelUsage || proc.modelUsage;
    if (e.subagent_stats) proc.subagentStats = e.subagent_stats;
    if (e.is_error) {
      const text = String(e.result || (e.errors || []).join('; ') || '').slice(0, 400);
      pm.error = (e.api_error_status ? 'api_' + e.api_error_status : e.subtype || 'error') + (text ? ': ' + text : '');
      if (e.api_error_status === 429 || e.api_error_status === 529 || /usage limit|rate limit|overloaded/i.test(text)) stats.invalid = stats.invalid || 'api_error:' + (e.api_error_status || 'limit');
    }
  }
}

// Number of subagents still running according to a result's subagent_stats.
function runningSubagents(s) {
  if (!s) return 0;
  const k = s.killed || {};
  return Math.max(0, (s.spawned || 0) - (s.completed || 0) - (s.failed || 0) - (k.parent || 0) - (k.user || 0) - (k.system || 0));
}

const LIVE = new Set();
function killGroup(p, sig) { try { process.kill(-p.pid, sig); } catch (_) { try { p.kill(sig); } catch (__) {} } }

// One claude process fed `messages` one at a time: the next message is written only after a
// user-turn result with no subagent still running.
function runProcess(messages, firstIndex, args, env, cwd, timeoutMs, stats, raw) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); }
    catch (err) { stats.errors.push('spawn failed: ' + err.message); resolve(); return; }
    LIVE.add(p);
    stats.processes++;
    const proc = { lastCost: 0, modelUsage: {}, subagentStats: null, pendingCompact: null };
    let sent = 0, answered = 0, buf = '', stderr = '', finished = false, lastOut = Date.now();
    const mark = (o) => raw.write(JSON.stringify(Object.assign({ _runner: true, ts: Date.now(), proc: stats.processes }, o)) + '\n');
    const send = () => {
      if (sent >= messages.length) { try { p.stdin.end(); } catch (_) {} return; }
      const i = firstIndex + sent;
      stats.perMessage[i].t_start = Date.now();
      mark({ event: 'send', i });
      p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: messages[sent] } }) + '\n');
      sent++;
    };
    const finish = (why) => {
      if (finished) return; finished = true;
      clearTimeout(timer); clearInterval(watch);
      LIVE.delete(p);
      stats.cost += proc.lastCost;
      for (const [m, u] of Object.entries(proc.modelUsage || {})) {
        const t = stats.modelUsage[m] || (stats.modelUsage[m] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 });
        for (const k of Object.keys(t)) t[k] += u[k] || 0;
      }
      if (proc.subagentStats) stats.subagentStats.push(proc.subagentStats);
      stats.answered += answered;
      if (answered < messages.length) {
        stats.errors.push((why || 'process exited') + ' after ' + answered + ' of ' + messages.length + ' answered: ' + stderr.slice(-400));
        for (let k = answered; k < messages.length; k++) if (!stats.perMessage[firstIndex + k].error) stats.perMessage[firstIndex + k].error = 'no_result';
      }
      mark({ event: 'exit', why: why || null, answered, stderr_tail: stderr.slice(-4000) });
      resolve();
    };
    const timer = setTimeout(() => { stats.invalid = stats.invalid || 'timeout'; killGroup(p, 'SIGTERM'); setTimeout(() => killGroup(p, 'SIGKILL'), 20000); finish('timeout after ' + timeoutMs + ' ms'); }, timeoutMs);
    const watch = setInterval(() => { if (Date.now() - lastOut > STALL_MS) { stats.invalid = stats.invalid || 'stalled'; killGroup(p, 'SIGTERM'); setTimeout(() => killGroup(p, 'SIGKILL'), 20000); finish('stalled: no output for ' + STALL_MS + ' ms'); } }, 30000);
    p.on('error', (err) => { stats.errors.push('child error: ' + err.message); finish('child error'); });
    p.stdin.on('error', () => {});
    p.stdout.on('data', (d) => {
      lastOut = Date.now();
      buf += d;
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n); buf = buf.slice(n + 1);
        if (!line.trim()) continue;
        raw.write(line + '\n');
        let e; try { e = JSON.parse(line); } catch (_) { continue; }
        const idx = firstIndex + Math.min(answered, messages.length - 1);
        accountEvent(stats, e, idx, proc);
        if (e.type === 'result') {
          const notification = e.origin && e.origin.kind === 'task-notification';
          if (runningSubagents(e.subagent_stats) > 0 || (e.queued_turn_count || 0) > 0) { mark({ event: 'hold', i: idx, running: runningSubagents(e.subagent_stats) }); continue; }
          if (!notification || answered < sent) {
            stats.perMessage[idx].t_end = Date.now();
            answered++;
            if (stats.invalid && stats.invalid.startsWith('rate_limit')) { try { p.stdin.end(); } catch (_) {} continue; }
            send();
          }
        }
      }
    });
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); raw.write(JSON.stringify({ _stderr: String(d).slice(0, 4000) }) + '\n'); });
    p.on('exit', (code, signal) => { stats.exits.push({ code, signal }); setTimeout(() => finish(code === 0 && !signal ? null : 'exit code ' + code + (signal ? ' signal ' + signal : '')), 5000); });
    p.on('close', (code, signal) => finish(code === 0 && !signal ? null : 'exit code ' + code + (signal ? ' signal ' + signal : '')));
    send();
  });
}

async function runSession(task, arm, opts, work, rawPath) {
  const messages = task.session.map((m) => (arm.promptSuffix ? m + '\n\n' + arm.promptSuffix : m));
  const stats = newStats(messages.length);
  const args = sessionArgs(task, arm, opts), env = sessionEnv(arm);
  const timeoutMs = (task.timeout_s || 5400) * 1000;
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  const gz = zlib.createGzip();
  const out = fs.createWriteStream(rawPath);
  gz.pipe(out);
  const raw = { write: (s) => gz.write(s) };
  raw.write(JSON.stringify({ _runner: true, event: 'start', task: task.name, arm: arm.label, args, env_keys: Object.keys(env).sort(), session_mode: arm.sessionMode }) + '\n');
  const started = Date.now();
  if (arm.sessionMode === 'clear') {
    for (let i = 0; i < messages.length && !stats.invalid; i++) await runProcess([messages[i]], i, args, env, work, Math.ceil(timeoutMs / messages.length) * 2, stats, raw);
  } else {
    await runProcess(messages, 0, args, env, work, timeoutMs, stats, raw);
  }
  const wall = Date.now() - started;
  await new Promise((r) => { out.on('close', r); gz.end(); });
  return { stats, wall_ms: wall, args };
}

// Hidden tests, one file at a time (a hang in one module costs that module, not the session).
function scoreSession(task, work, rawDir, tag) {
  const files = fs.readdirSync(path.join(task.dir, 'hidden')).filter((f) => f.endsWith('.py')).sort();
  const dir = path.join(work, '.xend_hidden_tests');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  for (const f of files) fs.copyFileSync(path.join(task.dir, 'hidden', f), path.join(dir, f));
  const perModule = {};
  let passed = 0, total = 0, log = '';
  for (const f of files) {
    const mod = f.replace(/^test_/, '').replace(/_hidden\.py$/, '');
    let outText = '';
    try {
      outText = execFileSync('timeout', ['60', 'python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', path.join('.xend_hidden_tests', f)], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
    } catch (err) { outText = String(err.stdout || '') + String(err.stderr || ''); }
    const nTests = (fs.readFileSync(path.join(dir, f), 'utf8').match(/^def test_/gm) || []).length;
    const m = /(\d+) passed/.exec(outText);
    const p = m ? Number(m[1]) : 0;
    perModule[mod] = [p, nTests];
    passed += p; total += nTests;
    log += '=== ' + f + '\n' + outText.split('\n').slice(-25).join('\n') + '\n';
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(path.join(rawDir, tag + '.test.txt'), log);
  const fixed = Object.entries(perModule).filter(([, [p, t]]) => p === t).map(([m]) => m);
  return { score_passed: passed, score_total: total, score: total ? passed / total : 0, pass: passed === total ? 1 : 0, per_module: perModule, modules_fixed: fixed.length, modules_total: files.length, fixed };
}

// Commands the session ran (main thread and subagents) that look like reading the standard library.
function scanReference(rawPath) {
  const hits = [];
  try {
    const text = zlib.gunzipSync(fs.readFileSync(rawPath)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let e; try { e = JSON.parse(line); } catch (_) { continue; }
      for (const c of (e.message && e.message.content) || []) {
        if (c.type !== 'tool_use') continue;
        const s = JSON.stringify(c.input || {});
        if (STDLIB_RE.test(s)) hits.push({ sub: !!e.parent_tool_use_id, tool: c.name, input: s.slice(0, 300) });
      }
    }
  } catch (_) {}
  return hits;
}

function summarize(job, opts, res, test, refHits) {
  const { stats } = res;
  const pm = stats.perMessage;
  const tot = run.sumModelUsage(stats.modelUsage);
  const spawnedTypes = {};
  for (const m of pm) for (const [t, c] of Object.entries(m.spawned_types)) spawnedTypes[t] = (spawnedTypes[t] || 0) + c;
  const sumStats = {};
  for (const s of stats.subagentStats) for (const k of ['spawned', 'completed', 'failed', 'started_in_background']) sumStats[k] = (sumStats[k] || 0) + (s[k] || 0);
  const mainUsd = pm.map((m) => priceMeters(m.main)), subUsd = pm.map((m) => priceMeters(m.sub));
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const complete = stats.answered === pm.length && !stats.invalid && !stats.errors.length;
  return {
    task: job.task.name, category: job.task.category, arm: job.arm.label, trial: job.trial,
    arm_kind: job.arm.kind, arm_model: job.arm.model, session_mode: job.arm.sessionMode,
    arm_env: job.arm.env || {}, arm_args: job.arm.args || null, arm_prompt_suffix: job.arm.promptSuffix || null,
    effort: opts.effort, autocompact: opts.autocompact || 'auto',
    complete, invalid: stats.invalid, errors: stats.errors, exits: stats.exits, processes: stats.processes,
    pass: test.pass, score: test.score, score_passed: test.score_passed, score_total: test.score_total,
    modules_fixed: test.modules_fixed, modules_total: test.modules_total, per_module: test.per_module,
    cost_usd: stats.cost, wall_ms: res.wall_ms,
    messages: pm.length, answered: stats.answered, messages_errored: pm.filter((m) => m.error).length,
    turns: pm.reduce((s, m) => s + m.turns, 0), api_retries: pm.reduce((s, m) => s + m.api_retries, 0),
    spawned: pm.reduce((s, m) => s + m.spawned, 0), spawned_types: spawnedTypes, subagent_stats: sumStats,
    compactions: stats.compactions.length, compaction_events: stats.compactions, autocompact_state: stats.autocompact,
    rate_limit: stats.rateLimit,
    ctx_peak: Math.max(0, ...pm.map((m) => m.ctx_max)), ctx_final: pm.length ? pm[pm.length - 1].ctx_end : 0,
    ctx_by_message: pm.map((m) => m.ctx_end), ctx_max_by_message: pm.map((m) => m.ctx_max),
    // The streamed per-call usage undercounts output (it is a snapshot taken while the message streams), so the exact
    // per-message cost comes from the cumulative result totals and is split by the streamed main/subagent shares.
    cost_by_message: pm.map((m) => r5(m.cost)),
    sub_usd_by_message: pm.map((m, i) => r5(mainUsd[i] + subUsd[i] > 0 ? m.cost * subUsd[i] / (mainUsd[i] + subUsd[i]) : 0)),
    sub_cost_usd: r5(pm.reduce((s, m, i) => s + (mainUsd[i] + subUsd[i] > 0 ? m.cost * subUsd[i] / (mainUsd[i] + subUsd[i]) : 0), 0)),
    streamed_main_usd: r5(mainUsd.reduce((a, b) => a + b, 0)), streamed_sub_usd: r5(subUsd.reduce((a, b) => a + b, 0)),
    secs_by_message: pm.map((m) => (m.t_start && m.t_end ? Math.round((m.t_end - m.t_start) / 100) / 10 : null)),
    reference_hits: refHits.length, reference_examples: refHits.slice(0, 5),
    per_message: pm.map((m) => Object.assign({}, m, { reply: m.reply.slice(-300) })),
    usage_all: tot, model_usage: run.normalizeModelUsage(stats.modelUsage),
    ts: new Date().toISOString(),
  };
}

function jobTag(job) { return job.task.name + '-' + job.arm.label + '-' + job.trial; }

async function warmup(arm, opts, outDir) {
  const task = { name: 'warmup', session: ['Run the shell command `echo ok` with the Bash tool, then reply with the single word: ok'], max_turns: 3, timeout_s: 180, budget_usd: 1, tools: 'Bash' };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  const res = await runSession(task, Object.assign({}, arm, { sessionMode: 'continuous', promptSuffix: null }), opts, work, path.join(outDir, 'raw', 'warmup-' + arm.label + '.jsonl.gz'));
  fs.rmSync(work, { recursive: true, force: true });
  const tot = run.sumModelUsage(res.stats.modelUsage);
  const w = { arm: arm.label, cache_creation: tot.cache_creation, cache_read: tot.cache_read, cost_usd: res.stats.cost, errors: res.stats.errors, autocompact_state: res.stats.autocompact[0] || null };
  fs.appendFileSync(path.join(outDir, 'warmup.jsonl'), JSON.stringify(w) + '\n');
  console.log('warm-up ' + arm.label.padEnd(14) + ' cache_write=' + w.cache_creation + ' cache_read=' + w.cache_read + ' $' + w.cost_usd.toFixed(3) +
    (w.autocompact_state ? ' window=' + w.autocompact_state.effective_window + ' threshold=' + w.autocompact_state.threshold : '') + (w.errors.length ? ' ERR ' + w.errors[0] : ''));
}

// Each job gets its own neutral top-level directory, so no session can see another arm's work.
function prepareWork(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  const work = path.join(root, 'repo');
  fs.cpSync(path.join(task.dir, 'fixture'), work, { recursive: true });
  const gen = path.join(work, 'gen.sh');
  if (fs.existsSync(gen)) { execFileSync('bash', [gen], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); fs.unlinkSync(gen); }
  return { root, work };
}

async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } });
  await Promise.all(workers);
}

function usage() {
  return 'usage: node bench/session.js --arms-file arms.json [--model m] [--effort e] [--tasks glob] [--runs k] [-j n]\n' +
    '                                [--autocompact tokens] [--messages N] [--out dir] [--resume] [--toolset local|host]\n' +
    '                                [--no-warmup] [--keep] [--dry-run]';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return; }
  if (opts.error) { console.error(opts.error + '\n' + usage()); process.exit(2); }
  const arms = JSON.parse(fs.readFileSync(opts.armsFile, 'utf8')).map((a) => normalizeSessionArm(a, { model: opts.model }));
  const tasks = run.loadTasks(opts.tasks, '').filter((t) => Array.isArray(t.session) && t.session.length);
  if (!tasks.length) { console.error('no session tasks match ' + opts.tasks); process.exit(2); }
  // --messages N: only the first N messages of each session (smoke tests); modules not attempted then count as not fixed
  if (opts.messages > 0) for (const t of tasks) t.session = t.session.slice(0, opts.messages);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(opts.out || path.join(__dirname, 'results', 'session-' + stamp));
  fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });
  const runsPath = path.join(outDir, 'runs.jsonl');
  const done = new Set();
  if (opts.resume && fs.existsSync(runsPath)) {
    for (const line of fs.readFileSync(runsPath, 'utf8').split('\n')) { try { const r = JSON.parse(line); if (r.complete || r.invalid !== 'rate_limit_rejected') done.add(r.task + '|' + r.arm + '|' + r.trial); } catch (_) {} }
  }
  const jobs = [];
  for (let trial = 1; trial <= opts.runs; trial++) for (const task of tasks) for (const arm of arms) if (!done.has(task.name + '|' + arm.label + '|' + trial)) jobs.push({ task, arm, trial });
  const cfgPath = path.join(outDir, opts.resume && fs.existsSync(path.join(outDir, 'config.json')) ? 'config-resume-' + stamp + '.json' : 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ opts, arms, tasks: tasks.map((t) => t.name), claude: run.claudeVersion(), env_allow: ENV_ALLOW, started: new Date().toISOString(), skipped_done: done.size }, null, 2));
  fs.writeFileSync(path.join(outDir, 'arms.json'), JSON.stringify(JSON.parse(fs.readFileSync(opts.armsFile, 'utf8')), null, 1));
  console.log('xend session bench: ' + tasks.length + ' task(s) x ' + arms.length + ' arms (' + arms.map((a) => a.label).join(', ') + ') x ' + opts.runs + ' runs = ' + jobs.length + ' sessions to run' + (done.size ? ' (' + done.size + ' already done)' : '') + '; effort=' + opts.effort + ' autocompact=' + (opts.autocompact || 'auto') + ' -> ' + outDir);
  if (opts.dryRun) { for (const j of jobs) console.log(j.trial, j.task.name, j.arm.label, JSON.stringify(sessionArgs(j.task, j.arm, opts)), Object.keys(sessionEnv(j.arm)).join(',')); return; }
  const stop = () => { for (const p of LIVE) { killGroup(p, 'SIGTERM'); } setTimeout(() => process.exit(130), 3000); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  if (opts.warmup) for (const arm of arms) await warmup(arm, opts, outDir);
  let finishedCount = 0, halt = null;
  await pool(jobs, opts.concurrency, async (job) => {
    if (halt) return;
    const tag = jobTag(job);
    let rec;
    try {
      const { root, work } = prepareWork(job.task);
      const res = await runSession(job.task, job.arm, opts, work, path.join(outDir, 'raw', tag + '.jsonl.gz'));
      const test = scoreSession(job.task, work, path.join(outDir, 'raw'), tag);
      rec = summarize(job, opts, res, test, scanReference(path.join(outDir, 'raw', tag + '.jsonl.gz')));
      if (res.stats.invalid && /rate_limit|api_error/.test(res.stats.invalid)) halt = res.stats.invalid;
      if (!opts.keep) fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      rec = { task: job.task.name, arm: job.arm.label, trial: job.trial, complete: false, invalid: 'runner_error', errors: [String(err && err.stack || err).slice(0, 1500)], ts: new Date().toISOString() };
    }
    fs.appendFileSync(runsPath, JSON.stringify(rec) + '\n');
    finishedCount++;
    console.log('[' + String(finishedCount).padStart(3) + '/' + jobs.length + '] ' + job.arm.label.padEnd(12) + ' #' + job.trial +
      (rec.score_total ? ' fixed=' + rec.modules_fixed + '/' + rec.modules_total + ' score=' + rec.score_passed + '/' + rec.score_total : '') +
      (rec.cost_usd != null ? ' $' + rec.cost_usd.toFixed(3) + ' ctx_peak=' + rec.ctx_peak + ' ctx_final=' + rec.ctx_final + ' compactions=' + rec.compactions + ' spawned=' + rec.spawned + ' turns=' + rec.turns + ' ' + Math.round(rec.wall_ms / 1000) + 's' : '') +
      (rec.reference_hits ? ' REF=' + rec.reference_hits : '') + (rec.complete ? '' : ' INCOMPLETE ' + (rec.invalid || '') + ' ' + String((rec.errors || [])[0] || '').slice(0, 140)));
  });
  if (halt) console.log('HALTED: ' + halt + ' (rerun with --resume once the limit resets)');
  console.log('done -> ' + outDir);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseArgs, normalizeSessionArm, sessionArgs, sessionEnv, newStats, accountEvent, runningSubagents, summarize, priceMeters, scoreSession, ENV_ALLOW, STDLIB_RE };
