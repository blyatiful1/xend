'use strict';
// The architect plan: validation, runtime state, briefs and status text. See SPEC-architect.md
// section 5. No timestamps anywhere in this file: printed views must stay reproducible.
const path = require('path');
const state = require('./state.js');

const PLAN_FILE = 'plan.json';
const ID_RE = /^[A-Za-z][\w-]*$/;
const TIERS = ['lite', 'worker'];
const SUBAGENT_TYPES = { lite: 'xend-worker-lite', worker: 'xend-worker' };

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((s) => typeof s === 'string'); }

// --- validation --------------------------------------------------------------

function findCycle(tasks) {
  const graph = new Map();
  for (const t of tasks) {
    if (t && typeof t.id === 'string') graph.set(t.id, isStringArray(t.deps) ? t.deps : []);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  let cyclePath = null;
  function visit(id, stack) {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of graph.get(id) || []) {
      if (cyclePath) return;
      if (!graph.has(dep)) continue; // unknown deps are reported separately
      const c = color.get(dep) || WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(dep);
        cyclePath = stack.slice(idx).concat(dep);
        return;
      } else if (c === WHITE) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  }
  for (const id of graph.keys()) {
    if (cyclePath) break;
    if ((color.get(id) || WHITE) === WHITE) visit(id, []);
  }
  return cyclePath;
}

// Returns { ok, errors[], warnings[] }. One message per problem; never throws on malformed input.
// Warnings are non-fatal (ok can still be true) and flag plans where a task's verify command
// cannot pass with only that task's files present, which is the bench pilot's root cause for
// builders replying BLOCKED: the planning model gave every task the whole project verify.
function validate(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['plan must be a JSON object'], warnings: [] };
  }
  if (!isNonEmptyString(input.goal)) errors.push('goal must be a non-empty string');
  if (!isNonEmptyString(input.verify)) errors.push('verify must be a non-empty string');
  if (input.conventions !== undefined && typeof input.conventions !== 'string') {
    errors.push('conventions must be a string');
  }
  if (!Array.isArray(input.tasks)) {
    errors.push('tasks must be an array');
    return { ok: false, errors, warnings: [] };
  }
  const ids = new Set();
  for (const t of input.tasks) if (t && typeof t.id === 'string') ids.add(t.id);
  const seen = new Set();
  input.tasks.forEach((t, i) => {
    const label = (t && typeof t.id === 'string' && t.id) ? t.id : ('tasks[' + i + ']');
    if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(label + ': task must be an object'); return; }
    if (!isNonEmptyString(t.id) || !ID_RE.test(t.id)) {
      errors.push(label + ': id must be a non-empty string matching ^[A-Za-z][\\w-]*$');
    } else if (seen.has(t.id)) {
      errors.push('duplicate task id: ' + t.id);
    } else {
      seen.add(t.id);
    }
    if (!isNonEmptyString(t.title)) errors.push(label + ': title must be a non-empty string');
    if (t.tier !== undefined && !TIERS.includes(t.tier)) errors.push(label + ': tier must be lite or worker');
    if (!Array.isArray(t.files) || t.files.length === 0 || !isStringArray(t.files)) {
      errors.push(label + ': files must be a non-empty array of strings');
    }
    if (t.testFiles !== undefined && !isStringArray(t.testFiles)) {
      errors.push(label + ': testFiles must be an array of strings');
    }
    if (t.deps !== undefined) {
      if (!isStringArray(t.deps)) {
        errors.push(label + ': deps must be an array of strings');
      } else {
        for (const d of t.deps) if (!ids.has(d)) errors.push(label + ': unknown dep ' + d);
      }
    }
    if (!isNonEmptyString(t.spec)) errors.push(label + ': spec must be a non-empty string');
    if (!isNonEmptyString(t.verify)) errors.push(label + ': verify must be a non-empty string');
  });
  const cycle = findCycle(input.tasks);
  if (cycle) errors.push('dependency cycle: ' + cycle.join(' -> '));

  const warnings = [];
  if (isNonEmptyString(input.verify)) {
    for (const t of input.tasks) {
      if (t && isNonEmptyString(t.id) && isNonEmptyString(t.verify) && t.verify === input.verify) {
        warnings.push('task ' + t.id + ': verify equals the project verify; each task\'s verify must pass ' +
          'with only that task\'s files present (a module\'s own test file, or python3 -c "import pkg.mod")');
      }
    }
  }
  if (input.tasks.length >= 2) {
    const verifies = input.tasks.filter((t) => t && isNonEmptyString(t.verify)).map((t) => t.verify);
    if (verifies.length === input.tasks.length && new Set(verifies).size === 1) {
      warnings.push('all tasks share one verify command; split them so each can pass in isolation');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// --- runtime shape -------------------------------------------------------------

// Caller must validate() first. Adds the runtime fields xend tracks per task.
function normalize(input) {
  const plan = {
    goal: input.goal,
    verify: input.verify,
    tasks: input.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      tier: t.tier || 'worker',
      files: t.files.slice(),
      testFiles: isStringArray(t.testFiles) ? t.testFiles.slice() : [],
      deps: isStringArray(t.deps) ? t.deps.slice() : [],
      spec: t.spec,
      verify: t.verify,
      status: 'todo',
      attempts: 0,
      verified: false,
      lastVerdict: '',
      scopeWarnings: [],
    })),
  };
  if (isNonEmptyString(input.conventions)) plan.conventions = input.conventions;
  return plan;
}

function planPath(dir) { return path.join(dir, PLAN_FILE); }
function load(dir) { return state.readJson(planPath(dir), null); }
function save(dir, plan) { return state.writeJson(planPath(dir), plan); }

// --- scheduling ------------------------------------------------------------

// A task is ready when its deps are all done and it has not already been dispatched, finished,
// or escalated to the architect. A 'failed' task stops being ready once it has hit the
// escalation ceiling (see tierFor); a 'todo' task (e.g. after `plan reset`) is always ready.
function isReady(plan, task) {
  if (task.status !== 'todo' && task.status !== 'failed') return false;
  if (task.status === 'failed' && task.attempts >= 3) return false;
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  for (const d of task.deps) {
    const dt = byId.get(d);
    if (!dt || dt.status !== 'done') return false;
  }
  return true;
}

function ready(plan) { return plan.tasks.filter((t) => isReady(plan, t)); }

// Escalation ladder: the task's own tier first, worker for the next two attempts, then the
// architect does it itself.
function tierFor(task) {
  if (task.attempts >= 3) return 'self';
  if (task.attempts === 0) return task.tier;
  return 'worker';
}

// Exact format from SPEC-architect.md section 5; the first line is what the verifier keys on.
function brief(plan, task) {
  const lines = [];
  lines.push('[xend task ' + task.id + '] ' + task.title);
  lines.push('Goal: ' + plan.goal);
  lines.push('Scope: edit only ' + task.files.join(', ') + '; tests you may add or edit: ' + (task.testFiles.length ? task.testFiles.join(', ') : 'none'));
  lines.push('Spec:');
  lines.push(task.spec);
  lines.push('Verify: ' + task.verify + ' (must pass; xend re-runs it after you finish)');
  if (plan.conventions) lines.push('Conventions: ' + plan.conventions);
  lines.push('Reply in the fixed format, starting with the line Task: ' + task.id + ', then Result / Changed / Verification / Notes.');
  return lines.join('\n');
}

function taskStatusLine(plan, task) {
  if (task.status === 'done') return task.id + ' done ' + (task.verified ? 'verified' : 'unverified');
  if (task.status === 'dispatched') return task.id + ' dispatched (' + tierFor(task) + ', attempt ' + (task.attempts + 1) + ')';
  if (task.status === 'failed') return task.id + ' failed x' + task.attempts + (task.lastVerdict ? ': ' + task.lastVerdict : '');
  if (task.status === 'self') return task.id + ' self' + (task.lastVerdict ? ': ' + task.lastVerdict : '');
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const blockers = task.deps.filter((d) => { const dt = byId.get(d); return !dt || dt.status !== 'done'; });
  return blockers.length ? task.id + ' todo blocked by ' + blockers.join(', ') : task.id + ' todo';
}

function statusLines(plan) {
  const lines = plan.tasks.map((t) => taskStatusLine(plan, t));
  lines.push('verify: ' + plan.verify);
  const warnings = plan.tasks.filter((t) => t.scopeWarnings && t.scopeWarnings.length)
    .map((t) => t.id + ': ' + t.scopeWarnings.join(', '));
  if (warnings.length) lines.push('scope warnings: ' + warnings.join('; '));
  return lines;
}

// Computes what to dispatch next. Mutates task status (dispatched / self) unless opts.peek.
// Returns { dispatch: [{ task, subagentType, brief }], self: [task], complete }.
function next(plan, opts) {
  opts = opts || {};
  const peek = !!opts.peek;
  const dispatch = [];
  const self = [];
  for (const task of ready(plan)) {
    const tier = tierFor(task);
    if (tier === 'self') {
      self.push(task);
      if (!peek) task.status = 'self';
    } else {
      dispatch.push({ task, subagentType: SUBAGENT_TYPES[tier], brief: brief(plan, task) });
      if (!peek) task.status = 'dispatched';
    }
  }
  const complete = plan.tasks.length > 0 && plan.tasks.every((t) => t.status === 'done');
  return { dispatch, self, complete };
}

// Manual verdict: the architect did the task itself, or is overriding a builder's claim.
function markDone(plan, id, verdict, note) {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) return { ok: false, error: 'unknown task: ' + id };
  const v = String(verdict || '').toUpperCase();
  if (v !== 'PASS' && v !== 'FAIL') return { ok: false, error: 'verdict must be PASS or FAIL' };
  if (v === 'PASS') {
    task.status = 'done';
    task.verified = true;
    task.lastVerdict = isNonEmptyString(note) ? note : 'manual pass';
  } else {
    task.status = 'failed';
    task.attempts += 1;
    task.verified = false;
    task.lastVerdict = isNonEmptyString(note) ? note : 'manual fail';
  }
  return { ok: true, task };
}

// Back to todo; attempts (and so the escalation ladder) are kept.
function reset(plan, id) {
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) return null;
  task.status = 'todo';
  return task;
}

module.exports = {
  ID_RE, TIERS, SUBAGENT_TYPES,
  validate, normalize, load, save,
  ready, tierFor, brief, statusLines, taskStatusLine, next, markDone, reset,
};
