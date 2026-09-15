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

// Session-scoped overrides set by skills (e.g. /xend:terse off).
function sessionOverrides(dir) { return readJson(path.join(dir, 'session.json'), {}); }
function setSessionOverride(dir, key, value) {
  const cur = sessionOverrides(dir);
  cur[key] = value;
  return writeJson(path.join(dir, 'session.json'), cur);
}

module.exports = { baseDir, sessionDir, readJson, writeJson, appendLine, hash, persistOriginal, pruneOld, sessionOverrides, setSessionOverride, safeId };
