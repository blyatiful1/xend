'use strict';
// Per-session state: shaped-output originals, dedupe registry, checkpoint, shaping log.
// Location (first that applies): $XEND_STATE_DIR, $CLAUDE_PLUGIN_DATA/sessions/<id>, <tmpdir>/xend/<id>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function safeId(id) {
  return String(id || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

function baseDir(env) {
  env = env || process.env;
  if (env.XEND_STATE_DIR) return env.XEND_STATE_DIR;
  if (env.CLAUDE_PLUGIN_DATA) return path.join(env.CLAUDE_PLUGIN_DATA, 'sessions');
  return path.join(os.tmpdir(), 'xend');
}

// scratchpadDir: Claude Code's per-session scratch directory from the hook input when present
// (durable for the session, unlike the OS temp dir).
function sessionDir(sessionId, env, scratchpadDir) {
  env = env || process.env;
  let d;
  if (env.XEND_STATE_DIR) d = path.join(env.XEND_STATE_DIR, safeId(sessionId));
  else if (scratchpadDir) d = path.join(scratchpadDir, 'xend');
  else d = path.join(baseDir(env), safeId(sessionId));
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, obj) {
  try {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
    return true;
  } catch (_) { return false; }
}

function appendLine(file, line) {
  try { fs.appendFileSync(file, line + '\n'); } catch (_) {}
}

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }

// Persist an original tool output; returns the path or null.
function persistOriginal(dir, toolUseId, text) {
  try {
    const f = path.join(dir, 'tool-' + safeId(toolUseId) + '.txt');
    fs.writeFileSync(f, text);
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
    fs.mkdirSync(root, { recursive: true });
    writeJson(path.join(root, 'latest-session.json'), payload);
    if (cwd) {
      const cwdDir = path.join(root, 'by-cwd');
      fs.mkdirSync(cwdDir, { recursive: true });
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
    return { dir: sessionDir(opts.session, env), id: opts.session, source: 'arg' };
  }
  const envId = env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID;
  if (envId) {
    const dir = path.join(baseDir(env), safeId(envId));
    if (fs.existsSync(dir)) return { dir, id: envId, source: 'env' };
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

module.exports = { baseDir, sessionDir, readJson, writeJson, appendLine, hash, persistOriginal, pruneOld, sessionOverrides, setSessionOverride, safeId, writeSessionPointers, resolveSessionDir };
