#!/usr/bin/env node
'use strict';
// PreToolUse (Read): in profiles with readLimitMinLines > 0, an unranged Read of a large file is
// turned into a ranged read (limit = readLimit) so the model gets a truthful first window
// (startLine, numLines, totalLines all real) instead of the whole file. Off unless configured.
const fs = require('fs');
const io = require('./lib/io.js');
const state = require('./lib/state.js');

function countLines(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    let lines = 0, total = 0, n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      total += n;
      if (total > maxBytes) return lines + 1;
    }
    return lines + 1;
  } finally { fs.closeSync(fd); }
}

function main() {
  const input = io.readHookInput();
  if (!input || input.tool_name !== 'Read' || !input.tool_input) return;
  const ti = input.tool_input;
  if (ti.offset || ti.limit || !ti.file_path) return;
  if (input.agent_id || /\/subagents\//.test(input.transcript_path || '')) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  const cfg = state.readJson(require('path').join(dir, 'config.json'), null) || require('./lib/config.js').resolve({ cwd: input.cwd });
  const min = cfg.shape && cfg.shape.readLimitMinLines;
  if (!min) return;
  let st;
  try { st = fs.statSync(ti.file_path); } catch (_) { return; }
  if (!st.isFile() || st.size < min * 20) return; // cheap pre-check: tiny files cannot have that many lines
  if (/\.(png|jpe?g|gif|pdf|ipynb|webp|svg)$/i.test(ti.file_path)) return;
  const lines = countLines(ti.file_path, 8 * 1024 * 1024);
  if (lines < min) return;
  const limit = cfg.shape.readLimit || 250;
  // remember that xend limited this read so the PostToolUse hook can tell the model the true size
  const reg = state.readJson(require('path').join(dir, 'limited-reads.json'), {});
  reg[String(input.tool_use_id || '')] = { total: lines, limit };
  const keys = Object.keys(reg); if (keys.length > 100) for (const k of keys.slice(0, keys.length - 50)) delete reg[k];
  state.writeJson(require('path').join(dir, 'limited-reads.json'), reg);
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'xend: large file read as a range (' + limit + ' of ' + lines + ' lines); continue with offset/limit', updatedInput: Object.assign({}, ti, { limit }) } });
}

try { main(); } catch (e) { io.debug('pre-read error: ' + (e && e.stack || e)); }
process.exit(0);
