#!/usr/bin/env node
'use strict';
// PostToolUse hook: shape tool results before the model sees them (lossless-recoverable).
// Reads the hook JSON on stdin; prints {"hookSpecificOutput": {...updatedToolOutput}} or nothing.
const path = require('path');
const fs = require('fs');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const shape = require('./lib/shape.js');

function main() {
  const input = io.readHookInput();
  if (!input || input.hook_event_name !== 'PostToolUse') { io.debug('post-tool-use: no input'); return; }
  const tool = input.tool_name || '';
  io.debug('post-tool-use: ' + tool + ' cwd=' + input.cwd + ' sid=' + input.session_id);
  const resp = input.tool_response;
  if (resp == null) return;
  // Never shape inside subagents: a scout or reader must see exact evidence, and its context is
  // discarded anyway; the parent only receives its summary.
  if (input.agent_id || input.agent_type || /\/subagents\//.test(input.transcript_path || '')) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || config.resolve({ cwd: input.cwd });
  const overrides = state.sessionOverrides(dir);
  if (overrides.shape === false || !cfg.shape || !cfg.shape.enabled) return;
  const sc = Object.assign({}, cfg.shape, overrides.shapeOverrides || {});
  const id = input.tool_use_id || String(Date.now());
  recordRecovery(input, dir);

  let result = null;
  if (tool === 'Bash') result = handleBash(input, resp, sc, dir, id);
  else if (tool === 'Read') { limitedReadContext(input, resp, dir, id); result = handleRead(input, resp, sc, dir, id); }
  else if (tool === 'Grep') result = handleGrep(input, resp, sc, dir, id);
  else if (tool === 'Glob') result = handleGlob(input, resp, sc, dir, id);
  else if (tool.startsWith('mcp__') && sc.mcp) result = handleMcp(input, resp, sc, dir, id);
  if (!result || !result.changed) return;

  state.appendLine(path.join(dir, 'shaping.jsonl'), JSON.stringify({
    ts: Date.now(), tool, id, before: result.before, after: result.after, kinds: result.kinds,
  }));
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: result.output } });
}

function marker(note, fullPath) {
  return '[xend] ' + note + (fullPath ? '. Full output: ' + fullPath : '');
}

// If the model reads back a persisted original, log it: the recovery rate is the metric that
// tells whether a transform is hiding something the model needed (see docs/RESEARCH.md, H15).
function recordRecovery(input, dir) {
  if (input.tool_name !== 'Read' && input.tool_name !== 'Bash') return;
  const ti = input.tool_input || {};
  const target = input.tool_name === 'Read' ? String(ti.file_path || '') : String(ti.command || '');
  if (!target) return;
  if (target.includes(dir) || /\/tool-results\/[A-Za-z0-9]+\.txt/.test(target) || /tool-[A-Za-z0-9_.-]+\.txt/.test(target)) {
    state.appendLine(path.join(dir, 'shaping.jsonl'), JSON.stringify({ ts: Date.now(), tool: input.tool_name, id: input.tool_use_id, recovery: true, target: target.slice(0, 200) }));
  }
}

function inputKey(tool, ti) {
  ti = ti || {};
  if (tool === 'Bash') return 'bash|' + String(ti.command || '');
  if (tool === 'Read') return 'read|' + String(ti.file_path || '') + '|' + (ti.offset || 0) + '|' + (ti.limit || 0);
  return tool + '|' + JSON.stringify(ti);
}

// Dedupe registry: same tool+input -> byte-identical output within the window.
function checkDedupe(dir, sc, tool, ti, outputText, id) {
  if (!sc.dedupe) return null;
  const file = path.join(dir, 'dedupe.json');
  const reg = state.readJson(file, { seq: 0, entries: {} });
  reg.seq = (reg.seq || 0) + 1;
  const key = inputKey(tool, ti);
  const h = state.hash(outputText);
  const prev = reg.entries[key];
  let hit = null;
  if (prev && prev.out === h && reg.seq - prev.seq <= (sc.dedupeWindow || 30)) hit = prev;
  reg.entries[key] = { out: h, id, seq: reg.seq };
  const keys = Object.keys(reg.entries);
  if (keys.length > 300) {
    keys.sort((a, b) => reg.entries[a].seq - reg.entries[b].seq);
    for (const k of keys.slice(0, keys.length - 200)) delete reg.entries[k];
  }
  state.writeJson(file, reg);
  return hit;
}

function firstLast(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return '';
  const f = lines[0].slice(0, 100);
  const l = lines[lines.length - 1].slice(0, 100);
  return lines.length > 1 ? ' First line: "' + f + '" Last line: "' + l + '".' : ' Line: "' + f + '".';
}

function handleBash(input, resp, sc, dir, id) {
  if (typeof resp.stdout !== 'string') return null;
  if (resp.isImage || resp.interrupted) return null;
  const stdout = resp.stdout;
  const stderr = typeof resp.stderr === 'string' ? resp.stderr : '';
  const combined = stdout + (stderr ? '\n' + stderr : '');
  if (combined.trim().length < 200) return null; // nothing worth shaping
  const cmd = String((input.tool_input || {}).command || '');
  const kind = shape.detectKind(cmd, stdout);

  // 1) dedupe (Bash only): byte-identical output of the same command within the window.
  //    Keeps the first lines so the result still reads like output, and says exactly what it means.
  const minDedupe = sc.dedupeMinChars || 2000;
  const hit = combined.length >= minDedupe ? checkDedupe(dir, sc, 'Bash', input.tool_input, combined, id) : null;
  if (hit) {
    const full = resp.persistedOutputPath || state.persistOriginal(dir, id, combined);
    const head = (stdout || stderr).split('\n').slice(0, 10).join('\n');
    const total = shape.countLines(combined);
    const note = 'The remaining ' + io.fmtInt(Math.max(0, total - 10)) + ' lines are byte-identical to this command\'s output at your earlier call ' + hit.id + ' (the command\'s output is unchanged; other state may have changed)';
    const newStdout = head + '\n' + marker(note, full);
    const output = Object.assign({}, resp, { stdout: newStdout, stderr: '' });
    return { changed: true, output, before: combined.length, after: newStdout.length, kinds: ['dedupe'] };
  }

  // 2) shaping
  const so = shape.shapeBashText(stdout, kind, sc, cmd);
  const se = stderr ? shape.shapeBashText(stderr, kind, Object.assign({}, sc, { maxChars: Math.max(2000, Math.floor(sc.maxChars / 2)) }), cmd) : { text: '', changed: false, kinds: [], before: 0, after: 0 };
  if (!so.changed && !se.changed) return null;
  const before = combined.length;
  const savedChars = (so.before - so.after) + (se.before - se.after);
  if (savedChars < 150) return null; // not worth a marker line
  // Name a recovery path only when enough was removed to matter; a path invites a re-read.
  const full = savedChars >= 2000 ? (resp.persistedOutputPath || state.persistOriginal(dir, id, combined)) : null;
  const kinds = so.kinds.concat(se.kinds.map((k) => 'stderr:' + k));
  const note = 'Condensed ' + shape.describe(so.kinds.length ? so.kinds : se.kinds, shape.countLines(stdout || stderr), shape.countLines(so.changed ? so.text : se.text)) + '. Errors, failures and summaries are kept in full' + (resp.persistedOutputPath ? '; the original was already cut by Claude Code at its output cap' : '');
  const newStdout = so.text + (so.text.endsWith('\n') ? '' : '\n') + marker(note, full);
  const output = Object.assign({}, resp, { stdout: newStdout, stderr: se.text });
  return { changed: true, output, before, after: newStdout.length + se.text.length, kinds };
}

// Read results are never altered: the model's next Edit must match the file on disk byte for
// byte, and a Read result is its working copy. Large unranged reads are handled honestly by the
// PreToolUse range limiter (scripts/pre-read.js) in profiles that enable it.
function handleRead() { return null; }

// When xend limited a Read, tell the model the true size as extra context (not by editing the
// result): the rendered result does not make totalLines obvious, and a model that believes the
// file ends at line 250 would be a silent error.
function limitedReadContext(input, resp, dir, id) {
  const regFile = path.join(dir, 'limited-reads.json');
  const reg = state.readJson(regFile, null);
  if (!reg || !reg[id]) return;
  const info = reg[id]; delete reg[id]; state.writeJson(regFile, reg);
  const file = (resp && resp.file) || {};
  const total = file.totalLines || info.total;
  const shown = file.numLines || info.limit;
  const start = file.startLine || 1;
  const note = '[xend] ' + path.basename(String(file.filePath || (input.tool_input || {}).file_path || 'file')) + ' has ' + io.fmtInt(total) + ' lines; this read returned lines ' + start + '-' + (start + shown - 1) + ' because unranged reads of large files are limited. Read further ranges with offset/limit, or Grep for the symbol you need.';
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } });
}

function handleGrep(input, resp, sc, dir, id) {
  if (!resp || typeof resp !== 'object') return null;
  if (resp.mode === 'content' && typeof resp.content === 'string') {
    const max = sc.grepMaxLines || 0;
    const lines = resp.content.split('\n');
    if (!max || lines.length <= max) return null;
    const full = state.persistOriginal(dir, id, resp.content);
    const keepHead = Math.floor(max * 0.7), keepTail = max - keepHead;
    const kept = lines.slice(0, keepHead).concat(['... [xend: ' + (lines.length - max) + ' matching lines omitted] ...'], lines.slice(lines.length - keepTail));
    const note = 'Showing ' + max + ' of ' + lines.length + ' matching lines (' + (resp.numFiles || 'several') + ' files); the count fields are the true totals. Narrow the pattern or path, or read the full list';
    const content = kept.join('\n') + '\n' + marker(note, full);
    const output = Object.assign({}, resp, { content, numLines: kept.length + 1 });
    return { changed: true, output, before: resp.content.length, after: content.length, kinds: ['grep:' + (lines.length - max)] };
  }
  if (Array.isArray(resp.filenames)) return capList(resp, 'filenames', sc.globMaxFiles, dir, id, 'files');
  return null;
}

function handleGlob(input, resp, sc, dir, id) {
  if (!resp || !Array.isArray(resp.filenames)) return null;
  return capList(resp, 'filenames', sc.globMaxFiles, dir, id, 'files');
}

function capList(resp, key, max, dir, id, what) {
  const arr = resp[key];
  if (!max || arr.length <= max) return null;
  const before = JSON.stringify(arr).length;
  const full = state.persistOriginal(dir, id, arr.join('\n'));
  const kept = arr.slice(0, max);
  kept.push(marker((arr.length - max) + ' more ' + what + ' not listed (' + arr.length + ' total). Narrow the pattern to see them', full));
  const output = Object.assign({}, resp, { [key]: kept });
  if ('truncated' in resp) output.truncated = true;
  return { changed: true, output, before, after: JSON.stringify(kept).length, kinds: ['list:' + (arr.length - max)] };
}

function shapeMcpText(text, sc) {
  const kind = shape.detectKind('', text);
  const r = shape.shapeBashText(text, kind === 'json' ? 'json' : 'generic', sc);
  return r;
}

function handleMcp(input, resp, sc, dir, id) {
  if (typeof resp === 'string') {
    if (resp.length < 1500) return null;
    const r = shapeMcpText(resp, sc);
    if (!r.changed || r.before - r.after < 300) return null;
    const full = state.persistOriginal(dir, id, resp);
    const out = r.text + '\n' + marker('Condensed ' + shape.describe(r.kinds, shape.countLines(resp), shape.countLines(r.text)), full);
    return { changed: true, output: out, before: resp.length, after: out.length, kinds: r.kinds };
  }
  if (Array.isArray(resp)) {
    let changed = false, before = 0, after = 0; const kinds = [];
    const out = resp.map((block) => {
      if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length >= 1500) {
        const r = shapeMcpText(block.text, sc);
        before += r.before; after += r.after;
        if (r.changed && r.before - r.after >= 300) {
          changed = true; kinds.push.apply(kinds, r.kinds);
          const full = state.persistOriginal(dir, id + '-' + before, block.text);
          return Object.assign({}, block, { text: r.text + '\n' + marker('Condensed ' + shape.describe(r.kinds, shape.countLines(block.text), shape.countLines(r.text)), full) });
        }
      }
      return block;
    });
    return changed ? { changed, output: out, before, after, kinds } : null;
  }
  return null;
}

try { main(); } catch (e) { io.debug('post-tool-use error: ' + (e && e.stack || e)); }
process.exit(0);
