#!/usr/bin/env node
'use strict';
// SubagentStop hook: deterministically verify what a subagent claims (docs/SPEC-architect.md
// section 7). Never calls a model, never throws out of the process, always exits 0. On any
// internal error it prints nothing.
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const permissions = require('./lib/permissions.js');
const state = require('./lib/state.js');
const verify = require('./lib/verify.js');

// below this hook's own 180 s timeout in hooks/hooks.json, so a slow check is reported, not killed
const { VERIFY_TIMEOUT_CAP_MS } = config;

function envDisabled(v) {
  return v !== undefined && /^(0|false|off)$/i.test(String(v));
}

function main() {
  const input = io.readHookInput();
  if (!input) return;

  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  // resolved now, not read from the session's cached config.json, which the model may be able to
  // write: trustTestCommands and the timeouts decide what runs without a prompt
  const cfg = config.resolve({ cwd: input.cwd });
  const arch = cfg.architect || {};
  if (arch.verify === false) return;
  if (envDisabled(process.env.XEND_VERIFY)) return;

  const cwd = input.cwd || process.cwd();
  let kind = verify.agentKind(input.agent_type);

  // Only xend's own agents, and builders dispatched for a task of this session's plan, are
  // verified. Any other subagent (Explore, general-purpose, another plugin's) returns here, before
  // any wait or file read: most sessions have no plan at all.
  const planPath = path.join(dir, 'plan.json');
  const plan = state.readJson(planPath, null);
  const hasPlan = !!(plan && Array.isArray(plan.tasks) && plan.tasks.length);
  if (!kind && !hasPlan) return;

  const agentTranscript = input.agent_transcript_path;
  const transcriptExists = !!agentTranscript && fs.existsSync(agentTranscript);

  let text = typeof input.last_assistant_message === 'string' && input.last_assistant_message
    ? input.last_assistant_message
    : (transcriptExists ? verify.lastAssistantText(agentTranscript) : '');

  // Parsed once: reused both for task id resolution (the reply's own Task: line) and, for worker
  // kinds, the claimed result and verify command below.
  const reply = verify.parseWorkerReply(text);

  // Task id, in order: the reply's own "Task: <id>" line first -- when the Agent tool runs in
  // foreground mode, PostToolUse(Agent) fires only *after* SubagentStop, so the agent-launch
  // registry entry does not exist yet at verification time and the reply is the only channel
  // guaranteed to be there. Then the registry (written at Agent launch), retried up to 3 times
  // with a short pause for a write that is merely slow to land. Then the subagent's own
  // transcript, when that file exists (it does not under --no-session-persistence).
  let taskId = null;
  let lookup = 'miss';
  if (reply.task) {
    taskId = reply.task;
    lookup = 'reply';
  } else if (hasPlan) {
    let launch = input.agent_id ? verify.lookupLaunch(dir, input.agent_id) : null;
    for (let tries = 0; !launch && input.agent_id && tries < 3; tries++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      launch = verify.lookupLaunch(dir, input.agent_id);
    }
    if (launch && launch.taskId) {
      taskId = launch.taskId;
      lookup = 'registry';
    } else if (transcriptExists) {
      const fromTranscript = verify.taskIdFromPrompt(verify.firstUserPrompt(agentTranscript));
      if (fromTranscript) { taskId = fromTranscript; lookup = 'transcript'; }
    }
  }

  // The plan task's own verify command is the contract and wins over the builder's stated one.
  const task = (taskId && hasPlan) ? plan.tasks.find((t) => t.id === taskId) : null;

  if (!kind) {
    // not an xend agent: treated as a builder only when its task id names a task of this plan
    if (!task) return;
    kind = 'worker';
  }

  const isWorkerKind = kind === 'worker' || kind === 'worker-lite';

  // Citation check applies to every kind; reader replies also get the verbatim-text check.
  const citations = verify.extractCitations(text);
  const readerEvidence = kind === 'reader' ? verify.extractReaderEvidence(text) : [];
  const citeResult = verify.checkCitations(citations, cwd, readerEvidence);

  let claimed = null, command = null, exit = null, ms = 0, stdout = '', stderr = '', malformed = false, allowed = false;
  let skipped = null, hint = null;
  if (isWorkerKind) {
    claimed = reply.result;
    malformed = !reply.result || (reply.command === null && reply.summary === null);
    command = (task && task.verify) ? task.verify : reply.command;
    if (!malformed && command) {
      allowed = verify.commandAllowed(command);
      if (!allowed) skipped = 'not-allowlisted';
      else {
        // no prompt can be shown from here: run only what Claude Code would run without asking
        const perm = permissions.check(command, { cwd, permissionMode: input.permission_mode, trusted: cfg.trustTestCommands === true });
        if (!perm.ok) {
          allowed = false; skipped = perm.reason;
          hint = permissions.hintOnce(dir, command, perm, 'xend could not re-run a builder\'s check');
        } else {
          const timeout = Math.min(arch.verifyTimeoutMs || 120000, VERIFY_TIMEOUT_CAP_MS);
          const run = verify.runVerify(command, cwd, timeout);
          exit = run.exit; ms = run.ms; stdout = run.stdout; stderr = run.stderr;
          // xend could not start it here (a runner missing on this machine, a Windows shim): that
          // verifies nothing either way, so it is not a mismatch to block on. A command that ran and
          // exited 126/127 itself (npm's script calling a missing tool) stays an ordinary failure.
          if (run.notRunnable) { allowed = false; skipped = 'not-runnable'; }
        }
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
    lookup,
    claimed,
    verdict,
    command: command || null,
    exit,
    ms,
    skipped,
    blocked,
    checked: citeResult.checked,
    bad: citeResult.bad.length,
    scope: scopeForRecord,
  }));

  if (blocked) io.writeHookOutput(Object.assign({ decision: 'block', reason }, hint ? { systemMessage: hint } : {}));
  else if (hint) io.writeHookOutput({ systemMessage: hint });
}

try { main(); } catch (e) { io.debug('subagent-stop error: ' + (e && e.stack || e)); }
process.exit(0);
