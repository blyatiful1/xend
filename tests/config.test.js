'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../scripts/lib/config.js');
const context = require('../scripts/lib/context.js');
const state = require('../scripts/lib/state.js');
const ponytail = require('../scripts/lib/ponytail.js');

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

  // Prefix regression guard: with no opts.ponytail the block is byte-identical to the
  // pre-integration composition, so every existing caller and test is unaffected. The default
  // (balanced) profile has architect enabled, so that paragraph and header suffix are expected.
  const archOn = cfg.architect && cfg.architect.enabled;
  const preIntegrationParts = [
    'xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + (archOn ? ', architect' : '') + ').',
    context.TERSE[cfg.terse], context.TERSE_EXEMPTIONS, context.READING, context.CONDENSED, context.DELEGATION,
  ];
  if (archOn) preIntegrationParts.push(context.architectText());
  const preIntegration = preIntegrationParts.join('\n\n');
  assert.strictEqual(a, preIntegration, 'ponytail integration changed the base block');
  const offOpts = { ponytail: { owns: true, upstreamOwns: false, injecting: false, mode: 'full', text: 'adapted', strict: false } };
  assert.strictEqual(context.build(Object.assign({}, cfg, { ponytail: 'off' }), offOpts), preIntegration);

  // Three variant-aware ceilings. One number for all three would stop guarding anything:
  // the upstream-verbatim text is ~2.7x the adapted one and would swallow any regression.
  // architect is held disabled here: these ceilings guard the ponytail/lean composition, not
  // the (separately tested) architect paragraph.
  const lean = (over) => context.build(Object.assign({}, cfg, { architect: { enabled: false } }, over), { ponytail: { owns: true, upstreamOwns: false, injecting: false, mode: 'full', text: over.ponytailText || 'adapted', strict: false } });
  const blockOff = lean({ ponytail: 'off' });
  const blockAdapted = lean({ ponytail: 'full', ponytailText: 'adapted' });
  const blockUpstream = lean({ ponytail: 'full', ponytailText: 'upstream' });
  assert.ok(blockOff.length < 1800, 'ponytail off: ' + blockOff.length);
  assert.ok(blockAdapted.length < 2800, 'adapted lean rules: ' + blockAdapted.length);
  assert.ok(blockUpstream.length < 7200, 'upstream-verbatim lean rules: ' + blockUpstream.length);
  const off = context.build(Object.assign({}, cfg, { terse: 'off', delegation: false, shape: { enabled: false }, readingDiscipline: false }), {});
  assert.ok(!off.includes('Output style'));
  assert.ok(!off.includes('Subagents'));
});

test('ponytail profile defaults, env overrides and clamps', () => {
  const base = config.resolve({ env: {}, cwd: os.tmpdir() });
  assert.strictEqual(base.ponytail, 'full');
  assert.strictEqual(base.ponytailText, 'adapted');
  assert.strictEqual(base.upstream.ponytail, 'auto');
  assert.strictEqual(base.ponytailStrict, false);

  const lite = config.resolve({ env: { XEND_PROFILE: 'lite' }, cwd: os.tmpdir() });
  assert.strictEqual(lite.ponytail, 'lite');
  assert.strictEqual(lite.ponytailText, 'adapted');

  const agg = config.resolve({ env: { XEND_PROFILE: 'aggressive' }, cwd: os.tmpdir() });
  assert.strictEqual(agg.ponytail, 'full');
  assert.strictEqual(agg.ponytailText, 'adapted');

  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL: 'ultra' }, cwd: os.tmpdir() }).ponytail, 'ultra');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL: 'bogus' }, cwd: os.tmpdir() }).ponytail, 'full');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_TEXT: 'bogus' }, cwd: os.tmpdir() }).ponytailText, 'adapted');
  assert.strictEqual(config.resolve({ env: { XEND_UPSTREAM_PONYTAIL: 'ignore' }, cwd: os.tmpdir() }).upstream.ponytail, 'ignore');
  assert.strictEqual(config.resolve({ env: { XEND_UPSTREAM_PONYTAIL: 'bogus' }, cwd: os.tmpdir() }).upstream.ponytail, 'auto');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_STRICT: '1' }, cwd: os.tmpdir() }).ponytailStrict, true);
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_STRICT: 'off' }, cwd: os.tmpdir() }).ponytailStrict, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-pony-cfg-'));
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({ ponytail: 'off' }));
  assert.strictEqual(config.resolve({ env: {}, cwd: dir }).ponytail, 'off');
  assert.deepStrictEqual(config.PONYTAIL_LEVELS, ponytail.PONYTAIL_LEVELS);
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
