'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const config = require('../scripts/lib/config.js');
const state = require('../scripts/lib/state.js');
const context = require('../scripts/lib/context.js');

const REPO_ROOT = path.join(__dirname, '..');
const GATE = path.join(REPO_ROOT, 'scripts', 'pre-edit-gate.js');
const CLI = path.join(REPO_ROOT, 'scripts', 'xend-cli.js');

function mkTmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Same NODE_TEST_CONTEXT stripping as tests/verify.test.js: this suite runs under `node --test`
// and that env var must not leak into the spawned child.
function runNode(args, input, env) {
  const childEnv = Object.assign({}, process.env, env);
  delete childEnv.NODE_TEST_CONTEXT;
  const opts = { encoding: 'utf8', env: childEnv };
  if (input !== undefined) opts.input = input;
  return spawnSync(process.execPath, args, opts);
}

function runGate(input, env) { return runNode([GATE], JSON.stringify(input), env); }
function runCli(args, env) { return runNode([CLI, ...args], undefined, env); }

function stateDirFor(stateBase, sessionId) { return path.join(stateBase, sessionId); }

function writeEdits(dir, files) {
  const lines = files.map((f) => JSON.stringify({ ts: Date.now(), tool: 'Write', file: f }));
  fs.writeFileSync(path.join(dir, 'edits.jsonl'), lines.join('\n') + (lines.length ? '\n' : ''));
}

// Sets up a session state dir with a cached config.json (architect resolved with configEnv) and
// an optional edits.jsonl. Returns { cwd, stateBase, dir, sessionId }.
function setupSession(sessionId, opts) {
  opts = opts || {};
  const cwd = mkTmpDir('xend-gate-cwd-');
  const stateBase = mkTmpDir('xend-gate-state-');
  const dir = stateDirFor(stateBase, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = config.resolve({ env: opts.configEnv || {}, cwd });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  if (opts.edits) writeEdits(dir, opts.edits);
  return { cwd, stateBase, dir, sessionId };
}

function editInput(sessionId, cwd, filePath, extra) {
  return Object.assign({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath },
    session_id: sessionId,
    cwd,
  }, extra);
}

test('(a) zero or one prior distinct files: no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-a1', {});
  // zero prior edits
  let res = runGate(editInput(sessionId, cwd, path.join(cwd, 'one.js')), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));

  // one prior distinct edit
  const { cwd: cwd2, stateBase: stateBase2, sessionId: sid2, dir: dir2 } = setupSession('sess-a2', { edits: ['/abs/one.js'] });
  res = runGate(editInput(sid2, cwd2, path.join(cwd2, 'two.js')), { XEND_STATE_DIR: stateBase2 });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir2, 'gate.json')));
});

test('(b) two prior distinct files + a new third: deny JSON, reason names plan set and plan off, gate.json written', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-b', { edits: ['/abs/one.js', '/abs/two.js'] });
  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  const out = (res.stdout || '').trim();
  assert.ok(out, 'expected deny output, got nothing: ' + res.stderr);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
  const reason = parsed.hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes('plan set'), reason);
  assert.ok(reason.includes('plan off'), reason);

  const gateFile = path.join(dir, 'gate.json');
  assert.ok(fs.existsSync(gateFile));
  const gateJson = JSON.parse(fs.readFileSync(gateFile, 'utf8'));
  assert.strictEqual(gateJson.fired, true);
  assert.strictEqual(gateJson.file, path.resolve(third));
});

test('(c) same as (b) but the file is one of the two already edited: no output', () => {
  const already = '/abs/one.js';
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-c', { edits: [already, '/abs/two.js'] });
  const res = runGate(editInput(sessionId, cwd, already), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(d) run (b) twice: the second run prints nothing', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-d', { edits: ['/abs/one.js', '/abs/two.js'] });
  const third = path.join(cwd, 'three.js');
  const first = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.ok((first.stdout || '').trim(), 'first run should deny');
  assert.ok(fs.existsSync(path.join(dir, 'gate.json')));

  const fourth = path.join(cwd, 'four.js');
  const second = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(second.status, 0);
  assert.strictEqual((second.stdout || '').trim(), '');
});

test('(e) plan.json present: no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-e', { edits: ['/abs/one.js', '/abs/two.js'] });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ goal: 'g', verify: 'npm test', tasks: [] }));
  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(f) agent_id present (inside a subagent): no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-f', { edits: ['/abs/one.js', '/abs/two.js'] });
  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third, { agent_id: 'agent-1' }), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(g) session override architect=false: no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-g', { edits: ['/abs/one.js', '/abs/two.js'] });
  state.setSessionOverride(dir, 'architect', false);
  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(h) XEND_ARCHITECT_GATE=0 baked into the cached config: no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-h', {
    edits: ['/abs/one.js', '/abs/two.js'],
    configEnv: { XEND_ARCHITECT_GATE: '0' },
  });
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.strictEqual(cached.architect.enabled, true); // architect itself stays on
  assert.strictEqual(cached.architect.gate, false);    // only the gate is disabled
  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(i) `plan off` via the CLI clears the way: no output, and a lingering gate.json is removed', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-i', { edits: ['/abs/one.js', '/abs/two.js'] });
  // simulate a gate that already fired earlier this session
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ fired: true, file: '/abs/whatever.js' }));

  const off = runCli(['plan', 'off', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(off.status, 0, off.stderr);
  assert.ok((off.stdout || '').includes('architect mode off for this session; direct edits allowed'), off.stdout);
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')), 'plan off must delete a lingering gate.json');

  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('`plan on` clears the session override so the gate can fire again', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-on', { edits: ['/abs/one.js', '/abs/two.js'] });
  const offCli = runCli(['plan', 'off', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(offCli.status, 0, offCli.stderr);

  const onCli = runCli(['plan', 'on', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(onCli.status, 0, onCli.stderr);
  assert.ok((onCli.stdout || '').includes('architect mode on for this session'), onCli.stdout);

  const third = path.join(cwd, 'three.js');
  const res = runGate(editInput(sessionId, cwd, third), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  const out = (res.stdout || '').trim();
  assert.ok(out, 'expected the gate to fire again once architect is back on');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
});

// --- context.build: the gate sentence --------------------------------------------------------

test('context.build includes the gate sentence when architect.gate !== false, omits it when false', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() }); // balanced: architect enabled, gate true
  const on = context.build(cfg, { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(on.includes('xend refuses the third direct file edit without a plan, once.'), on);

  const gateOff = context.build(Object.assign({}, cfg, { architect: Object.assign({}, cfg.architect, { gate: false }) }), { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(gateOff.includes('Architect mode:'), gateOff); // architect mode itself still on
  assert.ok(!gateOff.includes('xend refuses the third direct file edit without a plan, once.'), gateOff);

  const archOff = context.build(Object.assign({}, cfg, { architect: { enabled: false } }), { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(!archOff.includes('xend refuses the third direct file edit without a plan, once.'), archOff);
});
