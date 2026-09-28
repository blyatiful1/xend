'use strict';
// Per-session state: shaped-output originals, dedupe registry, checkpoint, shaping log.
// Location (first that applies): $XEND_STATE_DIR/<id>, the hook input's scratchpad_dir/xend,
// $CLAUDE_PLUGIN_DATA/sessions/<id>, <tmpdir>/xend-<uid>/<id>. Hooks get CLAUDE_PLUGIN_DATA and
// scratchpad_dir; the CLI, run from a skill through the Bash tool, gets neither, so SessionStart
// records where each session's directory is (by-session pointers) and the CLI looks it up.
// Directories are created 0700 and files 0600: saved tool output can hold secrets.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function safeId(id) {
  return String(id || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

// A per-user name under the shared temp dir, so one user's state is never another's to read or
// to plant a config in.
function tmpBase() {
  let uid = '';
  try { uid = typeof process.getuid === 'function' ? String(process.getuid()) : os.userInfo().username; } catch (_) {}
  const base = path.join(os.tmpdir(), uid ? 'xend-' + safeId(uid) : 'xend');
  // someone else created it first (or made it a link): use a directory under our own home instead
  try {
    const st = fs.lstatSync(base);
    if (st.isSymbolicLink() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return path.join(os.homedir(), '.cache', 'xend');
  } catch (_) {}
  return base;
}

function baseDir(env) {
  env = env || process.env;
  if (env.XEND_STATE_DIR) return env.XEND_STATE_DIR;
  if (env.CLAUDE_PLUGIN_DATA) return path.join(env.CLAUDE_PLUGIN_DATA, 'sessions');
  return tmpBase();
}

// Every base a session's pointer may live under, most specific first.
function pointerRoots(env) {
  env = env || process.env;
  const roots = [];
  if (env.XEND_STATE_DIR) roots.push(env.XEND_STATE_DIR);
  if (env.CLAUDE_PLUGIN_DATA) roots.push(path.join(env.CLAUDE_PLUGIN_DATA, 'sessions'));
  roots.push(tmpBase());
  return roots.filter((r, i) => roots.indexOf(r) === i);
}

// mkdir's mode does not apply to a directory that already exists (one an earlier version made
// 0755), so the mode is also set explicitly.
function mkdirPrivate(d) {
  try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); } catch (_) {}
  try { fs.chmodSync(d, 0o700); } catch (_) {}
}

// scratchpadDir: Claude Code's per-session scratch directory from the hook input when present
// (durable for the session, unlike the OS temp dir).
function sessionDir(sessionId, env, scratchpadDir) {
  env = env || process.env;
  let d;
  if (env.XEND_STATE_DIR) d = path.join(env.XEND_STATE_DIR, safeId(sessionId));
  else if (scratchpadDir) d = path.join(scratchpadDir, 'xend');
  else d = path.join(baseDir(env), safeId(sessionId));
  mkdirPrivate(d);
  return d;
}

// The state dir hooks use for this session, found from outside a hook: the by-session pointer
// SessionStart wrote, else an existing <base>/<id> directory. null when neither exists.
function findSessionDir(sessionId, env) {
  if (!sessionId) return null;
  const roots = pointerRoots(env);
  for (const root of roots) {
    const p = readJson(path.join(root, 'by-session', safeId(sessionId) + '.json'), null);
    if (p && p.dir && fs.existsSync(p.dir)) return p.dir;
  }
  for (const root of roots) {
    const d = path.join(root, safeId(sessionId));
    if (fs.existsSync(d)) return d;
  }
  return null;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, obj) {
  try {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (_) { return false; }
}

function appendLine(file, line) {
  try { fs.appendFileSync(file, line + '\n', { mode: 0o600 }); } catch (_) {}
}

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }

// Persist an original tool output; returns the path or null.
function persistOriginal(dir, toolUseId, text) {
  try {
    const f = path.join(dir, 'tool-' + safeId(toolUseId) + '.txt');
    fs.writeFileSync(f, text, { mode: 0o600 });
    return f;
  } catch (_) { return null; }
}

// Remove session dirs older than maxAgeDays (best effort, bounded work).
function pruneOld(env, maxAgeDays) {
  const root = baseDir(env);
  const cutoff = Date.now() - (maxAgeDays || 7) * 86400000;
  let entries = [];
  try { entries = fs.readdirSync(root); } catch (_) { return 0; }
  let removed = 0;
  for (const e of entries.slice(0, 500)) {
    const p = path.join(root, e);
    try {
      if (e === 'by-session' || e === 'by-cwd') {
        for (const f of fs.readdirSync(p).slice(0, 2000)) {
          const fp = path.join(p, f);
          if (fs.statSync(fp).mtimeMs < cutoff) { fs.rmSync(fp, { force: true }); removed++; }
        }
        continue;
      }
      const st = fs.statSync(p);
      if (st.isDirectory() && st.mtimeMs < cutoff) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
    } catch (_) {}
  }
  return removed;
}

// Pointers so the CLI (running outside the hook's stdin, e.g. from a skill or a user shell) can
// find a session's state dir without a --session argument: the most recent session started, and
// the most recent one started from a given cwd. Best effort, never throws.
function writeSessionPointers(env, sessionId, dir, cwd) {
  try {
    const root = baseDir(env);
    const payload = { id: sessionId, dir, cwd: cwd || '' };
    mkdirPrivate(root);
    writeJson(path.join(root, 'latest-session.json'), payload);
    if (sessionId) {
      mkdirPrivate(path.join(root, 'by-session'));
      writeJson(path.join(root, 'by-session', safeId(sessionId) + '.json'), payload);
    }
    if (cwd) {
      const cwdDir = path.join(root, 'by-cwd');
      mkdirPrivate(cwdDir);
      const key = crypto.createHash('sha1').update(String(cwd)).digest('hex');
      writeJson(path.join(cwdDir, key + '.json'), payload);
    }
  } catch (_) {}
}

// Resolve which session's state dir the CLI should use, in order: an explicit --session id;
// CLAUDE_SESSION_ID / CLAUDE_CODE_SESSION_ID from the environment, when that id's state dir
// already exists; the by-cwd pointer; the latest-session pointer. Returns { dir, id, source },
// source one of 'arg' | 'env' | 'cwd' | 'latest' | null.
function resolveSessionDir(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  if (opts.session) {
    return { dir: findSessionDir(opts.session, env) || sessionDir(opts.session, env), id: opts.session, source: 'arg' };
  }
  const envId = env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID;
  if (envId) {
    const dir = findSessionDir(envId, env);
    if (dir) return { dir, id: envId, source: 'env' };
  }
  const root = baseDir(env);
  if (cwd) {
    const key = crypto.createHash('sha1').update(String(cwd)).digest('hex');
    const p = readJson(path.join(root, 'by-cwd', key + '.json'), null);
    if (p && p.dir) return { dir: p.dir, id: p.id, source: 'cwd' };
  }
  const latest = readJson(path.join(root, 'latest-session.json'), null);
  if (latest && latest.dir) return { dir: latest.dir, id: latest.id, source: 'latest' };
  return { dir: null, id: null, source: null };
}

// Session-scoped overrides set by skills (e.g. /xend:terse off).
function sessionOverrides(dir) { return readJson(path.join(dir, 'session.json'), {}); }
function setSessionOverride(dir, key, value) {
  const cur = sessionOverrides(dir);
  cur[key] = value;
  return writeJson(path.join(dir, 'session.json'), cur);
}

module.exports = { baseDir, tmpBase, pointerRoots, findSessionDir, sessionDir, readJson, writeJson, appendLine, hash, persistOriginal, pruneOld, sessionOverrides, setSessionOverride, safeId, writeSessionPointers, resolveSessionDir };
