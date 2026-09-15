#!/usr/bin/env node
'use strict';
// SubagentStop hook: deterministically verify what a subagent claims (docs/SPEC-architect.md
// section 7). Never calls a model, never throws out of the process, always exits 0. On any
// internal error it prints nothing.
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const verify = require('./lib/verify.js');

function envDisabled(v) {
  return v !== undefined && /^(0|false|off)$/i.test(String(v));
}

function main() {
  const input = io.readHookInput();
  if (!input) return;

  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  const cfg = state.readJson(path.join(dir, 'config.json'), null) || config.resolve({ cwd: input.cwd });
  const arch = cfg.architect || {};
  if (arch.verify === false) return;
  if (envDisabled(process.env.XEND_VERIFY)) return;

  const cwd = input.cwd || process.cwd();
  const agentTranscript = input.agent_transcript_path;
  const transcriptExists = !!agentTranscript && fs.existsSync(agentTranscript);

  let kind = verify.agentKind(input.agent_type);

  // Task id: the agent-launch registry (written at Agent launch, PostToolUse) first -- it
  // survives --no-session-persistence, where the subagent's own transcript file is never written
  // to disk; fall back to the transcript's first user message only when that file exists.
  const launch = verify.lookupLaunch(dir, input.agent_id);
  let taskId = launch ? launch.taskId : null;
  if (!taskId && transcriptExists) {
    taskId = verify.taskIdFromPrompt(verify.firstUserPrompt(agentTranscript));
  }

  if (!kind) {
    if (!taskId) return; // not an xend agent and no [xend task <id>] tag to treat it as a worker
    kind = 'worker';
  }

  let text = typeof input.last_assistant_message === 'string' && input.last_assistant_message
    ? input.last_assistant_message
    : (transcriptExists ? verify.lastAssistantText(agentTranscript) : '');

  // The plan task's own verify command is the contract and wins over the builder's stated one.
  const planPath = path.join(dir, 'plan.json');
  const plan = state.readJson(planPath, null);
  const task = (taskId && plan && Array.isArray(plan.tasks)) ? plan.tasks.find((t) => t.id === taskId) : null;

  const isWorkerKind = kind === 'worker' || kind === 'worker-lite';

  // Citation check applies to every kind; reader replies also get the verbatim-text check.
  const citations = verify.extractCitations(text);
  const readerEvidence = kind === 'reader' ? verify.extractReaderEvidence(text) : [];
  const citeResult = verify.checkCitations(citations, cwd, readerEvidence);

  let claimed = null, command = null, exit = null, ms = 0, stdout = '', stderr = '', malformed = false, allowed = false;
  if (isWorkerKind) {
    const reply = verify.parseWorkerReply(text);
    claimed = reply.result;
    malformed = !reply.result || (reply.command === null && reply.summary === null);
    command = (task && task.verify) ? task.verify : reply.command;
    if (!malformed && command) {
      allowed = verify.commandAllowed(command);
      if (allowed) {
        const run = verify.runVerify(command, cwd, arch.verifyTimeoutMs || 120000);
        exit = run.exit; ms = run.ms; stdout = run.stdout; stderr = run.stderr;
      }
    }
  }

  const verdict = verify.verdictFor({
    kind, claimed, allowed, exit, checked: citeResult.checked, bad: citeResult.bad, malformed,
  });

  // Scope: cannot be determined without the subagent's own transcript.
  let scopeList = [];
  let scopeForRecord = 0;
  if (!transcriptExists) {
    scopeForRecord = null;
  } else if (task) {
    const edited = verify.editedPathsFromTranscript(agentTranscript);
    scopeList = verify.scopeWarnings(edited, task, cwd);
    scopeForRecord = scopeList.length;
  }

  const blockingEnabled = arch.blockOnMismatch !== false;
  const stopHookActive = !!input.stop_hook_active;
  let blocked = false, reason = null;
  if (!stopHookActive && blockingEnabled && (verdict === 'mismatch' || verdict === 'malformed' || verdict === 'bad-citations')) {
    const combined = stdout + (stderr ? '\n' + stderr : '');
    reason = verify.blockReason(verdict, { command, exit, output: combined, bad: citeResult.bad });
    if (reason) blocked = true;
  }

  if (taskId && task) {
    verify.applyToPlan(plan, taskId, {
      verdict, claimed, stopHookActive, blockingDisabled: !blockingEnabled,
      note: verdict, scope: scopeList,
    });
    state.writeJson(planPath, plan);
  }

  state.appendLine(path.join(dir, 'verify.jsonl'), JSON.stringify({
    ts: Date.now(),
    agent_id: input.agent_id || null,
    agent_type: input.agent_type || null,
    kind,
    task: taskId || null,
    claimed,
    verdict,
    command: command || null,
    exit,
    ms,
    blocked,
    checked: citeResult.checked,
    bad: citeResult.bad.length,
    scope: scopeForRecord,
  }));

  if (blocked) io.writeHookOutput({ decision: 'block', reason });
}

try { main(); } catch (e) { io.debug('subagent-stop error: ' + (e && e.stack || e)); }
process.exit(0);
