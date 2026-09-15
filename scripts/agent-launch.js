#!/usr/bin/env node
'use strict';
// PostToolUse(Agent) hook: the Agent tool is asynchronous here (tool_response.status is
// "async_launched"; no result at this point), and this is the only hook that ever sees the
// subagent's launch-time prompt and its agentId together. Records both in <state>/agents.json so
// scripts/subagent-stop.js can recover the plan task id later by agent_id even when
// --no-session-persistence means the subagent's own transcript file is never written to disk
// (docs/SPEC-architect.md section 1, section 7 steps 3 and 8). Prints nothing; never throws.
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const verify = require('./lib/verify.js');

function main() {
  const input = io.readHookInput();
  if (!input || input.hook_event_name !== 'PostToolUse') return;
  if (input.tool_name !== 'Agent') return;
  const resp = input.tool_response || {};
  const agentId = resp.agentId || resp.agent_id;
  if (!agentId) return;
  const ti = input.tool_input || {};
  const prompt = String(ti.prompt || '');
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  verify.recordLaunch(dir, {
    agentId,
    taskId: verify.taskIdFromPrompt(prompt),
    subagentType: ti.subagent_type || null,
    prompt: prompt.slice(0, 400),
    toolUseId: input.tool_use_id || null,
  });
}

try { main(); } catch (e) { io.debug('agent-launch error: ' + (e && e.stack || e)); }
process.exit(0);
