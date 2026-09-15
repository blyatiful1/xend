#!/usr/bin/env node
'use strict';
// PreToolUse (Write|Edit|MultiEdit): xend architect gate (docs/SPEC-architect.md section 13).
// In architect-enabled sessions, above the file floor and without a plan, deny a direct edit of a
// not-yet-edited file, up to gateMaxDenials times per session; once a plan exists nothing is
// denied. Never blocks: architect/gate disabled, a plan already exists, the file is already in
// edits.jsonl, still under the floor, the denial ceiling is reached, or inside a subagent.
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

  // condition 4: fewer than gateMaxDenials denials so far this session -- a stubborn retry is
  // denied again, bounded, and a plan lifts the gate entirely.
  const gateState = state.readJson(path.join(dir, 'gate.json'), null) || { denials: 0, files: [] };
  const maxDenials = arch.gateMaxDenials || 3;
  if ((gateState.denials || 0) >= maxDenials) return;

  state.writeJson(path.join(dir, 'gate.json'), {
    denials: (gateState.denials || 0) + 1,
    files: (gateState.files || []).concat([target]),
  });

  const cliPath = path.join(__dirname, 'xend-cli.js');
  const reason = 'xend architect mode: this would be the 4th file you edit directly, which is above the floor. ' +
    'Do not keep editing; plan the remaining work and let builders do it. ' +
    'Step 1: node "' + cliPath + '" plan set <<\'EOF\' followed by JSON {"goal": "...", "verify": "<project test command>", ' +
    '"tasks": [{"id": "T1", "title": "...", "tier": "lite|worker", "files": ["..."], "testFiles": ["..."], "deps": [], ' +
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
