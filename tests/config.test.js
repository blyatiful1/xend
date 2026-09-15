'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../scripts/lib/config.js');
const context = require('../scripts/lib/context.js');
const state = require('../scripts/lib/state.js');

test('profile defaults and env overrides', () => {
  const base = config.resolve({ env: {}, cwd: os.tmpdir() });
  assert.strictEqual(base.profile, 'balanced');
  assert.strictEqual(base.shape.maxChars, 12000);
  const agg = config.resolve({ env: { XEND_PROFILE: 'aggressive', XEND_TERSE: 'lite', XEND_SHAPE_MAX_CHARS: '5000' }, cwd: os.tmpdir() });
  assert.strictEqual(agg.profile, 'aggressive');
  assert.strictEqual(agg.terse, 'lite');
  assert.strictEqual(agg.shape.maxChars, 5000);
  assert.strictEqual(agg.contextEditing.enabled, true);
  const off = config.resolve({ env: { XEND_SHAPE: '0' }, cwd: os.tmpdir() });
  assert.strictEqual(off.shape.enabled, false);
});

test('project .xend.json overrides profile defaults and can switch profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-cfg-'));
  const sub = path.join(dir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({ profile: 'lite', shape: { dedupe: false }, terse: 'off' }));
  const cfg = config.resolve({ env: {}, cwd: sub });
  assert.strictEqual(cfg.profile, 'lite');
  assert.strictEqual(cfg.shape.dedupe, false);
  assert.strictEqual(cfg.shape.maxChars, 30000);
  assert.strictEqual(cfg.terse, 'off');
  assert.ok(cfg.sources.some((s) => s.endsWith('.xend.json')));
});

test('context block is stable and contains no timestamps', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() });
  const a = context.build(cfg, {});
  const b = context.build(cfg, {});
  assert.strictEqual(a, b);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a));
  assert.ok(a.includes('[xend]'));
  assert.ok(a.length < 3000, 'block stays small: ' + a.length);
  const off = context.build(Object.assign({}, cfg, { terse: 'off', delegation: false, shape: { enabled: false }, readingDiscipline: false }), {});
  assert.ok(!off.includes('Output style'));
  assert.ok(!off.includes('Subagents'));
});

test('session state dir, overrides, and pruning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-state-'));
  const env = { XEND_STATE_DIR: root };
  const dir = state.sessionDir('sess/1', env);
  assert.ok(dir.startsWith(root));
  assert.ok(!dir.includes('sess/1'));
  state.setSessionOverride(dir, 'terse', 'off');
  assert.deepStrictEqual(state.sessionOverrides(dir), { terse: 'off' });
  const old = path.join(root, 'old');
  fs.mkdirSync(old);
  const past = new Date(Date.now() - 10 * 86400000);
  fs.utimesSync(old, past, past);
  assert.strictEqual(state.pruneOld(env, 7), 1);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(dir));
});
