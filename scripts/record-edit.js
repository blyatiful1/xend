#!/usr/bin/env node
'use strict';
// PostToolUse (Edit|Write|MultiEdit|NotebookEdit): record edited file paths for checkpoints and
// for the test-output rule "keep lines naming a test file edited this session". Prints nothing.
const path = require('path');
const io = require('./lib/io.js');
const state = require('./lib/state.js');

function main() {
  const input = io.readHookInput();
  if (!input || !input.tool_input) return;
  const f = input.tool_input.file_path || input.tool_input.notebook_path;
  if (!f) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  state.appendLine(path.join(dir, 'edits.jsonl'), JSON.stringify({ ts: Date.now(), tool: input.tool_name, file: f }));
}

try { main(); } catch (e) { io.debug('record-edit error: ' + (e && e.stack || e)); }
process.exit(0);
