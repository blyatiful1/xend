#!/usr/bin/env node
'use strict';
// PostToolUse (Edit|Write|MultiEdit|NotebookEdit): record edited file paths for checkpoints and
// for the test-output rule "keep lines naming a test file edited this session"; then, after an
// Edit or MultiEdit in the main session, run the project's quick tests and hand the result to the
// model with the edit (scripts/lib/autotest.js), which saves the separate test turn. A command
// Claude Code would ask about is not run; the user gets a one-time note on how to allow it.
// agent_type alone does not mark a subagent: the main thread of a `claude --agent` session carries
// it too; agent_id is set only inside subagents.
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const autotest = require('./lib/autotest.js');
const permissions = require('./lib/permissions.js');

function main() {
  const input = io.readHookInput();
  if (!input || !input.tool_input) return;
  const f = input.tool_input.file_path || input.tool_input.notebook_path;
  if (!f) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  state.appendLine(path.join(dir, 'edits.jsonl'), JSON.stringify({ ts: Date.now(), tool: input.tool_name, file: f }));

  if (input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit') return;
  if (input.agent_id || /\/subagents\//.test(input.transcript_path || '')) return;
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || config.resolve({ cwd: input.cwd });
  const overrides = state.sessionOverrides(dir);
  if (overrides.enabled === false) return;
  const ac = cfg.autoTest || {};
  if (!ac.enabled) return;
  const root = input.cwd || process.cwd();
  const abs = path.resolve(root, f);
  let hint = null;
  const note = autotest.run({
    root, file: abs, cfg: ac, dir, toolUseId: input.tool_use_id,
    permissionMode: input.permission_mode, trusted: cfg.trustTestCommands === true,
    onBlocked: (cmd, perm) => { hint = permissions.hintOnce(dir, cmd, perm, 'xend auto-test is waiting for permission'); },
  });
  if (note) io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: note } });
  else if (hint) io.writeHookOutput({ systemMessage: hint });
}

try { main(); } catch (e) { io.debug('record-edit error: ' + (e && e.stack || e)); }
process.exit(0);
