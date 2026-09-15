'use strict';
// stdin/stdout helpers for Claude Code hooks. Never throw out of a hook: a hook that
// crashes shows an error to the user, so every failure degrades to "do nothing".
const fs = require('fs');

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    if (e && (e.code === 'EAGAIN' || e.code === 'EOF')) return '';
    return '';
  }
}

function readHookInput() {
  const raw = readStdinSync();
  if (!raw || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function writeHookOutput(obj) {
  if (!obj) return;
  process.stdout.write(JSON.stringify(obj));
}

function debug(msg) {
  if (process.env.XEND_DEBUG) process.stderr.write('[xend] ' + msg + '\n');
  if (process.env.XEND_DEBUG_LOG) { try { fs.appendFileSync(process.env.XEND_DEBUG_LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (_) {} }
}

function estimateTokens(chars) {
  // Coarse but stable: ~3.8 chars/token for mixed code and prose on Claude tokenizers.
  return Math.round((chars || 0) / 3.8);
}

function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

module.exports = { readHookInput, writeHookOutput, debug, estimateTokens, fmtInt };
