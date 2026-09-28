#!/usr/bin/env node
'use strict';
// PostToolUse (Edit|Write|MultiEdit|NotebookEdit): record edited file paths for checkpoints and
// for the test-output rule "keep lines naming a test file edited this session"; then, after an
// Edit or MultiEdit in the main session, run the project's quick tests and hand the result to the
// model with the edit (scripts/lib/autotest.js), which saves the separate test turn.
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const autotest = require('./lib/autotest.js');

function main() {
  const input = io.readHookInput();
  if (!input || !input.tool_input) return;
  const f = input.tool_input.file_path || input.tool_input.notebook_path;
  if (!f) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  state.appendLine(path.join(dir, 'edits.jsonl'), JSON.stringify({ ts: Date.now(), tool: input.tool_name, file: f }));

  if (input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit') return;
  if (input.agent_id || input.agent_type || /\/subagents\//.test(input.transcript_path || '')) return;
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || config.resolve({ cwd: input.cwd });
  const overrides = state.sessionOverrides(dir);
  if (overrides.enabled === false) return;
  const ac = cfg.autoTest || {};
  if (!ac.enabled) return;
  const root = input.cwd || process.cwd();
  const abs = path.resolve(root, f);
  const note = autotest.run({ root, file: abs, cfg: ac, dir, toolUseId: input.tool_use_id });
  if (!note) return;
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } });
}

try { main(); } catch (e) { io.debug('record-edit error: ' + (e && e.stack || e)); }
process.exit(0);
