'use strict';
// Delegate mode (long sessions): config switch, session-block rule, session override, CLI, agent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../scripts/lib/config.js');
const context = require('../scripts/lib/context.js');
const state = require('../scripts/lib/state.js');
const verify = require('../scripts/lib/verify.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'xend-cli.js');

function isolatedEnv(extra) {
  const env = Object.assign({}, process.env, {
    XEND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-state-')),
    XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-xdg-')),
    CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-home-')),
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-realhome-')),
  }, extra || {});
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_PROJECT_DIR;
  for (const k of ['XEND_PROFILE', 'XEND_DELEGATE', 'XEND_ARCHITECT']) if (!(extra && k in extra)) delete env[k];
  return env;
}

test('config: delegate mode is off in every profile and switched on by XEND_DELEGATE or .xend.json', () => {
  for (const name of Object.keys(config.PROFILES)) assert.strictEqual(config.PROFILES[name].delegate, false, name);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-cfg-'));
  assert.strictEqual(config.resolve({ env: {}, cwd }).delegate, false);
  assert.strictEqual(config.resolve({ env: { XEND_DELEGATE: '1' }, cwd }).delegate, true);
  assert.strictEqual(config.resolve({ env: { XEND_DELEGATE: 'off' }, cwd }).delegate, false);
  fs.writeFileSync(path.join(cwd, '.xend.json'), JSON.stringify({ delegate: true }));
  assert.strictEqual(config.resolve({ env: {}, cwd }).delegate, true);
});

test('context: the delegate rule is added only when the mode is on, and never alongside architect mode', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() });
  const off = context.build(cfg, {});
  assert.ok(!off.includes('Delegate mode'), 'off by default: no prefix cost');
  assert.ok(!off.includes(', delegate)'));

  const on = context.build(Object.assign({}, cfg, { delegate: true }), {});
  assert.ok(on.startsWith('xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + ', delegate).'), on.slice(0, 80));
  assert.ok(on.endsWith(context.DELEGATE), 'the rule closes the block');
  assert.ok(on.includes('subagent_type xend-subtask'), 'the rule names the shipped agent');
  assert.ok(context.DELEGATE.length < 500, 'paid every turn while on: ' + context.DELEGATE.length);

  const both = context.build(Object.assign({}, cfg, { delegate: true, architect: Object.assign({}, cfg.architect, { enabled: true }) }), {});
  assert.ok(both.includes('Architect mode:'));
  assert.ok(!both.includes('Delegate mode'), 'architect mode already delegates; one rule only');
});

test('session-start: a /xend:delegate session override reaches the block after a reset', () => {
  const env = isolatedEnv();
  const sid = 'dg-session';
  const dir = state.sessionDir(sid, env);
  state.setSessionOverride(dir, 'delegate', true);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-dg-cwd-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'session-start.js')],
    { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'compact' }), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  const block = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(block.includes(context.DELEGATE), block);

  state.setSessionOverride(dir, 'delegate', false);
  const r2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'session-start.js')],
    { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'clear' }), encoding: 'utf8', env: Object.assign({}, env, { XEND_DELEGATE: '1' }) });
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(!JSON.parse(r2.stdout).hookSpecificOutput.additionalContext.includes('Delegate mode'), 'a session off beats the environment');
});

test('xend-cli delegate: on prints the rule, off and status report, anything else is refused', () => {
  const env = isolatedEnv();
  const run = (...args) => spawnSync(process.execPath, [CLI, 'delegate', 'dg-cli', ...args], { encoding: 'utf8', env, cwd: os.tmpdir() });
  assert.match(run().stdout, /^delegate mode: off\n$/);
  const on = run('on');
  assert.strictEqual(on.status, 0, on.stderr);
  assert.ok(on.stdout.startsWith('delegate mode: on (this session)\n'));
  assert.ok(on.stdout.includes(context.DELEGATE));
  assert.ok(run('status').stdout.startsWith('delegate mode: on (this session)'));
  assert.match(run('off').stdout, /^delegate mode: off \(this session\)\n$/);
  const bad = run('maybe');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /takes on, off or status/);
  const arch = spawnSync(process.execPath, [CLI, 'delegate', 'dg-cli2', 'on'], { encoding: 'utf8', env: Object.assign({}, env, { XEND_ARCHITECT: '1' }), cwd: os.tmpdir() });
  assert.match(arch.stdout, /architect mode is on too and takes precedence/);
});

test('xend-subtask agent: lean tool list, the caller\'s model, a short listing, and outside the architect verifier', () => {
  const text = fs.readFileSync(path.join(ROOT, 'agents', 'xend-subtask.md'), 'utf8');
  const fm = text.split('---')[1];
  const field = (k) => (new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(fm) || [])[1];
  assert.strictEqual(field('name'), 'xend-subtask');
  assert.strictEqual(field('model'), 'inherit', 'a Haiku worker cost +34.5% in bench r15');
  assert.deepStrictEqual(field('tools').split(',').map((t) => t.trim()), ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob']);
  assert.ok(field('description').length <= 120, 'listed in every session: ' + field('description').length);
  assert.strictEqual(verify.agentKind('xend:xend-subtask'), null, 'its reply is free-form; the architect reply contract does not apply');
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'delegate', 'SKILL.md'), 'utf8');
  assert.match(skill, /^disable-model-invocation: true$/m, 'user-invoked only, so the skill index carries no description');
});
