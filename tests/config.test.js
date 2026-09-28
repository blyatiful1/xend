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

test('XEND_ARCHITECT_MIN_FILES overrides architect.minFiles; invalid values are ignored', () => {
  const one = config.resolve({ env: { XEND_ARCHITECT_MIN_FILES: '1' }, cwd: os.tmpdir() });
  assert.strictEqual(one.architect.minFiles, 1);
  const five = config.resolve({ env: { XEND_ARCHITECT_MIN_FILES: '5', XEND_ARCHITECT: '1' }, cwd: os.tmpdir() });
  assert.strictEqual(five.architect.minFiles, 5);
  // rest of the architect shape survives the override (explicitly enabled here: architect is
  // opt-in by default since bench r6/r7)
  assert.strictEqual(five.architect.enabled, true);

  const base = config.resolve({ env: {}, cwd: os.tmpdir() }).architect.minFiles; // balanced default: 4
  for (const bad of ['0', '-1', '3.5', 'abc', '']) {
    const cfg = config.resolve({ env: { XEND_ARCHITECT_MIN_FILES: bad }, cwd: os.tmpdir() });
    assert.strictEqual(cfg.architect.minFiles, base, 'bad value: ' + JSON.stringify(bad));
  }
});

test('config: architect.defaultTier is "lite" in every profile; XEND_ARCHITECT_TIER sets forceTier and is absent by default', () => {
  for (const profileEnv of [{}, { XEND_PROFILE: 'lite' }, { XEND_PROFILE: 'aggressive' }]) {
    const cfg = config.resolve({ env: profileEnv, cwd: os.tmpdir() });
    assert.strictEqual(cfg.architect.defaultTier, 'lite', JSON.stringify(profileEnv));
    assert.strictEqual(cfg.architect.forceTier, undefined, JSON.stringify(profileEnv));
  }

  const forcedLite = config.resolve({ env: { XEND_ARCHITECT_TIER: 'lite' }, cwd: os.tmpdir() });
  assert.strictEqual(forcedLite.architect.forceTier, 'lite');
  const forcedWorker = config.resolve({ env: { XEND_ARCHITECT_TIER: 'worker' }, cwd: os.tmpdir() });
  assert.strictEqual(forcedWorker.architect.forceTier, 'worker');
  // rest of the architect shape survives
  assert.strictEqual(forcedWorker.architect.defaultTier, 'lite');

  const bogus = config.resolve({ env: { XEND_ARCHITECT_TIER: 'bogus' }, cwd: os.tmpdir() });
  assert.strictEqual(bogus.architect.forceTier, undefined);
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

test('a repository .xend.json cannot turn auto-test on, pick its command, trust it, or stretch its timeouts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-cfg-'));
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({
    profile: 'lite', trustTestCommands: true,
    autoTest: { enabled: true, command: 'pytest -p evil', timeoutMs: 600000, maxMs: 600000, maxChars: 800 },
    architect: { verifyTimeoutMs: 900000 },
  }));
  const cfg = config.resolve({ env: {}, cwd: dir });
  assert.strictEqual(cfg.autoTest.enabled, false, 'lite keeps auto-test off');
  assert.strictEqual(cfg.autoTest.command, '');
  assert.strictEqual(cfg.autoTest.timeoutMs, 20000);
  assert.strictEqual(cfg.autoTest.maxMs, 8000);
  assert.strictEqual(cfg.autoTest.maxChars, 800, 'harmless keys still apply');
  assert.strictEqual(cfg.trustTestCommands, false);
  assert.strictEqual(cfg.architect.verifyTimeoutMs, 120000);
  assert.deepStrictEqual(cfg.ignoredProjectKeys.sort(), ['architect.verifyTimeoutMs', 'autoTest.command', 'autoTest.enabled', 'autoTest.maxMs', 'autoTest.timeoutMs', 'trustTestCommands']);
  // turning it off is always allowed
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({ autoTest: { enabled: false } }));
  assert.strictEqual(config.resolve({ env: {}, cwd: dir }).autoTest.enabled, false);
});

test('trustTestCommands comes from the environment or user config; timeouts are capped below the hook timeouts', () => {
  assert.strictEqual(config.resolve({ env: {}, cwd: os.tmpdir() }).trustTestCommands, false);
  assert.strictEqual(config.resolve({ env: { XEND_TRUST_TESTS: '1' }, cwd: os.tmpdir() }).trustTestCommands, true);
  assert.strictEqual(config.resolve({ env: { XEND_TRUST_TESTS: '0' }, cwd: os.tmpdir() }).trustTestCommands, false);
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-xdg-'));
  fs.mkdirSync(path.join(xdg, 'xend'));
  fs.writeFileSync(path.join(xdg, 'xend', 'config.json'), JSON.stringify({ trustTestCommands: true, autoTest: { timeoutMs: 600000 } }));
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const cfg = config.resolve({ env: {}, cwd: os.tmpdir() });
    assert.strictEqual(cfg.trustTestCommands, true);
    assert.strictEqual(cfg.autoTest.timeoutMs, config.AUTOTEST_TIMEOUT_CAP_MS);
  } finally { if (saved === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved; }
});

test('context block is stable and contains no timestamps', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() });
  const a = context.build(cfg, {});
  const b = context.build(cfg, {});
  assert.strictEqual(a, b);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a));

  // Prefix regression guard: with no opts.ponytail the block is exactly header + terse (with its
  // exemptions) + the work rule. The condensed-output contract lives in each [xend] marker, and
  // there is no delegation paragraph: a session pays for neither unless it uses them.
  const archOn = cfg.architect && cfg.architect.enabled;
  assert.strictEqual(archOn, false, 'balanced default: architect is opt-in');
  const baseParts = [
    'xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + ').',
    context.TERSE[cfg.terse] + ' ' + context.TERSE_EXEMPTIONS, context.READING,
  ];
  const base = baseParts.join('\n\n');
  assert.strictEqual(a, base, 'base block changed');
  assert.ok(!a.includes('[xend]'), 'the marker explains itself; the block must not');
  const offOpts = { ponytail: { owns: true, upstreamOwns: false, injecting: false, mode: 'full', text: 'adapted', strict: false } };
  assert.strictEqual(context.build(Object.assign({}, cfg, { ponytail: 'off' }), offOpts), base);

  // Same guard with architect explicitly enabled: the paragraph and header suffix appear.
  const cfgArchOn = Object.assign({}, cfg, { architect: Object.assign({}, cfg.architect, { enabled: true }) });
  const aOn = context.build(cfgArchOn, {});
  const onParts = [
    'xend active (profile ' + cfgArchOn.profile + ', terse ' + cfgArchOn.terse + ', architect' + ').',
    context.TERSE[cfgArchOn.terse] + ' ' + context.TERSE_EXEMPTIONS, context.READING,
    context.architectText(undefined, cfgArchOn.architect.gate !== false),
  ];
  assert.strictEqual(aOn, onParts.join('\n\n'), 'architect-enabled block regressed');

  // Variant-aware ceilings (characters; ~4 per token). The whole shipped block used to be 2,869
  // characters; bench r8 priced that at several percent of a short task, so these stay tight.
  const lean = (over) => context.build(Object.assign({}, cfg, { architect: { enabled: false } }, over), { ponytail: { owns: true, upstreamOwns: false, injecting: false, mode: 'full', text: over.ponytailText || 'adapted', strict: false } });
  const blockOff = lean({ ponytail: 'off' });
  const blockAdapted = lean({ ponytail: 'full', ponytailText: 'adapted' });
  const blockUpstream = lean({ ponytail: 'full', ponytailText: 'upstream' });
  assert.ok(blockOff.length < 850, 'ponytail off: ' + blockOff.length);
  assert.ok(blockAdapted.length < 1250, 'adapted lean rules: ' + blockAdapted.length);
  assert.ok(blockUpstream.length < 7200, 'upstream-verbatim lean rules: ' + blockUpstream.length);
  const off = context.build(Object.assign({}, cfg, { terse: 'off', delegation: false, shape: { enabled: false }, readingDiscipline: false }), {});
  assert.ok(!off.includes('Replies:'));
  assert.ok(!off.includes('Work in few'));
});

test('ponytail profile defaults, env overrides and clamps', () => {
  // Lean rules are opt-in in every profile since bench r8 (docs/RESEARCH.md H19).
  const base = config.resolve({ env: {}, cwd: os.tmpdir() });
  assert.strictEqual(base.ponytail, 'off');
  assert.strictEqual(base.ponytailText, 'adapted');
  assert.strictEqual(base.upstream.ponytail, 'auto');
  assert.strictEqual(base.ponytailStrict, false);

  const lite = config.resolve({ env: { XEND_PROFILE: 'lite' }, cwd: os.tmpdir() });
  assert.strictEqual(lite.ponytail, 'off');
  assert.strictEqual(lite.ponytailText, 'adapted');

  const agg = config.resolve({ env: { XEND_PROFILE: 'aggressive' }, cwd: os.tmpdir() });
  assert.strictEqual(agg.ponytail, 'off');
  assert.strictEqual(agg.ponytailText, 'adapted');

  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL: 'ultra' }, cwd: os.tmpdir() }).ponytail, 'ultra');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL: 'bogus' }, cwd: os.tmpdir() }).ponytail, 'off');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL: 'full' }, cwd: os.tmpdir() }).ponytail, 'full');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_TEXT: 'bogus' }, cwd: os.tmpdir() }).ponytailText, 'adapted');
  assert.strictEqual(config.resolve({ env: { XEND_UPSTREAM_PONYTAIL: 'ignore' }, cwd: os.tmpdir() }).upstream.ponytail, 'ignore');
  assert.strictEqual(config.resolve({ env: { XEND_UPSTREAM_PONYTAIL: 'bogus' }, cwd: os.tmpdir() }).upstream.ponytail, 'auto');
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_STRICT: '1' }, cwd: os.tmpdir() }).ponytailStrict, true);
  assert.strictEqual(config.resolve({ env: { XEND_PONYTAIL_STRICT: 'off' }, cwd: os.tmpdir() }).ponytailStrict, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-pony-cfg-'));
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({ ponytail: 'full' }));
  assert.strictEqual(config.resolve({ env: {}, cwd: dir }).ponytail, 'full');
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
