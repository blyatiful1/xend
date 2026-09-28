#!/usr/bin/env node
'use strict';
// PreToolUse (Read): in profiles with readLimitMinLines > 0, an unranged Read of a large file is
// turned into a ranged read (limit = readLimit) so the model gets a truthful first window
// (startLine, numLines, totalLines all real) instead of the whole file. Off unless configured.
const fs = require('fs');
const path = require('path');
const io = require('./lib/io.js');
const state = require('./lib/state.js');

// Lines as an editor counts them: a final newline does not start another line.
function countLines(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    let lines = 0, total = 0, n, last = 10;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      total += n;
      last = buf[n - 1];
      if (total > maxBytes) return lines + 1;
    }
    return total === 0 ? 0 : lines + (last === 10 ? 0 : 1);
  } finally { fs.closeSync(fd); }
}

// Only reads inside the project are limited (and so pre-approved): a file anywhere else goes
// through Claude Code's own permission check untouched.
function insideProject(file, root) {
  const rel = path.relative(path.resolve(root), path.resolve(root, file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function main() {
  const input = io.readHookInput();
  if (!input || input.tool_name !== 'Read' || !input.tool_input) return;
  const ti = input.tool_input;
  if (ti.offset || ti.limit || !ti.file_path) return;
  if (input.agent_id || /\/subagents\//.test(input.transcript_path || '')) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || require('./lib/config.js').resolve({ cwd: input.cwd });
  const min = cfg.shape && cfg.shape.enabled !== false && cfg.shape.readLimitMinLines;
  if (!min || state.sessionOverrides(dir).shape === false) return;
  if (!insideProject(ti.file_path, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd())) return;
  let st;
  try { st = fs.statSync(ti.file_path); } catch (_) { return; }
  if (!st.isFile() || st.size < min * 20) return; // cheap pre-check: tiny files cannot have that many lines
  if (/\.(png|jpe?g|gif|pdf|ipynb|webp|svg)$/i.test(ti.file_path)) return;
  const lines = countLines(ti.file_path, 8 * 1024 * 1024);
  if (lines < min) return;
  const limit = cfg.shape.readLimit || 250;
  // remember that xend limited this read so the PostToolUse hook can tell the model the true size;
  // one file per call, so parallel Reads cannot overwrite each other's entry
  state.writeJson(path.join(dir, 'limited-read-' + state.safeId(input.tool_use_id) + '.json'), { total: lines, limit });
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'xend: large file read as a range (' + limit + ' of ' + lines + ' lines); continue with offset/limit', updatedInput: Object.assign({}, ti, { limit }) } });
}

try { main(); } catch (e) { io.debug('pre-read error: ' + (e && e.stack || e)); }
process.exit(0);
