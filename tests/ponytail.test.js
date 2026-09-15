'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ponytail = require('../scripts/lib/ponytail.js');
const context = require('../scripts/lib/context.js');
const config = require('../scripts/lib/config.js');

const ROOT = path.resolve(__dirname, '..');
const LEVELS = ['lite', 'full', 'ultra'];
const REFRESH = 'refresh procedure: vendor/ponytail/PROVENANCE.md';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fixture(level) { return fs.readFileSync(path.join(__dirname, 'fixtures', 'ponytail-injected-' + level + '.md'), 'utf8'); }

// --- A. fidelity: byte-identity against upstream's own captured hook output ----
// The fixtures carry one trailing newline that upstream's writeHookOutput adds; the port
// does not. Both sides are trimEnd()-normalised, and the raw byte counts are asserted too
// so a future change to the trimming rule cannot hide real drift.
test('A. upstreamText reproduces upstream hook output byte for byte', () => {
  const expected = { lite: [5225, 5224], full: [5252, 5251], ultra: [5290, 5289] };
  for (const level of LEVELS) {
    const mine = ponytail.upstreamText(level, { strict: true });
    const theirs = fixture(level);
    assert.strictEqual(Buffer.byteLength(mine), expected[level][0], level + ' port bytes');
    assert.strictEqual(Buffer.byteLength(theirs), expected[level][1], level + ' fixture bytes');
    assert.strictEqual(mine.trimEnd(), theirs.trimEnd(), 'filtered text drifted from upstream at ' + level + '; ' + REFRESH);
  }
});

// --- B. hash pins, compared against the values recorded in PROVENANCE.md -------
test('B. vendored SKILL.md matches the hashes recorded in PROVENANCE.md', () => {
  const prov = fs.readFileSync(path.join(ROOT, 'vendor', 'ponytail', 'PROVENANCE.md'), 'utf8');
  const raw = fs.readFileSync(path.join(ROOT, 'vendor', 'ponytail', 'SKILL.md'));
  const body = raw.toString('utf8').replace(/^---[\s\S]*?---\s*/, '');
  assert.ok(prov.includes(ponytail.FILE_SHA256), 'PROVENANCE.md must record the file sha256; ' + REFRESH);
  assert.ok(prov.includes(ponytail.BODY_SHA256), 'PROVENANCE.md must record the body sha256; ' + REFRESH);
  assert.strictEqual(sha256(raw), ponytail.FILE_SHA256, 'vendor/ponytail/SKILL.md changed; ' + REFRESH);
  assert.strictEqual(sha256(Buffer.from(body, 'utf8')), ponytail.BODY_SHA256, 'post-frontmatter body changed; ' + REFRESH);
  assert.strictEqual(raw.length, 6637);
  assert.strictEqual(Buffer.byteLength(body), 5700);
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.ok(notices.includes(ponytail.FILE_SHA256));
  assert.ok(notices.includes('Permission is hereby granted'), 'the full MIT text must be inline');
});

// --- C. the filter strips the mode-specific lines and nothing else ------------
test('C. any two levels differ by exactly three lines', () => {
  for (const a of LEVELS) {
    for (const b of LEVELS) {
      if (a === b) continue;
      const x = ponytail.upstreamText(a, { strict: true }).split('\n');
      const y = ponytail.upstreamText(b, { strict: true }).split('\n');
      assert.strictEqual(x.length, y.length, a + ' vs ' + b + ' line count');
      const diff = x.filter((l, i) => l !== y[i]);
      assert.strictEqual(diff.length, 3, a + ' vs ' + b + ' differing lines: ' + JSON.stringify(diff));
    }
  }
});

// --- D. detection ------------------------------------------------------------
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xend-pony-')); }
function write(file, s) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof s === 'string' ? s : JSON.stringify(s)); }

function pluginInstall(claudeDir, opts) {
  opts = opts || {};
  const root = path.join(claudeDir, 'plugins', 'cache', 'mkt', 'ponytail', '4.10.0');
  write(path.join(root, '.claude-plugin', 'plugin.json'), { name: 'ponytail', version: '4.10.0', hooks: './hooks/claude-codex-hooks.json' });
  write(path.join(root, 'hooks', 'claude-codex-hooks.json'), {
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node ponytail-activate.js' }] }],
      SubagentStart: opts.subagent === false ? [] : [{ hooks: [{ type: 'command', command: 'node ponytail-subagent.js' }] }],
    },
  });
  write(path.join(claudeDir, 'plugins', 'installed_plugins.json'), {
    version: 2, plugins: { 'ponytail@mkt': [{ scope: 'user', installPath: root, version: '4.10.0' }] },
  });
  return root;
}

test('D. detection matrix', () => {
  const home = tmp();
  const cwd = tmp();
  const env = { XDG_CONFIG_HOME: path.join(home, 'noconfig') };

  // D1: installed marketplace plugin with a string-form hooks manifest
  const cd1 = path.join(home, 'd1');
  pluginInstall(cd1);
  const d1 = ponytail.detect({ env, cwd, claudeDir: cd1 });
  assert.strictEqual(d1.installed, true);
  assert.strictEqual(d1.channel, 'plugin');
  assert.strictEqual(d1.injecting, true);
  assert.strictEqual(d1.version, '4.10.0');
  assert.strictEqual(d1.marketplace, 'mkt');
  assert.strictEqual(d1.subagentHook, true);
  assert.ok(d1.evidence.length);

  // D1 disabled via enabledPlugins: absent means enabled, explicit false disables
  const cd1b = path.join(home, 'd1b');
  pluginInstall(cd1b);
  write(path.join(cd1b, 'settings.json'), { enabledPlugins: { 'ponytail@mkt': false } });
  const d1b = ponytail.detect({ env, cwd, claudeDir: cd1b });
  assert.strictEqual(d1b.injecting, false);
  assert.strictEqual(d1b.capable, false);
  assert.strictEqual(ponytail.owns(d1b, { upstream: { ponytail: 'auto' } }).upstreamOwns, false);

  // D2: skills-dir plugin
  const cd2 = path.join(home, 'd2');
  write(path.join(cd2, 'skills', 'ponytail', '.claude-plugin', 'plugin.json'), { name: 'ponytail', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ponytail-activate.js' }] }] } });
  const d2 = ponytail.detect({ env, cwd, claudeDir: cd2 });
  assert.strictEqual(d2.channel, 'skills-dir');
  assert.strictEqual(d2.injecting, true);

  // D3: bare SKILL.md, no manifest -> installed but injects nothing (self-activates zero times)
  const cd3 = path.join(home, 'd3');
  write(path.join(cd3, 'skills', 'ponytail', 'SKILL.md'), '# ponytail\n');
  const d3 = ponytail.detect({ env, cwd, claudeDir: cd3 });
  assert.strictEqual(d3.channel, 'skill-only');
  assert.strictEqual(d3.installed, true);
  assert.strictEqual(d3.injecting, false);

  // D4: activate hook wired straight into a settings file
  const cd4 = path.join(home, 'd4');
  write(path.join(cd4, 'settings.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/bin/ponytail-activate.js' }] }] } });
  const d4 = ponytail.detect({ env, cwd, claudeDir: cd4 });
  assert.strictEqual(d4.channel, 'settings-hook');
  assert.strictEqual(d4.injecting, true);

  // D5: PONYTAIL_DEFAULT_MODE=off -> upstream's hook exits before emitting anything, but it
  // still owns the topic: the user configured one source of truth.
  const d5off = ponytail.detect({ env: Object.assign({}, env, { PONYTAIL_DEFAULT_MODE: 'off' }), cwd, claudeDir: cd1 });
  assert.strictEqual(d5off.injecting, false);
  assert.strictEqual(d5off.capable, true);
  assert.strictEqual(ponytail.owns(d5off, { upstream: { ponytail: 'auto' } }).upstreamOwns, true);
  assert.strictEqual(ponytail.detect({ env: Object.assign({}, env, { PONYTAIL_DEFAULT_MODE: 'ultra' }), cwd, claudeDir: cd1 }).mode, 'ultra');
  // D5 via the ponytail config file
  const xdg = tmp();
  write(path.join(xdg, 'ponytail', 'config.json'), { defaultMode: 'lite' });
  assert.strictEqual(ponytail.detect({ env: { XDG_CONFIG_HOME: xdg }, cwd, claudeDir: cd1 }).mode, 'lite');

  // D6: flag file alone is corroboration, never evidence of an install
  const cd6 = path.join(home, 'd6');
  write(path.join(cd6, '.ponytail-active'), 'full');
  const d6 = ponytail.detect({ env, cwd, claudeDir: cd6 });
  assert.strictEqual(d6.installed, false);
  assert.strictEqual(d6.injecting, false);

  // ownership switches
  const ignore = ponytail.owns(d1, { upstream: { ponytail: 'ignore' } });
  assert.strictEqual(ignore.ownsLean, true);
  assert.strictEqual(ignore.upstreamOwns, false);
  const yieldNothing = ponytail.owns(d6, { upstream: { ponytail: 'yield' } });
  assert.strictEqual(yieldNothing.upstreamOwns, true);
  assert.strictEqual(ponytail.owns(d1, { upstream: { ponytail: 'auto' } }).upstreamOwns, true);
  assert.strictEqual(ponytail.owns(d3, { upstream: { ponytail: 'auto' } }).upstreamOwns, false);
});

// --- E/F/G/H/I. composition --------------------------------------------------
function blockFor(o) {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() });
  cfg.terse = o.terse === undefined ? 'full' : o.terse;
  cfg.ponytail = o.level;
  cfg.ponytailText = o.text;
  cfg.ponytailStrict = o.strict === true;
  cfg.upstream = { ponytail: o.upstream };
  const own = ponytail.owns(o.detected, cfg);
  return context.build(cfg, {
    ponytail: { owns: own.ownsLean, upstreamOwns: own.upstreamOwns, injecting: own.injecting, mode: o.detected.mode, channel: o.detected.channel, text: cfg.ponytailText, strict: cfg.ponytailStrict },
  });
}

const DETECTED = {
  none: { installed: false, injecting: false, channel: null, mode: 'full' },
  plugin: { installed: true, capable: true, injecting: true, channel: 'plugin', mode: 'full' },
  pluginOff: { installed: true, capable: true, injecting: false, channel: 'plugin', mode: 'off' },
  pluginDisabled: { installed: true, capable: false, injecting: false, channel: 'plugin', mode: 'full' },
  skillOnly: { installed: true, injecting: false, channel: 'skill-only', mode: 'full' },
};

test('E. the ruleset reaches the model exactly once, in every combination', () => {
  for (const dk of Object.keys(DETECTED)) {
    for (const level of config.PONYTAIL_LEVELS) {
      for (const upstream of config.UPSTREAM_MODES) {
        for (const text of config.PONYTAIL_TEXTS) {
          for (const strict of [false, true]) {
            const b = blockFor({ detected: DETECTED[dk], level, upstream, text, strict });
            const label = [dk, level, upstream, text, strict].join('/');
            const count = (s) => b.split(s).length - 1;
            assert.ok(count('Lean (adapted from ponytail)') <= 1, 'duplicate adapted ruleset: ' + label);
            assert.ok(count('PONYTAIL MODE ACTIVE') <= 1, 'duplicate upstream ruleset: ' + label);
            assert.ok(!(count('Lean (adapted from ponytail)') && count('The ponytail plugin injects its own')), 'both branches emitted: ' + label);
            assert.ok(!(count('PONYTAIL MODE ACTIVE') && count('The ponytail plugin injects its own')), 'both branches emitted: ' + label);
          }
        }
      }
    }
  }
});

test('F. the ladder is present exactly when a ruleset is enabled', () => {
  const adapted = blockFor({ detected: DETECTED.none, level: 'full', upstream: 'auto', text: 'adapted' });
  assert.ok(adapted.includes('needed at all (YAGNI)'));
  assert.ok(!adapted.includes('Does this need to exist at all?'));
  assert.ok(adapted.includes(', lean full)'));

  const upstreamText = blockFor({ detected: DETECTED.none, level: 'full', upstream: 'auto', text: 'upstream' });
  assert.ok(upstreamText.includes('Does this need to exist at all?'));

  const off = blockFor({ detected: DETECTED.none, level: 'off', upstream: 'auto', text: 'adapted' });
  assert.ok(!off.includes('needed at all (YAGNI)'));
  assert.ok(!off.includes('Does this need to exist at all?'));
  assert.ok(!off.includes(', lean '));

  // B3: upstream is installed with mode off, so nothing is injected by either side
  const b3 = blockFor({ detected: DETECTED.pluginOff, level: 'full', upstream: 'auto', text: 'adapted' });
  assert.ok(!b3.includes('needed at all (YAGNI)'));
  assert.ok(!b3.includes('The ponytail plugin injects its own'));
  assert.ok(!b3.includes(', lean '));

  // B4: a skill-only or disabled install injects nothing, so xend keeps ownership
  for (const d of [DETECTED.skillOnly, DETECTED.pluginDisabled]) {
    const b4 = blockFor({ detected: d, level: 'full', upstream: 'auto', text: 'adapted' });
    assert.ok(b4.includes('needed at all (YAGNI)'));
  }
  // XEND_UPSTREAM_PONYTAIL=ignore overrides B3
  const b3ignored = blockFor({ detected: DETECTED.pluginOff, level: 'full', upstream: 'ignore', text: 'adapted' });
  assert.ok(b3ignored.includes('needed at all (YAGNI)'));

  // B2: upstream owns; xend emits the reconciliation note and no ruleset
  const b2 = blockFor({ detected: DETECTED.plugin, level: 'full', upstream: 'auto', text: 'adapted' });
  assert.ok(b2.includes('The ponytail plugin injects its own'));
  assert.ok(!b2.includes('needed at all (YAGNI)'));
  assert.ok(b2.includes(', lean full (ponytail plugin))'));
});

test('G. xend-authored lean text carries no arrows, no caveman, no /ponytail switch', () => {
  const xendText = [context.LEAN, context.LEAN_UPSTREAM, context.LEAN_BRIDGE].concat(Object.values(context.LEAN_LEVEL));
  for (const s of xendText) {
    assert.ok(!s.includes('→'), 'arrow in xend-authored lean text: ' + s.slice(0, 40));
    assert.ok(!/caveman/i.test(s), 'caveman reference: ' + s.slice(0, 40));
    assert.ok(!s.includes('/ponytail '), 'upstream switch command: ' + s.slice(0, 40));
  }
  // The upstream-verbatim text keeps all four arrows by design (SPEC section 7.1); if this
  // count changes, the "byte-identical" claims in the docs and tests change with it.
  const body = fs.readFileSync(path.join(ROOT, 'vendor', 'ponytail', 'SKILL.md'), 'utf8');
  assert.strictEqual((body.match(/→/g) || []).length, 4);
  assert.strictEqual((ponytail.upstreamText('full', { strict: true }).match(/→/g) || []).length, 4);
});

test('H. strict mode emits upstream text and nothing else of xend\'s', () => {
  const strict = blockFor({ detected: DETECTED.none, level: 'full', upstream: 'auto', text: 'upstream', strict: true });
  // the CONDENSED part mentions "[xend]" on its own, so count against a ponytail-off block
  const tags = (s) => s.split(' [xend]').length - 1;
  const baseTags = tags(blockFor({ detected: DETECTED.none, level: 'off', upstream: 'auto', text: 'adapted' }));
  assert.strictEqual(tags(strict), baseTags, 'strict mode must add no [xend] tag');
  assert.ok(!strict.includes(context.LEAN_BRIDGE));
  assert.ok(!strict.includes(', lean '));
  assert.ok(strict.includes(ponytail.upstreamText('full', { strict: true })));
  // and it is exactly the fidelity text of section A
  assert.ok(strict.includes(fixture('full').trimEnd()));
  // non-strict adds exactly the three tags
  const loose = blockFor({ detected: DETECTED.none, level: 'full', upstream: 'auto', text: 'upstream' });
  assert.strictEqual(tags(loose), baseTags + 3);
});

test('I. the block is stable and carries no timestamp', () => {
  const o = { detected: DETECTED.none, level: 'full', upstream: 'auto', text: 'adapted' };
  assert.strictEqual(blockFor(o), blockFor(o));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(blockFor(o)));
});

test('levelDelta is small and names the new level only', () => {
  for (const level of ['lite', 'full', 'ultra']) {
    const d = ponytail.levelDelta(level);
    assert.ok(Buffer.byteLength(d) < 200, 'delta stays small: ' + Buffer.byteLength(d));
    assert.ok(d.includes(context.LEAN_LEVEL[level]));
    assert.ok(!d.includes(context.LEAN));
  }
  assert.ok(!ponytail.levelDelta('off').includes(context.LEAN_LEVEL.full));
});
