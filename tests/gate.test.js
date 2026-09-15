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

// Three prior distinct files is the floor for the default minFiles: 4 (minFiles - 1 = 3).
const THREE_PRIOR = ['/abs/one.js', '/abs/two.js', '/abs/three.js'];

test('(a) fewer than minFiles-1 (3) prior distinct files: no output, for 0, 1 and 2', () => {
  for (const prior of [[], ['/abs/one.js'], ['/abs/one.js', '/abs/two.js']]) {
    const { cwd, stateBase, sessionId, dir } = setupSession('sess-a-' + prior.length, { edits: prior });
    const res = runGate(editInput(sessionId, cwd, path.join(cwd, 'new.js')), { XEND_STATE_DIR: stateBase });
    assert.strictEqual(res.status, 0);
    assert.strictEqual((res.stdout || '').trim(), '', 'prior=' + prior.length);
    assert.ok(!fs.existsSync(path.join(dir, 'gate.json')), 'prior=' + prior.length);
  }
});

test('(b) three prior distinct files + a new fourth: deny JSON, reason names the 4th file and omits `plan off`, gate.json records one denial', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-b', { edits: THREE_PRIOR });
  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  const out = (res.stdout || '').trim();
  assert.ok(out, 'expected deny output, got nothing: ' + res.stderr);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
  const reason = parsed.hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes('4th file'), reason);
  assert.ok(reason.includes('plan set'), reason);
  assert.ok(reason.includes('plan next'), reason);
  assert.ok(!reason.includes('plan off'), reason);
  assert.ok(!/disable/i.test(reason), reason);

  const gateFile = path.join(dir, 'gate.json');
  assert.ok(fs.existsSync(gateFile));
  const gateJson = JSON.parse(fs.readFileSync(gateFile, 'utf8'));
  assert.strictEqual(gateJson.denials, 1);
  assert.deepStrictEqual(gateJson.files, [path.resolve(fourth)]);
});

test('(c) the file is already in edits.jsonl: no output', () => {
  const already = THREE_PRIOR[0];
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-c', { edits: THREE_PRIOR });
  const res = runGate(editInput(sessionId, cwd, already), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(d) a stubborn retry of the same file is denied again, up to gateMaxDenials (3), then allowed', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-d', { edits: THREE_PRIOR });
  const target = path.join(cwd, 'four.js');
  const input = editInput(sessionId, cwd, target);

  for (let i = 1; i <= 3; i++) {
    const res = runGate(input, { XEND_STATE_DIR: stateBase });
    const out = (res.stdout || '').trim();
    assert.ok(out, 'denial #' + i + ' should have fired');
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
    const gateJson = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
    assert.strictEqual(gateJson.denials, i);
    assert.strictEqual(gateJson.files.length, i);
    assert.strictEqual(gateJson.files[i - 1], path.resolve(target));
  }

  // the 4th attempt (denials already at the ceiling of 3) is let through
  const fourthAttempt = runGate(input, { XEND_STATE_DIR: stateBase });
  assert.strictEqual(fourthAttempt.status, 0);
  assert.strictEqual((fourthAttempt.stdout || '').trim(), '');
  const gateJson = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.strictEqual(gateJson.denials, 3, 'the ceiling must not be exceeded');
});

test('(e) plan.json present: no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-e', { edits: THREE_PRIOR });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ goal: 'g', verify: 'npm test', tasks: [] }));
  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(f) agent_id present (inside a subagent): no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-f', { edits: THREE_PRIOR });
  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth, { agent_id: 'agent-1' }), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(g) session override architect=false ("disabled"): no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-g', { edits: THREE_PRIOR });
  state.setSessionOverride(dir, 'architect', false);
  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(h) XEND_ARCHITECT_GATE=0 baked into the cached config ("disabled"): no output', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-h', {
    edits: THREE_PRIOR,
    configEnv: { XEND_ARCHITECT_GATE: '0' },
  });
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.strictEqual(cached.architect.enabled, true); // architect itself stays on
  assert.strictEqual(cached.architect.gate, false);    // only the gate is disabled
  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('(i) `plan off` via the CLI clears the way: no output, and a lingering gate.json is removed', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-i', { edits: THREE_PRIOR });
  // simulate a gate that already denied twice earlier this session
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ denials: 2, files: ['/abs/whatever.js', '/abs/other.js'] }));

  const off = runCli(['plan', 'off', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(off.status, 0, off.stderr);
  assert.ok((off.stdout || '').includes('architect mode off for this session; direct edits allowed'), off.stdout);
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')), 'plan off must delete a lingering gate.json');

  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  assert.strictEqual(res.status, 0);
  assert.strictEqual((res.stdout || '').trim(), '');
  assert.ok(!fs.existsSync(path.join(dir, 'gate.json')));
});

test('`plan on` clears the session override so the gate can fire again (fresh denial count)', () => {
  const { cwd, stateBase, sessionId, dir } = setupSession('sess-on', { edits: THREE_PRIOR });
  const offCli = runCli(['plan', 'off', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(offCli.status, 0, offCli.stderr);

  const onCli = runCli(['plan', 'on', '--session', sessionId], { XEND_STATE_DIR: stateBase });
  assert.strictEqual(onCli.status, 0, onCli.stderr);
  assert.ok((onCli.stdout || '').includes('architect mode on for this session'), onCli.stdout);

  const fourth = path.join(cwd, 'four.js');
  const res = runGate(editInput(sessionId, cwd, fourth), { XEND_STATE_DIR: stateBase });
  const out = (res.stdout || '').trim();
  assert.ok(out, 'expected the gate to fire again once architect is back on');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny');
  const gateJson = JSON.parse(fs.readFileSync(path.join(dir, 'gate.json'), 'utf8'));
  assert.strictEqual(gateJson.denials, 1, 'denial count restarts fresh (plan off deleted the old gate.json)');
});

// --- context.build: the gate sentence --------------------------------------------------------

test('context.build includes the gate sentence when architect.gate !== false, omits it when false', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() }); // balanced: architect enabled, gate true
  const on = context.build(cfg, { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(on.includes('Above three files edited directly, xend refuses further direct edits until a plan exists.'), on);

  const gateOff = context.build(Object.assign({}, cfg, { architect: Object.assign({}, cfg.architect, { gate: false }) }), { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(gateOff.includes('Architect mode:'), gateOff); // architect mode itself still on
  assert.ok(!gateOff.includes('Above three files edited directly'), gateOff);

  const archOff = context.build(Object.assign({}, cfg, { architect: { enabled: false } }), { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(!archOff.includes('Above three files edited directly'), archOff);
});
