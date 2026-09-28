'use strict';
// Would Claude Code run this Bash command without asking? xend's hooks run commands (the auto-test
// after an edit, SubagentStop's re-run of a builder's verify command) where no permission prompt
// can be shown, so they run one only when the answer is yes:
//   - no deny or ask rule in any settings layer matches it (these always win), and
//   - an allow rule matches it, or the session runs in bypassPermissions mode, or the user opted
//     in at user level (trustTestCommands in ~/.config/xend/config.json, or XEND_TRUST_TESTS=1).
// Allow rules are read only where Claude Code reads them: managed settings, the user's settings,
// and the project root's .claude/settings.json and settings.local.json (the root is
// $CLAUDE_PROJECT_DIR, else the git root, else cwd). A settings file under the current directory,
// a ~/.claude left behind by a relocated CLAUDE_CONFIG_DIR, or the git root when it differs from
// the project dir can add deny and ask rules, never allow rules: a cloned or vendored repository
// inside the project must not be able to approve its own test command. When managed settings set
// allowManagedPermissionRulesOnly, only managed allow rules count. Pure reads; never throws.
//
// Not visible from a hook, so not honoured here: rules given on the command line
// (--disallowedTools, --settings), MDM or registry policy, and server-managed settings.
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('./settings.js');

// Where Claude Code reads managed (organisation) settings. Deliberately not overridable from the
// environment: a repository's .claude/settings.json can set env vars, and must not be able to
// hide the organisation's deny rules from this check.
function managedDir(platform) {
  switch (platform || process.platform) {
    case 'darwin': return '/Library/Application Support/ClaudeCode';
    case 'win32': return 'C:\\Program Files\\ClaudeCode';
    default: return '/etc/claude-code';
  }
}

function userDir(env) {
  env = env || process.env;
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Claude Code sets CLAUDE_PROJECT_DIR for every hook. Without it (a CLI run, a test), the project is
// taken to be the outermost git repository around cwd, not the nearest: a vendored or cloned repo
// with its own .git inside the project must not become the root whose allow rules count.
function projectRoot(cwd, env) {
  env = env || process.env;
  if (env.CLAUDE_PROJECT_DIR) return path.resolve(env.CLAUDE_PROJECT_DIR);
  const start = path.resolve(cwd || process.cwd());
  let root = null;
  for (let d = settings.findGitRoot(start); d; d = settings.findGitRoot(path.dirname(d))) {
    root = d;
    if (path.dirname(d) === d) break;
  }
  return root || start;
}

// Every settings file that can carry permission rules, most authoritative first. `allow: false`
// marks a file whose deny and ask rules count but whose allow rules do not (see the header).
function layerFiles(cwd, env, managed) {
  env = env || process.env;
  const files = [];
  const seen = new Set();
  const add = (layer, file, allow) => {
    const key = path.resolve(file);
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ layer, path: file, allow });
  };
  const m = managed || managedDir();
  add('managed', path.join(m, 'managed-settings.json'), true);
  try {
    const dropIn = path.join(m, 'managed-settings.d');
    for (const f of fs.readdirSync(dropIn).filter((x) => x.endsWith('.json')).sort()) add('managed', path.join(dropIn, f), true);
  } catch (_) {}
  add('user', path.join(userDir(env), 'settings.json'), true);
  // CLAUDE_CONFIG_DIR can come from a settings file's env block; the default location's deny and
  // ask rules still count, so it cannot hide them
  add('user', path.join(os.homedir(), '.claude', 'settings.json'), false);
  const root = projectRoot(cwd, env);
  add('project', path.join(root, '.claude', 'settings.json'), true);
  add('local', path.join(root, '.claude', 'settings.local.json'), true);
  const here = path.resolve(cwd || process.cwd());
  for (const r of [here, settings.findGitRoot(here)].filter(Boolean)) {
    add('project', path.join(r, '.claude', 'settings.json'), false);
    add('local', path.join(r, '.claude', 'settings.local.json'), false);
  }
  return files;
}

function loadRules(cwd, env, managed) {
  const out = { deny: [], ask: [], allow: [] };
  const loaded = [];
  for (const f of layerFiles(cwd, env, managed)) {
    const j = settings.readJsonSafe(f.path);
    if (j && typeof j === 'object') loaded.push({ f, j });
  }
  const managedOnly = loaded.some(({ f, j }) => f.layer === 'managed' && j.allowManagedPermissionRulesOnly === true);
  for (const { f, j } of loaded) {
    const p = j.permissions;
    if (!p || typeof p !== 'object') continue;
    for (const key of ['deny', 'ask', 'allow']) {
      if (key === 'allow' && (!f.allow || (managedOnly && f.layer !== 'managed'))) continue;
      for (const rule of Array.isArray(p[key]) ? p[key] : []) {
        if (typeof rule === 'string') out[key].push({ rule, layer: f.layer, path: f.path });
      }
    }
  }
  return out;
}

// Runner spellings that run the same program: "python -m pytest" and "pytest", "npm run test" and
// "npm test". Used only to widen deny and ask rules; allow rules match literally.
function normalize(cmd) {
  return String(cmd || '').trim().replace(/\s+/g, ' ')
    .replace(/^python3? -m (pytest|unittest)\b/, '$1')
    .replace(/^(npm|pnpm|yarn) run test(?=\s|$)/, '$1 test');
}

function ruleRegex(spec) {
  const esc = (x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const prefix = spec.endsWith(':*');
  const body = prefix ? spec.slice(0, -2) : spec;
  let src = body.split('*').map(esc).join('.*');
  if (prefix) src += '(?:\\s.*)?';
  else if (body.endsWith(' *') && body.split('*').length === 2) src = src.slice(0, -3) + '(?: .*)?';
  return new RegExp('^' + src + '$');
}

// A Claude Code permission rule for Bash tested against a command, the way Claude Code matches
// it: "Bash" and "Bash(*)" match everything; "Bash(npm test:*)" matches "npm test" and
// "npm test <args>" (a whole-word prefix); other "*" are globs, and a single trailing " *" also
// matches the bare command ("Bash(npm test *)" covers "npm test"); anything else is exact.
// opts.loose also tries both sides normalized (for deny and ask rules only).
function bashRuleMatches(rule, cmd, opts) {
  const m = /^Bash(?:\((.*)\))?$/.exec(String(rule || '').trim());
  if (!m) return false;
  const spec = m[1] === undefined ? '' : m[1].trim();
  if (spec === '' || spec === '*') return true;
  const literal = String(cmd || '').trim().replace(/\s+/g, ' ');
  if (ruleRegex(spec.replace(/\s+/g, ' ')).test(literal)) return true;
  if (!(opts && opts.loose)) return false;
  const specN = spec.endsWith(':*') ? normalize(spec.slice(0, -2)) + ':*' : normalize(spec);
  return ruleRegex(specN).test(normalize(cmd));
}

// { ok, reason, rule? } -- reason is 'deny' | 'ask' | 'allow-rule' | 'bypass' | 'trusted' | 'no-rule'.
function check(cmd, opts) {
  opts = opts || {};
  let rules;
  try { rules = loadRules(opts.cwd, opts.env, opts.managedDir); } catch (_) { return { ok: false, reason: 'no-rule' }; }
  for (const key of ['deny', 'ask']) {
    const hit = rules[key].find((r) => bashRuleMatches(r.rule, cmd, { loose: true }));
    if (hit) return { ok: false, reason: key, rule: hit.rule, path: hit.path };
  }
  const allow = rules.allow.find((r) => bashRuleMatches(r.rule, cmd));
  if (allow) return { ok: true, reason: 'allow-rule', rule: allow.rule, path: allow.path };
  if (opts.permissionMode === 'bypassPermissions') return { ok: true, reason: 'bypass' };
  if (opts.trusted === true) return { ok: true, reason: 'trusted' };
  return { ok: false, reason: 'no-rule' };
}

// The allow rule to suggest for a command: a ":*" prefix rule on the test runner's own words
// ("Bash(npm test:*)", "Bash(python3 -m pytest:*)"), and otherwise the exact command, never a
// bare interpreter ("Bash(python3:*)" or "Bash(bash:*)" would approve any code at all).
const PREFIX_RULES = [
  /^python3? -m (pytest|unittest)(?=\s|$)/, /^pytest(?=\s|$)/, /^(npm|pnpm|yarn)( run)? test(?=\s|$)/,
  /^node --test(?=\s|$)/, /^go test(?=\s|$)/, /^cargo (test|check)(?=\s|$)/, /^make (test|check)(?=\s|$)/,
  /^ruff check(?=\s|$)/,
];
function suggestRule(cmd) {
  const c = String(cmd || '').trim().replace(/\s+/g, ' ');
  for (const re of PREFIX_RULES) {
    const m = re.exec(c);
    if (m) return 'Bash(' + m[0] + ':*)';
  }
  return 'Bash(' + c + ')';
}

// A one-line note for the user (a hook's systemMessage, which the model does not see), at most once
// per session and rule, when a command was held back only for want of an allow rule. A deny or ask
// rule is the user's own decision and gets no note.
function hintOnce(dir, cmd, result, what) {
  if (!dir || !result || result.reason !== 'no-rule') return null;
  const rule = suggestRule(cmd);
  const file = path.join(dir, 'permission-hints.json');
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) {}
  if (seen[rule]) return null;
  seen[rule] = Date.now();
  try { fs.writeFileSync(file, JSON.stringify(seen), { mode: 0o600 }); } catch (_) {}
  return what + ': `' + cmd + '` has no allow rule, and xend never runs a command Claude Code would ask about. ' +
    'To allow it, add ' + rule + ' to permissions.allow (approving it once with "don\'t ask again" does this), ' +
    'or set "trustTestCommands": true in ' + require('./config.js').userConfigPath() + '.';
}

module.exports = { check, hintOnce, bashRuleMatches, suggestRule, normalize, layerFiles, loadRules, managedDir, userDir, projectRoot };
