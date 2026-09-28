'use strict';
// Would Claude Code run this Bash command without asking? xend's hooks run commands (the auto-test
// after an edit, SubagentStop's re-run of a builder's verify command) where no permission prompt
// can be shown, so they run one only when the answer is yes:
//   - no deny or ask rule in any settings layer matches it (these always win), and
//   - an allow rule matches it, or the session runs in bypassPermissions mode, or the user opted
//     in at user level (trustTestCommands in ~/.config/xend/config.json, or XEND_TRUST_TESTS=1).
// Layers read: managed (managed-settings.json and managed-settings.d/*.json), user
// ($CLAUDE_CONFIG_DIR or ~/.claude), project and local (.claude/ under $CLAUDE_PROJECT_DIR, else
// the git root, else cwd). Pure reads; never throws.
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

function projectRoot(cwd, env) {
  env = env || process.env;
  if (env.CLAUDE_PROJECT_DIR) return path.resolve(env.CLAUDE_PROJECT_DIR);
  const start = path.resolve(cwd || process.cwd());
  return settings.findGitRoot(start) || start;
}

// Every settings file that can carry permission rules, most authoritative first.
function layerFiles(cwd, env, managed) {
  const files = [];
  const m = managed || managedDir();
  files.push({ layer: 'managed', path: path.join(m, 'managed-settings.json') });
  try {
    const dropIn = path.join(m, 'managed-settings.d');
    for (const f of fs.readdirSync(dropIn).filter((x) => x.endsWith('.json')).sort()) {
      files.push({ layer: 'managed', path: path.join(dropIn, f) });
    }
  } catch (_) {}
  files.push({ layer: 'user', path: path.join(userDir(env), 'settings.json') });
  const roots = [projectRoot(cwd, env)];
  const here = path.resolve(cwd || process.cwd());
  if (!roots.includes(here)) roots.push(here);
  for (const r of roots) {
    files.push({ layer: 'project', path: path.join(r, '.claude', 'settings.json') });
    files.push({ layer: 'local', path: path.join(r, '.claude', 'settings.local.json') });
  }
  return files;
}

function loadRules(cwd, env, managed) {
  const out = { deny: [], ask: [], allow: [] };
  for (const f of layerFiles(cwd, env, managed)) {
    const j = settings.readJsonSafe(f.path);
    const p = j && j.permissions;
    if (!p || typeof p !== 'object') continue;
    for (const key of ['deny', 'ask', 'allow']) {
      for (const rule of Array.isArray(p[key]) ? p[key] : []) {
        if (typeof rule === 'string') out[key].push({ rule, layer: f.layer, path: f.path });
      }
    }
  }
  return out;
}

// Runner spellings that run the same program: "python -m pytest" and "pytest", "npm run test" and
// "npm test". Applied to both the rule and the command before matching.
function normalize(cmd) {
  return String(cmd || '').trim().replace(/\s+/g, ' ')
    .replace(/^python3? -m (pytest|unittest)\b/, '$1')
    .replace(/^(npm|pnpm|yarn) run test\b/, '$1 test');
}

// A Claude Code permission rule for Bash tested against a command, the way Claude Code matches
// it: "Bash" and "Bash(*)" match everything; "Bash(npm test:*)" matches "npm test" and
// "npm test <args>" (a whole-word prefix); other "*" are globs, and a single trailing " *" also
// matches the bare command ("Bash(npm test *)" covers "npm test"); anything else is exact.
function bashRuleMatches(rule, cmd) {
  const m = /^Bash(?:\((.*)\))?$/.exec(String(rule || '').trim());
  if (!m) return false;
  const spec = m[1] === undefined ? '' : m[1].trim();
  if (spec === '' || spec === '*') return true;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const prefix = spec.endsWith(':*');
  const body = normalize(prefix ? spec.slice(0, -2) : spec);
  let src = body.split('*').map(esc).join('.*');
  if (prefix) src += '(?:\\s.*)?';
  else if (body.endsWith(' *') && body.split('*').length === 2) src = src.slice(0, -3) + '(?: .*)?';
  return new RegExp('^' + src + '$').test(normalize(cmd));
}

// { ok, reason, rule? } -- reason is 'deny' | 'ask' | 'allow-rule' | 'bypass' | 'trusted' | 'no-rule'.
function check(cmd, opts) {
  opts = opts || {};
  let rules;
  try { rules = loadRules(opts.cwd, opts.env, opts.managedDir); } catch (_) { return { ok: false, reason: 'no-rule' }; }
  for (const key of ['deny', 'ask']) {
    const hit = rules[key].find((r) => bashRuleMatches(r.rule, cmd));
    if (hit) return { ok: false, reason: key, rule: hit.rule, path: hit.path };
  }
  const allow = rules.allow.find((r) => bashRuleMatches(r.rule, cmd));
  if (allow) return { ok: true, reason: 'allow-rule', rule: allow.rule, path: allow.path };
  if (opts.permissionMode === 'bypassPermissions') return { ok: true, reason: 'bypass' };
  if (opts.trusted === true) return { ok: true, reason: 'trusted' };
  return { ok: false, reason: 'no-rule' };
}

// The allow rule to suggest for a command: its runner words, as a ":*" prefix rule.
function suggestRule(cmd) {
  const words = normalize(cmd).split(' ');
  const n = /^(npm|pnpm|yarn|node|go|cargo|make|python3?)$/.test(words[0]) && words[1] && !words[1].startsWith('-') ? 2
    : (words[0] === 'node' && words[1] === '--test') ? 2 : 1;
  const original = String(cmd).trim().split(/\s+/);
  // keep the command's own spelling ("python3 -m pytest") so the rule reads like what runs
  const lead = /^python3? -m /.test(String(cmd).trim()) ? original.slice(0, 3) : original.slice(0, n);
  return 'Bash(' + lead.join(' ') + ':*)';
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
