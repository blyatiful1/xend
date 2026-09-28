'use strict';
// End-to-end: hook scripts driven the way Claude Code drives them (JSON on stdin, JSON on stdout).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function tmp(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-'));
  for (const [f, c] of Object.entries(files || {})) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

function hook(script, input, env) {
  const childEnv = Object.assign({}, process.env, {
    XEND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-state-')),
    XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-xdg-')),
    CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-home-')),
  }, env);
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.CLAUDE_PROJECT_DIR;
  for (const k of ['XEND_PROFILE', 'XEND_AUTOTEST', 'XEND_TRUST_TESTS']) if (!(env && k in env)) delete childEnv[k];
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), encoding: 'utf8', env: childEnv });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const PASSING = { 'a.js': 'module.exports = 1;\n', 'a.test.js': 'require("assert").ok(true);\n' };

test('record-edit: the main thread of a `claude --agent` session (agent_type, no agent_id) gets the auto-test', () => {
  const d = tmp(PASSING);
  const input = { hook_event_name: 'PostToolUse', session_id: 's1', cwd: d, tool_name: 'Edit', tool_use_id: 't1',
    tool_input: { file_path: path.join(d, 'a.js') }, agent_type: 'my-main-agent' };
  const out = hook('record-edit.js', input, { XEND_TRUST_TESTS: '1' });
  assert.match(out.hookSpecificOutput.additionalContext, /Auto-test after this edit/);
  // inside a subagent (agent_id set) nothing runs
  assert.equal(hook('record-edit.js', Object.assign({}, input, { agent_id: 'sub-1' }), { XEND_TRUST_TESTS: '1' }), null);
});

test('record-edit: without permission the user gets a one-line note and the model gets nothing', () => {
  const d = tmp(PASSING);
  const out = hook('record-edit.js', { hook_event_name: 'PostToolUse', session_id: 's2', cwd: d, tool_name: 'Edit', tool_use_id: 't1',
    tool_input: { file_path: path.join(d, 'a.js') } });
  assert.equal(out.hookSpecificOutput, undefined);
  assert.match(out.systemMessage, /Bash\(node --test:\*\)/);
});

test('pre-read (aggressive): limits a large read inside the project, leaves files elsewhere to Claude Code', () => {
  const big = Array.from({ length: 1000 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(30)).join('\n') + '\n';
  const outside = tmp({ 'big.txt': big });
  const d = tmp({ 'big.txt': big });
  const base = { hook_event_name: 'PreToolUse', session_id: 's3', cwd: d, tool_name: 'Read' };
  const env = { XEND_PROFILE: 'aggressive' };
  const inside = hook('pre-read.js', Object.assign({ tool_use_id: 'r1', tool_input: { file_path: path.join(d, 'big.txt') } }, base), env);
  assert.equal(inside.hookSpecificOutput.updatedInput.limit, 250);
  assert.match(inside.hookSpecificOutput.permissionDecisionReason, /250 of 1000 lines/, 'a final newline is not an extra line');
  assert.equal(hook('pre-read.js', Object.assign({ tool_use_id: 'r2', tool_input: { file_path: path.join(outside, 'big.txt') } }, base), env), null);
});

test('pre-read + post-tool-use: parallel limited reads each keep their own note', () => {
  const big = Array.from({ length: 900 }, (_, i) => 'x' + i + ' ' + 'y'.repeat(30)).join('\n') + '\n';
  const d = tmp({ 'a.txt': big, 'b.txt': big });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-state-'));
  const env = { XEND_PROFILE: 'aggressive', XEND_STATE_DIR: stateDir };
  for (const [id, f] of [['ra', 'a.txt'], ['rb', 'b.txt']]) {
    hook('pre-read.js', { hook_event_name: 'PreToolUse', session_id: 's4', cwd: d, tool_name: 'Read', tool_use_id: id, tool_input: { file_path: path.join(d, f) } }, env);
  }
  for (const [id, f] of [['rb', 'b.txt'], ['ra', 'a.txt']]) {
    const out = hook('post-tool-use.js', { hook_event_name: 'PostToolUse', session_id: 's4', cwd: d, tool_name: 'Read', tool_use_id: id,
      tool_input: { file_path: path.join(d, f), limit: 250 },
      tool_response: { type: 'text', file: { filePath: path.join(d, f), content: 'x', numLines: 250, startLine: 1, totalLines: 900 } } }, env);
    assert.match(out.hookSpecificOutput.additionalContext, new RegExp(f.replace('.', '\\.') + ' has 900 lines'), id);
  }
});

test('post-tool-use: a limited read gets its note even when shaping is off for the session', () => {
  const big = Array.from({ length: 900 }, (_, i) => 'x' + i + ' ' + 'y'.repeat(30)).join('\n') + '\n';
  const d = tmp({ 'a.txt': big });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-state-'));
  hook('pre-read.js', { hook_event_name: 'PreToolUse', session_id: 's5', cwd: d, tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: path.join(d, 'a.txt') } }, { XEND_PROFILE: 'aggressive', XEND_STATE_DIR: stateDir });
  const out = hook('post-tool-use.js', { hook_event_name: 'PostToolUse', session_id: 's5', cwd: d, tool_name: 'Read', tool_use_id: 'r1',
    tool_input: { file_path: path.join(d, 'a.txt'), limit: 250 },
    tool_response: { type: 'text', file: { filePath: path.join(d, 'a.txt'), content: 'x', numLines: 250, startLine: 1, totalLines: 900 } } },
    { XEND_PROFILE: 'aggressive', XEND_STATE_DIR: stateDir, XEND_SHAPE: '0' });
  assert.match(out.hookSpecificOutput.additionalContext, /a\.txt has 900 lines/);
  // and with shaping off from the start, pre-read does not limit at all
  assert.equal(hook('pre-read.js', { hook_event_name: 'PreToolUse', session_id: 's6', cwd: d, tool_name: 'Read', tool_use_id: 'r2', tool_input: { file_path: path.join(d, 'a.txt') } }, { XEND_PROFILE: 'aggressive', XEND_SHAPE: '0' }), null);
});

test('record-edit: trust claimed in the session\'s cached config.json is ignored', () => {
  const d = tmp(PASSING);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-hk-state-'));
  fs.mkdirSync(path.join(stateDir, 's7'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 's7', 'config.json'), JSON.stringify({ trustTestCommands: true, autoTest: { enabled: true, command: 'node --test' } }));
  const out = hook('record-edit.js', { hook_event_name: 'PostToolUse', session_id: 's7', cwd: d, tool_name: 'Edit', tool_use_id: 't1',
    tool_input: { file_path: path.join(d, 'a.js') } }, { XEND_STATE_DIR: stateDir });
  assert.equal(out.hookSpecificOutput, undefined, 'no test ran');
  assert.match(out.systemMessage, /waiting for permission/);
});
