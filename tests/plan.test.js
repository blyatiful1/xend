'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plan = require('../scripts/lib/plan.js');
const state = require('../scripts/lib/state.js');
const config = require('../scripts/lib/config.js');
const context = require('../scripts/lib/context.js');

function task(over) {
  return Object.assign({ id: 'T1', title: 'a task', files: ['a.js'], spec: 'do the thing', verify: 'npm test' }, over);
}

test('validate: duplicate id', () => {
  const v = plan.validate({ goal: 'g', verify: 'v', tasks: [task({ id: 'T1' }), task({ id: 'T1', files: ['b.js'] })] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /duplicate task id: T1/.test(e)), v.errors.join('; '));
});

test('validate: unknown dep', () => {
  const v = plan.validate({ goal: 'g', verify: 'v', tasks: [task({ deps: ['T9'] })] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /unknown dep T9/.test(e)), v.errors.join('; '));
});

test('validate: dependency cycle', () => {
  const v = plan.validate({
    goal: 'g', verify: 'v',
    tasks: [task({ id: 'T1', deps: ['T2'] }), task({ id: 'T2', deps: ['T1'], files: ['b.js'] })],
  });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /dependency cycle/.test(e)), v.errors.join('; '));
});

test('validate: missing spec', () => {
  const bad = task({}); delete bad.spec;
  const v = plan.validate({ goal: 'g', verify: 'v', tasks: [bad] });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /T1: spec must be a non-empty string/.test(e)), v.errors.join('; '));
});

test('validate: other required fields (id shape, tier, files, goal, top-level verify)', () => {
  assert.strictEqual(plan.validate({ goal: '', verify: '', tasks: [] }).ok, false);
  const bad = plan.validate({ goal: 'g', verify: 'v', tasks: [task({ id: '9bad' })] });
  assert.ok(bad.errors.some((e) => /id must be/.test(e)));
  const badTier = plan.validate({ goal: 'g', verify: 'v', tasks: [task({ tier: 'nope' })] });
  assert.ok(badTier.errors.some((e) => /tier must be lite or worker/.test(e)));
  const noFiles = plan.validate({ goal: 'g', verify: 'v', tasks: [task({ files: [] })] });
  assert.ok(noFiles.errors.some((e) => /files must be a non-empty array/.test(e)));
});

test('validate: a well-formed plan is ok', () => {
  const v = plan.validate({
    goal: 'g', verify: 'npm test',
    tasks: [
      task({ id: 'T1', tier: 'lite', verify: 'node --test tests/test_a.js' }),
      task({ id: 'T2', deps: ['T1'], files: ['b.js'], verify: 'node --test tests/test_b.js' }),
    ],
  });
  assert.deepStrictEqual(v, { ok: true, errors: [], warnings: [] });
});

// --- validate: verify-scoping warnings (docs/SPEC-architect.md section 5 + the bench pilot) ----

test('validate: warns per task whose verify equals the project verify', () => {
  const v = plan.validate({
    goal: 'g', verify: 'npm test',
    tasks: [
      task({ id: 'T1', verify: 'npm test' }),
      task({ id: 'T2', files: ['b.js'], verify: 'node --test tests/test_b.js' }),
    ],
  });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.warnings.length, 1);
  assert.match(v.warnings[0], /^task T1: verify equals the project verify/);
  assert.match(v.warnings[0], /python3 -c "import pkg\.mod"/);
});

test('validate: warns once when 2+ tasks all share one identical verify command', () => {
  const v = plan.validate({
    goal: 'g', verify: 'npm test -- everything',
    tasks: [
      task({ id: 'T1', verify: 'npm test -- mod' }),
      task({ id: 'T2', files: ['b.js'], verify: 'npm test -- mod' }),
    ],
  });
  assert.strictEqual(v.ok, true);
  assert.ok(v.warnings.includes('all tasks share one verify command; split them so each can pass in isolation'), v.warnings.join('; '));
});

test('validate: both warnings fire together when every task copies the project verify', () => {
  const v = plan.validate({
    goal: 'g', verify: 'npm test',
    tasks: [task({ id: 'T1', verify: 'npm test' }), task({ id: 'T2', files: ['b.js'], verify: 'npm test' })],
  });
  assert.strictEqual(v.warnings.length, 3); // T1, T2 each get warning (a), plus one warning (b)
  assert.ok(v.warnings.some((w) => /^task T1: verify equals the project verify/.test(w)));
  assert.ok(v.warnings.some((w) => /^task T2: verify equals the project verify/.test(w)));
  assert.ok(v.warnings.includes('all tasks share one verify command; split them so each can pass in isolation'));
});

test('validate: a single-task plan sharing the project verify only gets warning (a), never (b)', () => {
  const v = plan.validate({ goal: 'g', verify: 'npm test', tasks: [task({ id: 'T1', verify: 'npm test' })] });
  assert.deepStrictEqual(v.warnings, [
    'task T1: verify equals the project verify; each task\'s verify must pass with only that task\'s files present (a module\'s own test file, or python3 -c "import pkg.mod")',
  ]);
});

test('normalize: adds runtime fields, defaults tier/deps/testFiles', () => {
  const p = plan.normalize({ goal: 'g', verify: 'npm test', tasks: [task({})] });
  assert.strictEqual(p.tasks[0].status, 'todo');
  assert.strictEqual(p.tasks[0].attempts, 0);
  assert.strictEqual(p.tasks[0].verified, false);
  assert.strictEqual(p.tasks[0].lastVerdict, '');
  assert.deepStrictEqual(p.tasks[0].scopeWarnings, []);
  assert.strictEqual(p.tasks[0].tier, 'worker'); // default
  assert.deepStrictEqual(p.tasks[0].deps, []);
  assert.deepStrictEqual(p.tasks[0].testFiles, []);
});

test('save/load round-trips through an atomic write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-plan-'));
  const p = plan.normalize({ goal: 'g', verify: 'npm test', tasks: [task({})] });
  assert.strictEqual(plan.save(dir, p), true);
  assert.ok(fs.existsSync(path.join(dir, 'plan.json')));
  const loaded = plan.load(dir);
  assert.deepStrictEqual(loaded, p);
  assert.strictEqual(plan.load(path.join(dir, 'nope')), null);
});

test('ready(): respects deps and the failed-attempts ceiling', () => {
  const p = plan.normalize({
    goal: 'g', verify: 'v',
    tasks: [task({ id: 'T1' }), task({ id: 'T2', deps: ['T1'], files: ['b.js'] })],
  });
  assert.deepStrictEqual(plan.ready(p).map((t) => t.id), ['T1']);
  p.tasks[0].status = 'done';
  assert.deepStrictEqual(plan.ready(p).map((t) => t.id), ['T2']);
  // a failed task under the ceiling is still ready
  p.tasks[1].status = 'failed'; p.tasks[1].attempts = 2;
  assert.deepStrictEqual(plan.ready(p).map((t) => t.id), ['T2']);
  // at the ceiling it drops out
  p.tasks[1].attempts = 3;
  assert.deepStrictEqual(plan.ready(p).map((t) => t.id), []);
});

test('tierFor(): escalates lite -> worker -> worker -> self by attempts', () => {
  const t = task({ tier: 'lite' });
  assert.strictEqual(plan.tierFor(Object.assign({}, t, { attempts: 0 })), 'lite');
  assert.strictEqual(plan.tierFor(Object.assign({}, t, { attempts: 1 })), 'worker');
  assert.strictEqual(plan.tierFor(Object.assign({}, t, { attempts: 2 })), 'worker');
  assert.strictEqual(plan.tierFor(Object.assign({}, t, { attempts: 3 })), 'self');
  assert.strictEqual(plan.tierFor(Object.assign({}, t, { attempts: 9 })), 'self');
});

test('brief(): exact first line, scope, and verify line', () => {
  const p = plan.normalize({
    goal: 'Ship the thing', verify: 'npm test', conventions: 'use 2 spaces',
    tasks: [task({ id: 'T3', title: 'model dataclasses', files: ['a.js', 'b.js'], testFiles: ['a.test.js'], spec: 'exact behaviour...', verify: 'npm test -- a' })],
  });
  const b = plan.brief(p, p.tasks[0]);
  const lines = b.split('\n');
  assert.strictEqual(lines[0], '[xend task T3] model dataclasses');
  assert.strictEqual(lines[1], 'Goal: Ship the thing');
  assert.strictEqual(lines[2], 'Scope: edit only a.js, b.js; tests you may add or edit: a.test.js');
  assert.strictEqual(lines[3], 'Spec:');
  assert.strictEqual(lines[4], 'exact behaviour...');
  assert.strictEqual(lines[5], 'Verify: npm test -- a (must pass; xend re-runs it after you finish)');
  assert.strictEqual(lines[6], 'Conventions: use 2 spaces');
  assert.strictEqual(lines[7], 'Reply in the fixed format, starting with the line Task: T3, then Result / Changed / Verification / Notes.');

  // no testFiles -> "none"; no conventions -> line omitted
  const p2 = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({ id: 'T1' })] });
  const b2 = plan.brief(p2, p2.tasks[0]);
  assert.ok(b2.includes('tests you may add or edit: none'));
  assert.ok(!b2.includes('Conventions:'));
});

test('next(): dispatches ready tasks, marks status, computes subagent_type by tier', () => {
  const p = plan.normalize({
    goal: 'g', verify: 'v',
    tasks: [task({ id: 'T1', tier: 'lite' }), task({ id: 'T2', tier: 'worker', files: ['b.js'] })],
  });
  const result = plan.next(p, {});
  assert.strictEqual(result.dispatch.length, 2);
  assert.strictEqual(result.complete, false);
  const byId = Object.fromEntries(result.dispatch.map((d) => [d.task.id, d]));
  assert.strictEqual(byId.T1.subagentType, 'xend-worker-lite');
  assert.strictEqual(byId.T2.subagentType, 'xend-worker');
  assert.ok(byId.T1.brief.startsWith('[xend task T1]'));
  assert.strictEqual(p.tasks[0].status, 'dispatched');
  assert.strictEqual(p.tasks[1].status, 'dispatched');
});

test('next(): a task escalated past the ceiling goes to self, not dispatch', () => {
  const p = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  p.tasks[0].status = 'todo'; p.tasks[0].attempts = 3; p.tasks[0].lastVerdict = 'still broken';
  const result = plan.next(p, {});
  assert.strictEqual(result.dispatch.length, 0);
  assert.strictEqual(result.self.length, 1);
  assert.strictEqual(result.self[0].id, 'T1');
  assert.strictEqual(p.tasks[0].status, 'self');
});

test('next({ peek: true }): computes the same result without mutating status', () => {
  const p = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  const before = JSON.parse(JSON.stringify(p));
  const result = plan.next(p, { peek: true });
  assert.strictEqual(result.dispatch.length, 1);
  assert.deepStrictEqual(p, before, 'peek must not mutate the plan');
});

test('next(): complete is true only once every task is done', () => {
  const p = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  assert.strictEqual(plan.next(p, { peek: true }).complete, false);
  p.tasks[0].status = 'done';
  assert.strictEqual(plan.next(p, {}).complete, true);
});

test('statusLines(): one line per task, verify line, blocked-by, and warnings', () => {
  const p = plan.normalize({
    goal: 'g', verify: 'npm test',
    tasks: [task({ id: 'T1' }), task({ id: 'T2', deps: ['T1'], files: ['b.js'] })],
  });
  let lines = plan.statusLines(p);
  assert.strictEqual(lines[0], 'T1 todo');
  assert.strictEqual(lines[1], 'T2 todo blocked by T1');
  assert.strictEqual(lines[2], 'verify: npm test');

  p.tasks[0].status = 'dispatched'; p.tasks[0].attempts = 1;
  assert.strictEqual(plan.taskStatusLine(p, p.tasks[0]), 'T1 dispatched (worker, attempt 2)');

  p.tasks[0].status = 'failed'; p.tasks[0].attempts = 2; p.tasks[0].lastVerdict = 'tests failed';
  assert.strictEqual(plan.taskStatusLine(p, p.tasks[0]), 'T1 failed x2: tests failed');

  p.tasks[0].status = 'done'; p.tasks[0].verified = true;
  assert.strictEqual(plan.taskStatusLine(p, p.tasks[0]), 'T1 done verified');
  p.tasks[0].verified = false;
  assert.strictEqual(plan.taskStatusLine(p, p.tasks[0]), 'T1 done unverified');

  p.tasks[0].scopeWarnings = ['c.js'];
  lines = plan.statusLines(p);
  assert.ok(lines[lines.length - 1].startsWith('scope warnings: T1: c.js'), lines.join('\n'));
});

test('markDone(): PASS marks done+verified, FAIL marks failed and bumps attempts', () => {
  const p = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  const pass = plan.markDone(p, 'T1', 'PASS', 'looked at it myself');
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(p.tasks[0].status, 'done');
  assert.strictEqual(p.tasks[0].verified, true);
  assert.strictEqual(p.tasks[0].lastVerdict, 'looked at it myself');

  const p2 = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  const fail = plan.markDone(p2, 'T1', 'fail'); // lower-case accepted
  assert.strictEqual(fail.ok, true);
  assert.strictEqual(p2.tasks[0].status, 'failed');
  assert.strictEqual(p2.tasks[0].attempts, 1);
  assert.strictEqual(p2.tasks[0].verified, false);

  assert.strictEqual(plan.markDone(p, 'NOPE', 'PASS').ok, false);
  assert.strictEqual(plan.markDone(p, 'T1', 'MAYBE').ok, false);
});

test('reset(): back to todo, attempts kept', () => {
  const p = plan.normalize({ goal: 'g', verify: 'v', tasks: [task({})] });
  p.tasks[0].status = 'failed'; p.tasks[0].attempts = 2;
  const t = plan.reset(p, 'T1');
  assert.strictEqual(t.status, 'todo');
  assert.strictEqual(t.attempts, 2);
  assert.strictEqual(plan.reset(p, 'NOPE'), null);
});

// --- session pointer resolution (scripts/lib/state.js) ------------------------

test('state.resolveSessionDir: arg > env > cwd pointer > latest pointer > none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-plan-ptr-'));
  const env = { XEND_STATE_DIR: root };
  const dir = state.sessionDir('sessA', env);
  state.writeSessionPointers(env, 'sessA', dir, '/some/project');

  assert.deepStrictEqual(state.resolveSessionDir({ env, cwd: '/some/project' }), { dir, id: 'sessA', source: 'cwd' });
  assert.deepStrictEqual(state.resolveSessionDir({ env, cwd: '/elsewhere' }), { dir, id: 'sessA', source: 'latest' });
  assert.deepStrictEqual(
    state.resolveSessionDir({ env: Object.assign({}, env, { CLAUDE_CODE_SESSION_ID: 'sessA' }), cwd: '/elsewhere' }),
    { dir, id: 'sessA', source: 'env' },
  );
  const argResolved = state.resolveSessionDir({ session: 'sessB', env, cwd: '/some/project' });
  assert.strictEqual(argResolved.source, 'arg');
  assert.strictEqual(argResolved.id, 'sessB');

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-plan-ptr-empty-'));
  assert.deepStrictEqual(state.resolveSessionDir({ env: { XEND_STATE_DIR: empty }, cwd: '/nowhere' }), { dir: null, id: null, source: null });
});

test('writeSessionPointers never throws even with a bad state dir', () => {
  assert.doesNotThrow(() => state.writeSessionPointers({ XEND_STATE_DIR: '\0bad' }, 's', '/tmp/x', '/cwd'));
});

// --- config: XEND_ARCHITECT / XEND_VERIFY and profile defaults ----------------

test('config: architect profile defaults (lite off, balanced/aggressive on)', () => {
  const lite = config.resolve({ env: { XEND_PROFILE: 'lite' }, cwd: os.tmpdir() });
  assert.strictEqual(lite.architect.enabled, false);
  const balanced = config.resolve({ env: {}, cwd: os.tmpdir() });
  assert.strictEqual(balanced.architect.enabled, true);
  const aggressive = config.resolve({ env: { XEND_PROFILE: 'aggressive' }, cwd: os.tmpdir() });
  assert.strictEqual(aggressive.architect.enabled, true);
  assert.strictEqual(balanced.architect.minFiles, 4);
  assert.strictEqual(balanced.architect.gateMaxDenials, 3);
  assert.strictEqual(balanced.architect.minToolCalls, 8);
  assert.strictEqual(balanced.architect.verify, true);
  assert.strictEqual(balanced.architect.verifyTimeoutMs, 120000);
  assert.strictEqual(balanced.architect.blockOnMismatch, true);
});

test('config: XEND_ARCHITECT=0 disables regardless of profile', () => {
  const off = config.resolve({ env: { XEND_ARCHITECT: '0' }, cwd: os.tmpdir() });
  assert.strictEqual(off.architect.enabled, false);
  const offWord = config.resolve({ env: { XEND_ARCHITECT: 'off' }, cwd: os.tmpdir() });
  assert.strictEqual(offWord.architect.enabled, false);
  const on = config.resolve({ env: { XEND_ARCHITECT: '1', XEND_PROFILE: 'lite' }, cwd: os.tmpdir() });
  assert.strictEqual(on.architect.enabled, true);
});

test('config: XEND_VERIFY=0 disables the verifier without touching enabled', () => {
  const cfg = config.resolve({ env: { XEND_VERIFY: '0' }, cwd: os.tmpdir() });
  assert.strictEqual(cfg.architect.verify, false);
  assert.strictEqual(cfg.architect.enabled, true); // balanced default untouched
});

test('config: a non-object architect override (e.g. `false`) normalizes to disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-arch-cfg-'));
  fs.writeFileSync(path.join(dir, '.xend.json'), JSON.stringify({ architect: false }));
  const cfg = config.resolve({ env: {}, cwd: dir });
  assert.strictEqual(cfg.architect.enabled, false);
  assert.strictEqual(cfg.architect.minFiles, 4); // rest of the shape survives
});

// --- context: the architect paragraph ------------------------------------------

test('context.build: architect paragraph only when enabled, includes the cliPath', () => {
  const cfg = config.resolve({ env: {}, cwd: os.tmpdir() }); // balanced: architect on
  const on = context.build(cfg, { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(on.includes('Architect mode:'));
  assert.ok(on.includes('/abs/path/to/xend-cli.js'));
  assert.ok(on.includes(', architect)'));

  const off = context.build(Object.assign({}, cfg, { architect: { enabled: false } }), { cliPath: '/abs/path/to/xend-cli.js' });
  assert.ok(!off.includes('Architect mode:'));
  assert.ok(!off.includes(', architect)'));
});
