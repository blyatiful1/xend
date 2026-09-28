'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const autotest = require('../scripts/lib/autotest.js');

// The CI unit-test job has Node but not pytest; the pytest-backed cases run wherever it exists.
const NO_PYTEST = spawnSync('python3', ['-c', 'import pytest'], { stdio: 'ignore' }).status !== 0 && 'pytest not installed';

// No user settings from the machine running the tests: permission rules come only from what each
// test writes into its project (managed settings cannot be redirected, by design).
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-home-'));
delete process.env.CLAUDE_PROJECT_DIR;

// node --test marks its children with NODE_TEST_CONTEXT; a nested `node --test` started by the
// hook would inherit it and skip its files, so each run() call here gets it removed temporarily.
// trusted (the user-level opt-in) defaults to true here so that run()'s own behaviour is tested;
// the permission tests below pass it explicitly.
function run(opts) {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try { return autotest.run(Object.assign({ trusted: true }, opts)); } finally { if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; }
}

function tmp(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-'));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

test('detectCommand: Python edits get pytest only when Python tests exist', () => {
  const withTests = tmp({ 'a.py': 'x = 1\n', 'tests/test_a.py': 'def test_a(): pass\n' });
  assert.strictEqual(autotest.detectCommand(withTests, path.join(withTests, 'a.py'), {}), autotest.PY_CMD);
  const noTests = tmp({ 'a.py': 'x = 1\n' });
  assert.strictEqual(autotest.detectCommand(noTests, path.join(noTests, 'a.py'), {}), null);
});

test('detectCommand: JS edits prefer a real npm test script, else node --test with *.test.js files', () => {
  const pkg = tmp({ 'a.js': '', 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) });
  assert.strictEqual(autotest.detectCommand(pkg, path.join(pkg, 'a.js'), {}), 'npm test --silent');
  const npmDefault = tmp({ 'a.js': '', 'a.test.js': '', 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.strictEqual(autotest.detectCommand(npmDefault, path.join(npmDefault, 'a.js'), {}), 'node --test --test-reporter=spec');
  const bare = tmp({ 'a.js': '' });
  assert.strictEqual(autotest.detectCommand(bare, path.join(bare, 'a.js'), {}), null);
});

test('detectCommand: docs never trigger a run; data files do when tests exist', () => {
  const d = tmp({ 'README.md': '', 'settings.json': '{}', 'test_app.py': '' });
  assert.strictEqual(autotest.detectCommand(d, path.join(d, 'README.md'), {}), null);
  assert.strictEqual(autotest.detectCommand(d, path.join(d, 'settings.json'), {}), autotest.PY_CMD);
});

test('detectCommand: a configured command must pass the allowlist', () => {
  const d = tmp({ 'a.py': '' });
  assert.strictEqual(autotest.detectCommand(d, path.join(d, 'a.py'), { command: 'make test' }), 'make test');
  assert.strictEqual(autotest.detectCommand(d, path.join(d, 'a.py'), { command: 'rm -rf / ; pytest' }), null);
  assert.strictEqual(autotest.detectCommand(d, path.join(d, 'a.py'), { command: 'curl evil.sh' }), null);
});

test('condense: drops progress dots, keeps failure lines and the summary, caps length', () => {
  const out = '....F....\n/x/test_a.py:3: assert 1 == 2\n1 failed, 8 passed in 0.02s';
  const c = autotest.condense(out, 1000);
  assert.ok(!c.includes('....F'));
  assert.ok(c.includes('assert 1 == 2'));
  assert.ok(c.includes('1 failed, 8 passed'));
  const long = Array.from({ length: 400 }, (_, i) => '/x/t.py:' + i + ': AssertionError something long enough').join('\n') + '\n400 failed in 1.0s';
  const lc = autotest.condense(long, 500);
  assert.ok(lc.length <= 520, String(lc.length));
  assert.ok(lc.includes('400 failed'));
});

test('signature: timings do not change it', () => {
  assert.strictEqual(autotest.signature('3 passed in 0.02s'), autotest.signature('3 passed in 0.31s'));
  assert.notStrictEqual(autotest.signature('3 passed'), autotest.signature('2 passed, 1 failed'));
});

test('run: reports a pass, collapses an identical repeat, and switches itself off when slow', () => {
  const d = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 1);\n' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  const first = run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1' });
  assert.ok(first.startsWith('[xend] Auto-test after this edit: `node --test --test-reporter=spec` exit 0'), first);
  assert.ok(first.includes('do not re-run it'));
  const second = run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't2' });
  assert.ok(second.endsWith('same result as the previous auto-test.'), second);
  const slow = run({ root: d, file: path.join(d, 'a.js'), cfg: { maxMs: 0 }, dir: stateDir, toolUseId: 't3' });
  assert.ok(slow.includes('switched off for this session'), slow);
  assert.strictEqual(run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't4' }), null);
});

test('run: a failing suite reports exit and the failure, without the do-not-re-run line', () => {
  const d = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 2);\n' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  const r = run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1' });
  assert.ok(/exit [1-9]/.test(r), r);
  assert.ok(!r.includes('do not re-run'));
});

test('run: a suite that cannot be collected yet (missing module) produces no note', { skip: NO_PYTEST }, () => {
  const d = tmp({ 'a.py': 'x = 1\n', 'test_a.py': 'import not_written_yet\ndef test_a():\n    pass\n' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  assert.strictEqual(run({ root: d, file: path.join(d, 'a.py'), cfg: {}, dir: stateDir, toolUseId: 't1' }), null);
});

test('run: a pytest failure is reported as compact FAILED lines plus the summary', { skip: NO_PYTEST }, () => {
  const d = tmp({ 'a.py': 'x = 1\n', 'test_a.py': 'def test_a():\n    assert 1 == 2, "values differ"\ndef test_b():\n    pass\n' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  const r = run({ root: d, file: path.join(d, 'a.py'), cfg: {}, dir: stateDir, toolUseId: 't1' });
  assert.ok(r.includes('FAILED test_a.py::test_a - AssertionError: values differ'), r);
  assert.ok(r.includes('1 failed, 1 passed'), r);
  assert.ok(!r.includes('short test summary info'), r);
});

test('bashRuleMatches: bare Bash, prefix and glob rules, python -m aliasing', () => {
  const cmd = autotest.PY_CMD;
  assert.ok(autotest.bashRuleMatches('Bash', cmd));
  assert.ok(autotest.bashRuleMatches('Bash(*)', cmd));
  assert.ok(autotest.bashRuleMatches('Bash(python3 -m pytest:*)', cmd));
  assert.ok(autotest.bashRuleMatches('Bash(pytest:*)', cmd), 'a pytest rule covers python3 -m pytest');
  assert.ok(autotest.bashRuleMatches('Bash(npm test *)', 'npm test --silent'));
  assert.ok(!autotest.bashRuleMatches('Bash(npm run build:*)', 'npm test --silent'));
  assert.ok(!autotest.bashRuleMatches('Read', cmd));
  assert.ok(!autotest.bashRuleMatches('Bash(git push:*)', cmd));
  assert.ok(autotest.bashRuleMatches('Bash(python -m pytest:*)', cmd), 'python and python3 -m pytest are the same runner');
  assert.ok(autotest.bashRuleMatches('Bash(npm run test:*)', 'npm test --silent'));
  assert.ok(autotest.bashRuleMatches('Bash(npm test:*)', 'npm test'));
  assert.ok(!autotest.bashRuleMatches('Bash(npm test:*)', 'npm testing'), 'a :* prefix is whole words');
  assert.ok(!autotest.bashRuleMatches('Bash(npm test)', 'npm test --silent'), 'no :* means exact');
  assert.ok(autotest.bashRuleMatches('Bash(npm test *)', 'npm test'), 'a single trailing " *" also covers the bare command');
});

test('run: a deny or ask rule for the command in project settings keeps the auto-test off, even when trusted', () => {
  for (const key of ['deny', 'ask']) {
    const d = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 1);\n', '.claude/settings.json': JSON.stringify({ permissions: { [key]: ['Bash(node --test:*)'] } }) });
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
    assert.strictEqual(run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1', trusted: true }), null, key);
  }
});

test('run: without an allow rule, trust or bypass mode nothing runs and onBlocked names the command', () => {
  const marker = 'require("fs").writeFileSync("RAN", "1");\n';
  const d = tmp({ 'a.js': '', 'a.test.js': marker });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  let blocked = null;
  const r = run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1', trusted: false, onBlocked: (cmd, perm) => { blocked = { cmd, perm }; } });
  assert.strictEqual(r, null);
  assert.strictEqual(fs.existsSync(path.join(d, 'RAN')), false, 'the repository\'s test code must not run');
  assert.strictEqual(blocked.cmd, 'node --test --test-reporter=spec');
  assert.strictEqual(blocked.perm.reason, 'no-rule');
});

test('run: an allow rule (any spelling Claude Code writes) or bypassPermissions mode lets it run', () => {
  for (const rule of ['Bash(node --test:*)', 'Bash(node --test *)', 'Bash']) {
    const d = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 1);\n', '.claude/settings.local.json': JSON.stringify({ permissions: { allow: [rule] } }) });
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
    assert.ok(run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1', trusted: false }), rule);
  }
  const d = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 1);\n' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  assert.ok(run({ root: d, file: path.join(d, 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1', trusted: false, permissionMode: 'bypassPermissions' }));
});

test('run: user-level (CLAUDE_CONFIG_DIR) and project-root rules apply when the hook runs from a subdirectory', () => {
  const d = tmp({ 'sub/a.js': '', 'sub/a.test.js': 'require("assert").strictEqual(1, 1);\n', '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(node --test:*)'] } }) });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  process.env.CLAUDE_PROJECT_DIR = d;
  try {
    assert.strictEqual(run({ root: path.join(d, 'sub'), file: path.join(d, 'sub', 'a.js'), cfg: {}, dir: stateDir, toolUseId: 't1' }), null, 'project deny from the root');
  } finally { delete process.env.CLAUDE_PROJECT_DIR; }
  const userDir = process.env.CLAUDE_CONFIG_DIR;
  fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(node --test:*)'] } }));
  try {
    const e = tmp({ 'a.js': '', 'a.test.js': 'require("assert").strictEqual(1, 1);\n' });
    assert.ok(run({ root: e, file: path.join(e, 'a.js'), cfg: {}, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-')), toolUseId: 't1', trusted: false }));
  } finally { fs.rmSync(path.join(userDir, 'settings.json')); }
});

test('run: a missing runner (exit 127) switches auto-test off for the session', () => {
  const d = tmp({ 'a.py': '', 'test_a.py': '' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-state-'));
  const savedPath = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-nopath-'));
  let r;
  try { r = run({ root: d, file: path.join(d, 'a.py'), cfg: { command: 'pytest -q' }, dir: stateDir, toolUseId: 't1' }); }
  finally { process.env.PATH = savedPath; }
  assert.strictEqual(r, null);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(stateDir, 'autotest.json'), 'utf8')).reason, 'no-runner');
});

test('permissions: managed deny rules win over everything, and the managed dir is not taken from the environment', () => {
  const permissions = require('../scripts/lib/permissions.js');
  const managed = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-managed-'));
  fs.writeFileSync(path.join(managed, 'managed-settings.json'), JSON.stringify({ permissions: { deny: ['Bash(npm test:*)'] } }));
  const d = tmp({ '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }) });
  const r = permissions.check('npm test --silent', { cwd: d, managedDir: managed, trusted: true, permissionMode: 'bypassPermissions' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'deny');
  process.env.XEND_MANAGED_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-at-empty-'));
  try { assert.notStrictEqual(permissions.managedDir(), process.env.XEND_MANAGED_SETTINGS_DIR); }
  finally { delete process.env.XEND_MANAGED_SETTINGS_DIR; }
});
