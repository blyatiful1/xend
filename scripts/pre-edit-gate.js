#!/usr/bin/env node
'use strict';
// PreToolUse (Write|Edit|MultiEdit): xend architect gate (docs/SPEC-architect.md section 13).
// In architect-enabled sessions, above the file floor and without a plan, deny a direct edit of a
// not-yet-edited file, up to gateMaxDenials times per FILE (not per session — a model that tries a
// different new file after each refusal must still be refused on each of those files); once a plan
// exists nothing is denied. Never blocks: architect/gate disabled, a plan already exists, the file
// is already in edits.jsonl, still under the floor, that file's own denial ceiling is reached, or
// inside a subagent.
const fs = require('fs');
const path = require('path');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const config = require('./lib/config.js');

function distinctEditedFiles(dir) {
  const seen = new Set();
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'edits.jsonl'), 'utf8'); } catch (_) { return seen; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (rec && rec.file) seen.add(path.resolve(String(rec.file)));
  }
  return seen;
}

// gate.json's `files` used to be an array of every denied path (one entry per denial, so its
// length was the session-wide denial count). It is now a map of path -> denial count for that
// path, since the cap is per file. Accept the old array shape on read: each listed path counts 1.
function gateFilesMap(gateState) {
  const files = gateState && gateState.files;
  const map = {};
  if (Array.isArray(files)) {
    for (const f of files) if (f) map[String(f)] = 1;
  } else if (files && typeof files === 'object') {
    for (const k of Object.keys(files)) map[k] = Number(files[k]) || 0;
  }
  return map;
}

function main() {
  const input = io.readHookInput();
  if (!input || input.hook_event_name !== 'PreToolUse' || !/^(Write|Edit|MultiEdit)$/.test(input.tool_name || '')) return;
  if (input.agent_id || /\/subagents\//.test(input.transcript_path || '')) return;
  const ti = input.tool_input || {};
  const filePath = ti.file_path || ti.notebook_path;
  if (!filePath) return;

  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);

  // condition 1 (session override half): /xend:plan off means "exit, direct edits allowed"
  const overrides = state.sessionOverrides(dir);
  if (overrides.architect === false) return;

  // condition 1 (config half): architect and its gate must both be enabled
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || config.resolve({ cwd: input.cwd });
  const arch = cfg.architect || {};
  if (!arch.enabled || arch.gate === false) return;

  // condition 2: a plan means the architect is already doing a self task or a fix
  if (fs.existsSync(path.join(dir, 'plan.json'))) return;

  // condition 3: the file is not already in edits.jsonl, and the distinct-file count there is at
  // least minFiles - 1: this call would be the minFiles-th (default 4th) distinct file edited
  // directly.
  const target = path.resolve(filePath);
  const seen = distinctEditedFiles(dir);
  if (seen.has(target)) return;
  const minFiles = arch.minFiles || 4;
  if (seen.size < minFiles - 1) return;

  // condition 4: fewer than gateMaxDenials denials so far for THIS file -- a stubborn retry of the
  // same file is denied again, bounded, and a plan lifts the gate entirely. The cap is per file,
  // not per session: a different new file gets its own count, so trying a series of new files to
  // wait out a session-wide ceiling no longer works. The session-wide total is still recorded
  // (denials) for visibility, but no longer caps anything.
  const gateState = state.readJson(path.join(dir, 'gate.json'), null) || { denials: 0, files: {} };
  const filesMap = gateFilesMap(gateState);
  const maxDenials = arch.gateMaxDenials || 3;
  if ((filesMap[target] || 0) >= maxDenials) return;

  // Wording: while this is still the first file tried above the floor this session (no other file
  // has been denied or actually edited above the floor yet), say "the 4th file" -- that's exactly
  // what it would be. Once a different file has already been touched above the floor, this one is
  // just "another file", not literally the 4th.
  const priorDistinct = new Set(seen);
  for (const f of Object.keys(filesMap)) priorDistinct.add(f);
  priorDistinct.delete(target);
  const secondWording = priorDistinct.size >= minFiles;

  filesMap[target] = (filesMap[target] || 0) + 1;
  state.writeJson(path.join(dir, 'gate.json'), {
    denials: (gateState.denials || 0) + 1,
    files: filesMap,
  });

  const cliPath = path.join(__dirname, 'xend-cli.js');
  const firstSentence = secondWording
    ? 'xend architect mode: this is another file edited directly above the floor.'
    : 'xend architect mode: this would be the 4th file you edit directly, which is above the floor.';
  const reason = firstSentence + ' ' +
    'Do not keep editing; plan the remaining work and let builders do it. ' +
    'Step 1: node "' + cliPath + '" plan set <<\'EOF\' followed by JSON {"goal": "...", "verify": "<project test command>", ' +
    '"tasks": [{"id": "T1", "title": "...", "tier": "lite|worker" (lite=Haiku by default, a precise spec is enough; ' +
    'worker=Sonnet only where judgement is needed), "files": ["..."], "testFiles": ["..."], "deps": [], ' +
    '"spec": "<exact interface and behaviour>", "verify": "<command for this task>"}]} then EOF. ' +
    'Step 2: node "' + cliPath + '" plan next prints one brief per ready task; dispatch each brief with one Agent call ' +
    '(subagent_type xend-worker-lite for lite, xend-worker for worker; prompt = the brief), independent tasks in the same message. ' +
    'Step 3: repeat plan next until it reports the plan complete, then run the project verify command. ' +
    'Give every task a verify command that can pass with only that task\'s files present (its own test file, ' +
    'or python3 -c "import pkg.mod"); the project verify runs once at the end. ' +
    'Files you already wrote stay as they are.';
  io.writeHookOutput({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

try { main(); } catch (e) { io.debug('pre-edit-gate error: ' + (e && e.stack || e)); }
process.exit(0);
