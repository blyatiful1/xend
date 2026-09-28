'use strict';
// Auto-test after an edit: run the project's quick test command right after an Edit, so the result
// arrives with the edit instead of costing the model a separate "now run the tests" turn. On short
// tasks a model call costs more than anything else (every call re-reads the whole context), and a
// session-block rule asking the model to batch the edit and the test in one message did not change
// what Sonnet does (verified here); a hook does not need the model's cooperation.
//
// Safety: only commands that pass verify.commandAllowed run (a configured command included), none
// that a Claude Code permission rule denies or asks about (blockedByPermissions), never inside
// subagents, never after Write (a file being created is usually half a feature, and its failing
// tests are noise), and a suite slower than maxMs switches the feature off for the session.
const fs = require('fs');
const path = require('path');
const verify = require('./verify.js');
const state = require('./state.js');
const settings = require('./settings.js');

// --tb=no -rfE: one 'FAILED test - message' line per failure, the most compact form that still names
// what broke; the model runs pytest itself when it needs a traceback.
const PY_CMD = 'python3 -m pytest -q --tb=no -rfE -p no:cacheprovider';
const SKIP_EXT = /\.(md|mdx|txt|rst|adoc|lock|log|csv|svg|png|jpe?g|gif|ico|pdf)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.tox', '.mypy_cache', 'target']);

// Bounded breadth-first scan for test files; returns the first kind found ('py' | 'js') per kind.
function findTests(root, maxDepth, maxEntries) {
  const found = { py: false, js: false };
  const queue = [{ dir: root, depth: 0 }];
  let seen = 0;
  while (queue.length && seen < (maxEntries || 2000)) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (++seen > (maxEntries || 2000)) break;
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        continue;
      }
      if (/^test_.+\.py$|.+_test\.py$|^conftest\.py$/.test(e.name)) found.py = true;
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) found.js = true;
    }
    if (found.py && found.js) break;
  }
  return found;
}

function readPkgTest(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const t = pkg && pkg.scripts && pkg.scripts.test;
    if (typeof t === 'string' && t.trim() && !/no test specified/.test(t)) return t;
  } catch (_) {}
  return null;
}

// Pure-ish: which command to run for an edit to `file` under `root`, or null. A configured command
// wins; otherwise Python edits get pytest when Python tests exist, JS/TS edits get `npm test` when
// package.json defines one, else `node --test` when *.test.js files exist.
function detectCommand(root, file, cfg) {
  const c = detectRaw(root, file, cfg || {});
  return c && verify.commandAllowed(c) ? c : null;
}

function detectRaw(root, file, cfg) {
  if (cfg.command) return verify.commandAllowed(cfg.command) ? cfg.command : null;
  if (!file || SKIP_EXT.test(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const isPy = ext === '.py';
  const isJs = /^\.[cm]?[jt]sx?$/.test(ext);
  const isData = /^\.(json|ya?ml|toml|ini|cfg)$/.test(ext);
  if (!isPy && !isJs && !isData) return null;
  const tests = findTests(root, 3, 2000);
  if ((isPy || isData) && tests.py) return PY_CMD;
  if (isJs || isData) {
    if (readPkgTest(root)) return 'npm test --silent';
    if (tests.js) return 'node --test --test-reporter=spec';
  }
  return null;
}

// A Claude Code permission rule for Bash ("Bash", "Bash(npm test:*)", "Bash(pytest *)") tested
// against a command. Legacy ":*" prefix rules and "*" globs both match.
function bashRuleMatches(rule, cmd) {
  const m = /^Bash(?:\((.*)\))?$/.exec(String(rule || '').trim());
  if (!m) return false;
  const spec = m[1];
  if (spec === undefined || spec.trim() === '' || spec.trim() === '*') return true;
  const pat = spec.trim().endsWith(':*') ? spec.trim().slice(0, -2) + '*' : spec.trim();
  const re = new RegExp('^' + pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  const bare = cmd.replace(/^python3?\s+-m\s+/, '');
  return re.test(cmd) || re.test(bare);
}

// The hook runs without a permission prompt, so a user who has told Claude Code to deny or ask
// about this command (or about Bash altogether) keeps that decision: the auto-test stays off.
function blockedByPermissions(cmd, root) {
  let layers;
  try { layers = settings.loadSettingsLayers(root); } catch (_) { return false; }
  for (const l of [layers.user, layers.project, layers.local]) {
    const p = l && l.value && l.value.permissions;
    if (!p) continue;
    for (const key of ['deny', 'ask']) {
      for (const rule of Array.isArray(p[key]) ? p[key] : []) if (bashRuleMatches(rule, cmd)) return true;
    }
  }
  return false;
}

// Keeps the decisive part of a test run within maxChars: failure lines and the summary. Passing
// progress rows (dots, "ok" lines) carry nothing once the summary says how many passed.
function condense(text, maxChars) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const keep = lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (/^[.sxXFE]+(\s+\[\s*\d+%\])?$/.test(t)) return false;             // pytest -q progress
    if (/^(ok|✔)\s/.test(t)) return false;                                   // passing rows
    if (/^at .*\bnode:(internal|diagnostics_channel)/.test(t) || /^at node:internal/.test(t)) return false; // runtime frames
    if (/^ℹ (suites|cancelled|skipped|todo|duration_ms) /.test(t)) return false; // node --test zero rows
    if (/^=+ (short test summary info|FAILURES|ERRORS) =+$/.test(t)) return false; // pytest section rules
    return true;
  });
  let out = keep.join('\n');
  if (out.length > maxChars) {
    const head = out.slice(0, Math.floor(maxChars * 0.6));
    const tail = out.slice(out.length - Math.floor(maxChars * 0.4));
    out = head.slice(0, head.lastIndexOf('\n') > 0 ? head.lastIndexOf('\n') : head.length) + '\n...\n' + tail.slice(tail.indexOf('\n') + 1);
  }
  return out;
}

// Strips timings so two runs with the same outcome compare equal.
function signature(text) {
  return String(text || '').replace(/\d+\.\d+/g, 'N').replace(/\d+\s*m?s\b/g, 'T');
}

// Runs the command and returns the additionalContext string for the model (or null to stay quiet).
// `dir` is the session state dir: it holds the last result's signature and the disabled flag.
function run(opts) {
  const { root, file, cfg, dir, toolUseId } = opts;
  const ac = cfg || {};
  const flagFile = path.join(dir, 'autotest.json');
  const st = state.readJson(flagFile, {});
  if (st.disabled) return null;
  const cmd = detectCommand(root, file, ac);
  if (!cmd) return null;
  if (blockedByPermissions(cmd, root)) return null;
  const r = verify.runVerify(cmd, root, ac.timeoutMs || 20000);
  const combined = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
  const secs = (r.ms / 1000).toFixed(1) + 's';
  if (r.timedOut || r.ms > (ac.maxMs != null ? ac.maxMs : 8000)) {
    state.writeJson(flagFile, Object.assign(st, { disabled: true, reason: 'slow', ms: r.ms }));
    return '[xend] Auto-test switched off for this session: `' + cmd + '` took ' + secs + (r.timedOut ? ' and timed out' : '') + '. Run tests yourself.';
  }
  // A missing runner is not a test result; stay quiet from now on.
  if (/No module named pytest|command not found|ERR! Missing script/.test(combined) && r.exit !== 0 && !/(passed|failed|error)/i.test(combined.split('\n').slice(-3).join(' '))) {
    state.writeJson(flagFile, Object.assign(st, { disabled: true, reason: 'no-runner' }));
    return null;
  }
  // Nothing ran: the suite could not be collected (a module the tests import does not exist yet,
  // typical while a feature is being built file by file) or collected no tests. That says nothing
  // about this edit, and a failure note here only distracts; the model runs the tests itself later.
  if (r.exit === 5 || /error(s)? during collection/.test(combined) || (r.exit !== 0 && /\bno tests ran\b/.test(combined))) return null;
  const sig = state.hash(signature(combined) + '|' + r.exit);
  const prev = st.last;
  st.last = sig; st.runs = (st.runs || 0) + 1;
  state.writeJson(flagFile, st);
  const head = '[xend] Auto-test after this edit: `' + cmd + '` exit ' + r.exit + ' (' + secs + ')';
  if (prev === sig) return head + ', same result as the previous auto-test.';
  const body = condense(combined, ac.maxChars || 1200);
  let full = '';
  if (body.length < combined.trim().length && combined.length > 2000 && toolUseId) full = '\nFull output: ' + state.persistOriginal(dir, 'autotest-' + toolUseId, combined);
  const tail = r.exit === 0 ? '\nThis is the current result; do not re-run it to confirm.' : '';
  return head + ':\n' + body + full + tail;
}

module.exports = { detectCommand, condense, signature, findTests, run, bashRuleMatches, blockedByPermissions, PY_CMD };
