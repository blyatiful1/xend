'use strict';
// Hooks and the CLI must find the same per-session state directory. In a plugin install, hooks get
// CLAUDE_PLUGIN_DATA (and sometimes scratchpad_dir in their input); the CLI, run by a skill through
// the Bash tool, gets neither and is only told the data dir by the skill (--data). A setting made
// from a skill (/xend:terse, /xend:plan off, a checkpoint note) has to reach the next session start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SESSION_START = path.join(ROOT, 'scripts', 'session-start.js');
const CLI = path.join(ROOT, 'scripts', 'xend-cli.js');

function baseEnv(extra) {
  const env = Object.assign({}, process.env, extra);
  for (const k of ['XEND_STATE_DIR', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'XEND_PROFILE', 'XEND_TERSE']) {
    if (!(extra && k in extra)) delete env[k];
  }
  env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-xdg-'));
  return env;
}

function sessionStart(input, env) {
  const r = spawnSync(process.execPath, [SESSION_START], { input: JSON.stringify(input), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}

function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

for (const withScratchpad of [false, true]) {
  test('skill settings reach the hooks (plugin data dir' + (withScratchpad ? ' + scratchpad_dir' : '') + ')', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-data-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-cwd-'));
    const sid = 'sess-' + (withScratchpad ? 'sp' : 'plain');
    const hookEnv = baseEnv({ CLAUDE_PLUGIN_DATA: data });
    const cliEnv = baseEnv({}); // what the Bash tool has: no CLAUDE_PLUGIN_DATA
    const input = { session_id: sid, cwd, source: 'startup' };
    if (withScratchpad) input.scratchpad_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-sp-'));

    assert.match(sessionStart(input, hookEnv), /terse full/);
    cli(['set', sid, 'terse', 'ultra', '--data', data], cliEnv, cwd);
    cli(['note', sid, '--data', data, 'goal: ship | open: docs'], cliEnv, cwd);
    cli(['plan', 'on', '--session', sid, '--data', data], cliEnv, cwd);

    const after = sessionStart(Object.assign({}, input, { source: 'clear' }), hookEnv);
    assert.match(after, /terse ultra/);
    assert.match(after, /goal: ship \| open: docs/, 'the checkpoint note is re-injected whole');
    assert.match(after, /architect/, '/xend:plan on enables architect mode');
    // the CLI shows the value it set when asked with no value
    assert.match(cli(['set', sid, 'terse', '--data', data], cliEnv, cwd), /terse: "ultra" \(session override\)/);
  });
}

test('an unsubstituted or empty --data is ignored rather than used as a path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-cwd-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-state-'));
  const env = baseEnv({ XEND_STATE_DIR: stateDir });
  cli(['set', 'sid-x', 'terse', 'lite', '--data', '${CLAUDE_PLUGIN_DATA}'], env, cwd);
  cli(['set', 'sid-y', 'terse', 'lite', '--data', ''], env, cwd);
  assert.ok(fs.existsSync(path.join(stateDir, 'sid-x', 'session.json')));
  assert.ok(fs.existsSync(path.join(stateDir, 'sid-y', 'session.json')));
});

test('state directories and saved files are private to the user', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const state = require('../scripts/lib/state.js');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-perm-'));
  const dir = state.sessionDir('sid-perm', { XEND_STATE_DIR: base });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const f = state.persistOriginal(dir, 'tu1', 'secret output');
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  state.writeJson(path.join(dir, 'x.json'), { a: 1 });
  assert.equal(fs.statSync(path.join(dir, 'x.json')).mode & 0o777, 0o600);
});

test('/xend:plan (--from-skill) only shows the plan or switches the mode', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-cwd-'));
  const env = baseEnv({ XEND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-state-')) });
  const r = spawnSync(process.execPath, [CLI, 'plan', 'done T1 PASS', '--from-skill', '--session', 'sid-p'], { encoding: 'utf8', env, cwd });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /takes status, next, on or off/);
  const status = spawnSync(process.execPath, [CLI, 'plan', '', '--from-skill', '--session', 'sid-p'], { encoding: 'utf8', env, cwd });
  assert.match(status.stdout, /no plan set for this session/, 'an empty argument means status');
});

test('the architect\'s own plan commands (no --session, no --data) find the session the hooks use', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-data-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-cwd-'));
  const sid = 'sess-arch-' + path.basename(cwd);
  const hookEnv = baseEnv({ CLAUDE_PLUGIN_DATA: data });
  sessionStart({ session_id: sid, cwd, source: 'startup' }, hookEnv);
  const planFile = path.join(cwd, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify({ goal: 'g', verify: 'npm test', tasks: [{ id: 'T1', title: 't', files: ['a.js'], spec: 's', verify: 'npm test' }] }));
  const out = cli(['plan', 'set', '--file', planFile], baseEnv({}), cwd);
  assert.match(out, /plan: 1 tasks/);
  assert.ok(fs.existsSync(path.join(data, 'sessions', sid, 'plan.json')), 'plan.json lands where SubagentStop reads it');
});

test('a configured XEND_STATE_DIR keeps its own mode; only xend\'s session dirs are made private', { skip: process.platform === 'win32' && 'POSIX modes' }, () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-shared-'));
  fs.chmodSync(shared, 0o1777);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-sd-cwd-'));
  sessionStart({ session_id: 'sess-mode', cwd, source: 'startup' }, baseEnv({ XEND_STATE_DIR: shared }));
  assert.equal(fs.statSync(shared).mode & 0o7777, 0o1777);
  assert.equal(fs.statSync(path.join(shared, 'sess-mode')).mode & 0o777, 0o700);
});
