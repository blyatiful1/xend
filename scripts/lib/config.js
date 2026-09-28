'use strict';
// xend configuration: profile defaults, file/env overrides, deep merge.
// Resolution order (later wins): profile defaults < ~/.config/xend/config.json
// < nearest .xend.json walking up from cwd < XEND_* environment variables.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ponytail = require('./ponytail.js');
const { PONYTAIL_LEVELS, PONYTAIL_TEXTS, UPSTREAM_MODES } = ponytail;

const PROFILES = {
  lite: {
    profile: 'lite',
    terse: 'lite',
    ponytail: 'off',         // lean build rules, opt-in: bench r8 found the adapted text no cheaper and behind a pass-rate drop (docs/RESEARCH.md H19)
    ponytailText: 'adapted',
    upstream: { ponytail: 'auto' },
    ponytailStrict: false,
    shape: {
      enabled: true,
      maxChars: 30000,        // == Claude Code default cap: no extra head/tail cutting
      headRatio: 0.6,
      stripAnsi: true,
      collapseRepeats: true,
      testRunners: false,
      packageManagers: false,
      jsonMinify: false,
      dedupe: true,
      dedupeWindow: 12,
      dedupeMinChars: 2000,
      grepMaxLines: 0,        // 0 = no cap
      globMaxFiles: 0,
      readLimitMinLines: 0,   // 0 = off; else unranged Reads of files with >= N lines get limit=readLimit
      readLimit: 250,
      mcp: false,
    },
    contextEditing: { enabled: false, triggerTokens: 110000, keepToolUses: 12, clearAtLeastTokens: 40000 },
    delegation: true,
    checkpoint: true,
    readingDiscipline: true,
    // run the project's quick tests after an Edit and attach the result (saves the test turn); off in lite.
    // Runs only a command Claude Code would run without asking (an allow rule, bypass mode, or
    // trustTestCommands below): scripts/lib/permissions.js
    autoTest: { enabled: false, command: '', maxMs: 8000, timeoutMs: 20000, maxChars: 1200 },
    // let hooks run the detected test command without an allow rule; honoured from the user config
    // and XEND_TRUST_TESTS only, never from a repository's .xend.json
    trustTestCommands: false,
    // plan-then-build: opt-in (XEND_ARCHITECT=1, .xend.json {"architect":{"enabled":true}}, or /xend:plan on); bench r6/r7 measured +125% to +250% cost on greenfield project tasks
    architect: { enabled: false, gate: true, minFiles: 4, gateMaxDenials: 3, minToolCalls: 8, verify: true, verifyTimeoutMs: 120000, blockOnMismatch: true, defaultTier: 'lite' },
  },
  balanced: {
    profile: 'balanced',
    terse: 'full',
    ponytail: 'off',         // lean build rules, opt-in: bench r8 found the adapted text no cheaper and behind a pass-rate drop (docs/RESEARCH.md H19)
    ponytailText: 'adapted',
    upstream: { ponytail: 'auto' },
    ponytailStrict: false,
    shape: {
      enabled: true,
      maxChars: 12000,        // head+tail only for generic output kinds; never diffs or test runs
      headRatio: 0.6,
      stripAnsi: true,
      collapseRepeats: true,
      testRunners: true,      // drop-list only (known pass/progress rows), floor 60 lines
      packageManagers: true,
      jsonMinify: false,      // off: an Edit after `cat file.json` must match the file on disk
      dedupe: true,           // Bash only
      dedupeWindow: 12,
      dedupeMinChars: 2000,
      grepMaxLines: 400,
      globMaxFiles: 400,
      readLimitMinLines: 0,
      readLimit: 250,
      mcp: false,
    },
    contextEditing: { enabled: false, triggerTokens: 110000, keepToolUses: 12, clearAtLeastTokens: 40000 },
    delegation: true,
    checkpoint: true,
    readingDiscipline: true,
    autoTest: { enabled: true, command: '', maxMs: 8000, timeoutMs: 20000, maxChars: 1200 },
    trustTestCommands: false,
    // plan-then-build: opt-in (XEND_ARCHITECT=1, .xend.json {"architect":{"enabled":true}}, or /xend:plan on); bench r6/r7 measured +125% to +250% cost on greenfield project tasks
    architect: { enabled: false, gate: true, minFiles: 4, gateMaxDenials: 3, minToolCalls: 8, verify: true, verifyTimeoutMs: 120000, blockOnMismatch: true, defaultTier: 'lite' },
  },
  aggressive: {
    profile: 'aggressive',
    terse: 'full',
    ponytail: 'off',         // lean build rules, opt-in: bench r8 found the adapted text no cheaper and behind a pass-rate drop (docs/RESEARCH.md H19)
    ponytailText: 'adapted',      // upstream-verbatim text is opt-in (XEND_PONYTAIL_TEXT=upstream): bench r5 measured +16.7% cost on micro-tasks
    upstream: { ponytail: 'auto' },
    ponytailStrict: false,
    shape: {
      enabled: true,
      maxChars: 8000,
      headRatio: 0.6,
      stripAnsi: true,
      collapseRepeats: true,
      testRunners: true,
      packageManagers: true,
      jsonMinify: false,
      dedupe: false,          // off: server-side clearing may remove the result a dedupe marker points to
      dedupeWindow: 12,
      dedupeMinChars: 2000,
      grepMaxLines: 250,
      globMaxFiles: 250,
      readLimitMinLines: 800,
      readLimit: 250,
      mcp: true,
    },
    contextEditing: { enabled: true, triggerTokens: 110000, keepToolUses: 12, clearAtLeastTokens: 40000 },
    delegation: true,
    checkpoint: true,
    readingDiscipline: true,
    autoTest: { enabled: true, command: '', maxMs: 8000, timeoutMs: 20000, maxChars: 1200 },
    trustTestCommands: false,
    // plan-then-build: opt-in (XEND_ARCHITECT=1, .xend.json {"architect":{"enabled":true}}, or /xend:plan on); bench r6/r7 measured +125% to +250% cost on greenfield project tasks
    architect: { enabled: false, gate: true, minFiles: 4, gateMaxDenials: 3, minToolCalls: 8, verify: true, verifyTimeoutMs: 120000, blockOnMismatch: true, defaultTier: 'lite' },
  },
};

const TERSE_LEVELS = ['off', 'lite', 'full', 'ultra'];

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isObject(over)) return out;
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function readJson(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return null; }
}

function userConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'xend', 'config.json');
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'xend', 'config.json');
  }
  return path.join(os.homedir(), '.config', 'xend', 'config.json');
}

function findProjectConfig(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 64; i++) {
    for (const rel of ['.xend.json', path.join('.xend', 'config.json')]) {
      const f = path.join(dir, rel);
      const j = readJson(f);
      if (j) return { file: f, json: j };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function envOverrides(env) {
  const o = {};
  if (env.XEND_TERSE && TERSE_LEVELS.includes(env.XEND_TERSE)) o.terse = env.XEND_TERSE;
  if (env.XEND_SHAPE !== undefined) o.shape = { enabled: !/^(0|false|off)$/i.test(env.XEND_SHAPE) };
  if (env.XEND_SHAPE_MAX_CHARS && /^\d+$/.test(env.XEND_SHAPE_MAX_CHARS)) {
    o.shape = Object.assign(o.shape || {}, { maxChars: Number(env.XEND_SHAPE_MAX_CHARS) });
  }
  if (env.XEND_DEDUPE !== undefined) o.shape = Object.assign(o.shape || {}, { dedupe: !/^(0|false|off)$/i.test(env.XEND_DEDUPE) });
  if (env.XEND_DELEGATION !== undefined) o.delegation = !/^(0|false|off)$/i.test(env.XEND_DELEGATION);
  if (env.XEND_READING !== undefined) o.readingDiscipline = !/^(0|false|off)$/i.test(env.XEND_READING);
  for (const [name, key] of [['XEND_SHAPE_TESTRUNNERS', 'testRunners'], ['XEND_SHAPE_PKG', 'packageManagers'], ['XEND_SHAPE_HEADTAIL', 'headTail'], ['XEND_SHAPE_ANSI', 'stripAnsi'], ['XEND_SHAPE_MCP', 'mcp']]) {
    if (env[name] !== undefined) o.shape = Object.assign(o.shape || {}, { [key]: !/^(0|false|off)$/i.test(env[name]) });
  }
  if (env.XEND_PONYTAIL && PONYTAIL_LEVELS.includes(env.XEND_PONYTAIL)) o.ponytail = env.XEND_PONYTAIL;
  if (env.XEND_PONYTAIL_TEXT && PONYTAIL_TEXTS.includes(env.XEND_PONYTAIL_TEXT)) o.ponytailText = env.XEND_PONYTAIL_TEXT;
  if (env.XEND_UPSTREAM_PONYTAIL && UPSTREAM_MODES.includes(env.XEND_UPSTREAM_PONYTAIL)) o.upstream = { ponytail: env.XEND_UPSTREAM_PONYTAIL };
  if (env.XEND_PONYTAIL_STRICT !== undefined) o.ponytailStrict = !/^(0|false|off)$/i.test(env.XEND_PONYTAIL_STRICT);
  if (env.XEND_AUTOTEST !== undefined) o.autoTest = Object.assign({}, o.autoTest, { enabled: !/^(0|false|off)$/i.test(env.XEND_AUTOTEST) });
  if (env.XEND_AUTOTEST_CMD) o.autoTest = Object.assign({}, o.autoTest, { command: env.XEND_AUTOTEST_CMD });
  if (env.XEND_TRUST_TESTS !== undefined) o.trustTestCommands = !/^(0|false|off)$/i.test(env.XEND_TRUST_TESTS);
  if (env.XEND_CHECKPOINT !== undefined) o.checkpoint = !/^(0|false|off)$/i.test(env.XEND_CHECKPOINT);
  if (env.XEND_ARCHITECT !== undefined) o.architect = Object.assign({}, o.architect, { enabled: !/^(0|false|off)$/i.test(env.XEND_ARCHITECT) });
  if (env.XEND_ARCHITECT_GATE !== undefined) o.architect = Object.assign({}, o.architect, { gate: !/^(0|false|off)$/i.test(env.XEND_ARCHITECT_GATE) });
  if (env.XEND_VERIFY !== undefined) o.architect = Object.assign({}, o.architect, { verify: !/^(0|false|off)$/i.test(env.XEND_VERIFY) });
  if (env.XEND_ARCHITECT_MIN_FILES !== undefined) {
    const n = Number(env.XEND_ARCHITECT_MIN_FILES);
    if (Number.isInteger(n) && n >= 1) o.architect = Object.assign({}, o.architect, { minFiles: n });
  }
  if (env.XEND_ARCHITECT_TIER === 'lite' || env.XEND_ARCHITECT_TIER === 'worker') {
    o.architect = Object.assign({}, o.architect, { forceTier: env.XEND_ARCHITECT_TIER });
  }
  return o;
}

// Settings a repository's own .xend.json may not make: anything that decides which command a hook
// runs without a prompt, or for how long. A repository can still turn auto-test off. Returns the
// cleaned layer and the dotted names of what was dropped (cfg.ignoredProjectKeys).
function projectLayer(json) {
  const out = deepMerge({}, json);
  const ignored = [];
  if (Object.prototype.hasOwnProperty.call(out, 'trustTestCommands')) { delete out.trustTestCommands; ignored.push('trustTestCommands'); }
  if (isObject(out.autoTest)) {
    const at = out.autoTest = Object.assign({}, out.autoTest);
    if ('enabled' in at && at.enabled !== false) { delete at.enabled; ignored.push('autoTest.enabled'); }
    for (const k of ['command', 'timeoutMs', 'maxMs']) if (k in at) { delete at[k]; ignored.push('autoTest.' + k); }
  }
  if (isObject(out.architect) && 'verifyTimeoutMs' in out.architect) {
    out.architect = Object.assign({}, out.architect);
    delete out.architect.verifyTimeoutMs; ignored.push('architect.verifyTimeoutMs');
  }
  return { json: out, ignored };
}

// Hook timeouts in hooks/hooks.json: record-edit.js 30 s, subagent-stop.js 180 s. A run must end
// before its hook is killed, or its result (and the "too slow" switch-off) is lost.
const AUTOTEST_TIMEOUT_CAP_MS = 25000;
const VERIFY_TIMEOUT_CAP_MS = 170000;

// Only the three profiles themselves: a name such as "toString" or "__proto__" from a config file is
// not a profile.
function isProfile(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, name);
}

// Layered config. Each layer may set "profile" (switches the base defaults) and any override keys.
function resolve(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const sources = [];
  const layers = [];
  const user = readJson(userConfigPath());
  if (user) { layers.push(user); sources.push(userConfigPath()); }
  const proj = findProjectConfig(cwd);
  let ignored = [];
  if (proj) {
    const safe = projectLayer(proj.json);
    layers.push(safe.json); sources.push(proj.file); ignored = safe.ignored;
  }
  const envLayer = envOverrides(env);
  if (env.XEND_PROFILE && isProfile(env.XEND_PROFILE)) envLayer.profile = env.XEND_PROFILE;
  if (Object.keys(envLayer).length) { layers.push(envLayer); sources.push('env'); }

  let profileName = 'balanced';
  for (const l of layers) if (l && isProfile(l.profile)) profileName = l.profile;
  // a deep copy: deepMerge shares nested objects no layer overrides, and the lines below assign
  // into cfg.autoTest and cfg.architect, which must never write through to PROFILES
  let cfg = JSON.parse(JSON.stringify(PROFILES[profileName]));
  for (const l of layers) cfg = deepMerge(cfg, l);
  cfg.profile = profileName;
  if (!TERSE_LEVELS.includes(cfg.terse)) cfg.terse = PROFILES[profileName].terse;
  if (!PONYTAIL_LEVELS.includes(cfg.ponytail)) cfg.ponytail = PROFILES[profileName].ponytail;
  if (!PONYTAIL_TEXTS.includes(cfg.ponytailText)) cfg.ponytailText = PROFILES[profileName].ponytailText;
  if (!cfg.upstream || !UPSTREAM_MODES.includes(cfg.upstream.ponytail)) cfg.upstream = { ponytail: PROFILES[profileName].upstream.ponytail };
  cfg.ponytailStrict = cfg.ponytailStrict === true;
  // A non-object architect value (e.g. `false` from a session override or .xend.json) means
  // "disable it"; normalize back to a full profile-shaped object so every reader can assume
  // cfg.architect is always an object.
  if (!isObject(cfg.architect)) cfg.architect = Object.assign({}, PROFILES[profileName].architect, { enabled: false });
  // A dedupe marker must never point at a result that server-side clearing has removed.
  if (cfg.contextEditing && cfg.contextEditing.enabled && cfg.shape) {
    if (cfg.shape.dedupe && cfg.shape.dedupeWindow > cfg.contextEditing.keepToolUses) cfg.shape.dedupeWindow = cfg.contextEditing.keepToolUses;
  }
  cfg.trustTestCommands = cfg.trustTestCommands === true;
  // The auto-test is on only if the user's own choice (profile and autoTest.enabled from the user
  // config and the environment) turns it on: a repository picking a profile cannot, and it can
  // only turn it off. Only a literal true counts.
  if (isObject(cfg.autoTest)) {
    let own = PROFILES.balanced.autoTest.enabled;
    for (const l of [user, envLayer]) if (l && isProfile(l.profile)) own = PROFILES[l.profile].autoTest.enabled;
    for (const l of [user, envLayer]) if (l && isObject(l.autoTest) && 'enabled' in l.autoTest) own = l.autoTest.enabled === true;
    cfg.autoTest.enabled = own === true && cfg.autoTest.enabled === true;
  }
  if (isObject(cfg.autoTest)) cfg.autoTest.timeoutMs = Math.min(Number(cfg.autoTest.timeoutMs) || 20000, AUTOTEST_TIMEOUT_CAP_MS);
  cfg.architect.verifyTimeoutMs = Math.min(Number(cfg.architect.verifyTimeoutMs) || 120000, VERIFY_TIMEOUT_CAP_MS);
  cfg.sources = sources;
  if (ignored.length) cfg.ignoredProjectKeys = ignored;
  return cfg;
}

module.exports = { PROFILES, TERSE_LEVELS, projectLayer, AUTOTEST_TIMEOUT_CAP_MS, VERIFY_TIMEOUT_CAP_MS, PONYTAIL_LEVELS, PONYTAIL_TEXTS, UPSTREAM_MODES, resolve, deepMerge, userConfigPath, findProjectConfig, readJson };
