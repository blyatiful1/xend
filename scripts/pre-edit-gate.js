#!/usr/bin/env node
'use strict';
// PreToolUse (Write|Edit|MultiEdit): xend architect gate (docs/SPEC-architect.md section 13).
// In architect-enabled sessions, without a plan and before the gate has fired once this session,
// deny the third distinct direct file edit so "just do the work" does not silently skip planning.
// Never blocks: architect/gate disabled, a plan already exists, already fired once, inside a
// subagent, editing a file already touched this session, or still under the floor.
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

  // condition 3: fires at most once per session
  if (fs.existsSync(path.join(dir, 'gate.json'))) return;

  // condition 4: this call must be the third distinct file edited directly
  const target = path.resolve(filePath);
  const seen = distinctEditedFiles(dir);
  if (seen.has(target)) return;
  const minFiles = arch.minFiles || 3;
  if (seen.size < minFiles - 1) return;

  state.writeJson(path.join(dir, 'gate.json'), { fired: true, file: target });
  const cliPath = path.join(__dirname, 'xend-cli.js');
  const reason = 'xend architect mode: this would be the 3rd file you edit directly, which is above the floor. ' +
    'Plan the remaining work instead: node "' + cliPath + '" plan set <<\'EOF\' {goal, verify, tasks:[{id, title, tier, files, testFiles, deps, spec, verify}]} EOF, ' +
    'then node "' + cliPath + '" plan next and dispatch each brief with one Agent call (subagent_type xend-worker-lite or xend-worker). ' +
    'To keep editing directly, run node "' + cliPath + '" plan off and retry. This notice appears once.';
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
