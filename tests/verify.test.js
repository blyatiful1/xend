'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verify = require('../scripts/lib/verify.js');

const REPO_ROOT = path.join(__dirname, '..');
const SUBAGENT_STOP = path.join(REPO_ROOT, 'scripts', 'subagent-stop.js');
const AGENT_LAUNCH = path.join(REPO_ROOT, 'scripts', 'agent-launch.js');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFileDeep(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJsonl(file, records) {
  writeFileDeep(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ============================================================================
// agentKind
// ============================================================================

test('agentKind: strips the xend: namespace and maps to the role', () => {
  assert.equal(verify.agentKind('xend:xend-scout'), 'scout');
  assert.equal(verify.agentKind('xend:xend-reader'), 'reader');
  assert.equal(verify.agentKind('xend:xend-reviewer'), 'reviewer');
  assert.equal(verify.agentKind('xend:xend-worker'), 'worker');
  assert.equal(verify.agentKind('xend:xend-worker-lite'), 'worker-lite');
});

test('agentKind: strips any "<plugin>:" prefix, not just xend:', () => {
  assert.equal(verify.agentKind('someplugin:xend-scout'), 'scout');
});

test('agentKind: works with no namespace prefix at all', () => {
  assert.equal(verify.agentKind('xend-worker'), 'worker');
});

test('agentKind: unknown agent names and empty input return null', () => {
  assert.equal(verify.agentKind('xend:some-other-agent'), null);
  assert.equal(verify.agentKind(''), null);
  assert.equal(verify.agentKind(null), null);
  assert.equal(verify.agentKind(undefined), null);
});

// ============================================================================
// extractCitations
// ============================================================================

test('extractCitations: extracts path:LINE and path:START-END tokens', () => {
  const text = 'See scripts/lib/x.js:42 and ./a/b.py:10-20 for details, also /abs/path.ext:5.';
  const cs = verify.extractCitations(text);
  assert.equal(cs.length, 3);
  assert.deepEqual(cs[0], { path: 'scripts/lib/x.js', start: 42, end: undefined, raw: 'scripts/lib/x.js:42' });
  assert.deepEqual(cs[1], { path: './a/b.py', start: 10, end: 20, raw: './a/b.py:10-20' });
  assert.deepEqual(cs[2], { path: '/abs/path.ext', start: 5, end: undefined, raw: '/abs/path.ext:5' });
});

test('extractCitations: matches the scout reply shape (path:START-END  why)', () => {
  const cs = verify.extractCitations('scripts/lib/verify.js:10-25  implements the citation check (why)');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].path, 'scripts/lib/verify.js');
  assert.equal(cs[0].start, 10);
  assert.equal(cs[0].end, 25);
});

test('extractCitations: requires a path separator or a file extension', () => {
  // "Section 7:15" and "12:30" have neither -- not citations.
  const cs = verify.extractCitations('See Section 7:15 and the meeting at 12:30 today.');
  assert.equal(cs.length, 0);
});

test('extractCitations: ignores http:// and https:// URLs', () => {
  const cs = verify.extractCitations('Docs at https://example.com/guide/setup.html:12 explain it; see http://x.io/a.py:3 too.');
  assert.equal(cs.length, 0);
});

test('extractCitations: ignores a Windows drive-letter prefix', () => {
  const cs = verify.extractCitations('Open C:\\Users\\me\\project\\notes.txt for background.');
  for (const c of cs) assert.notEqual(c.path.length, 1);
});

// ============================================================================
// extractReaderEvidence
// ============================================================================

test('extractReaderEvidence: parses "- <file>:<line>: <verbatim line>" bullets', () => {
  const text = [
    'Answer: the handler validates the request first.',
    'Evidence:',
    '- src/a.py:10: def handler(req):',
    '- src/b.py:22: return None',
    'Counts: 2 references',
    'Gaps: none',
  ].join('\n');
  const ev = verify.extractReaderEvidence(text);
  assert.deepEqual(ev, [
    { path: 'src/a.py', line: 10, text: 'def handler(req):' },
    { path: 'src/b.py', line: 22, text: 'return None' },
  ]);
});

test('extractReaderEvidence: returns [] when there are no bullets', () => {
  assert.deepEqual(verify.extractReaderEvidence('Answer: nothing found.\nGaps: everything'), []);
  assert.deepEqual(verify.extractReaderEvidence(''), []);
});

// ============================================================================
// checkCitations
// ============================================================================

test('checkCitations: existing path in range is fine; missing path and out-of-range line are bad', () => {
  const dir = mkTmpDir('xend-verify-cite-');
  try {
    writeFileDeep(path.join(dir, 'sub', 'file.txt'), 'line one\nline two\nline three\n');
    const citations = [
      { path: 'sub/file.txt', start: 2, end: undefined, raw: 'sub/file.txt:2' },
      { path: 'sub/file.txt', start: 10, end: undefined, raw: 'sub/file.txt:10' },
      { path: 'missing.txt', start: 1, end: undefined, raw: 'missing.txt:1' },
    ];
    const r = verify.checkCitations(citations, dir, []);
    assert.equal(r.checked, 3);
    assert.equal(r.bad.length, 2);
    const raws = r.bad.map((b) => b.raw);
    assert.ok(raws.includes('sub/file.txt:10'));
    assert.ok(raws.includes('missing.txt:1'));
    const outOfRange = r.bad.find((b) => b.raw === 'sub/file.txt:10');
    assert.match(outOfRange.reason, /beyond/);
    const notFound = r.bad.find((b) => b.raw === 'missing.txt:1');
    assert.match(notFound.reason, /not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCitations: an absolute citation path is checked directly, not joined to cwd', () => {
  const dir = mkTmpDir('xend-verify-cite-abs-');
  try {
    const abs = path.join(dir, 'abs.txt');
    fs.writeFileSync(abs, 'only line\n');
    const r = verify.checkCitations([{ path: abs, start: 1, end: undefined, raw: abs + ':1' }], '/somewhere/else', []);
    assert.equal(r.bad.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkCitations: reader evidence text (>=12 chars) must be a substring of the actual line', () => {
  const dir = mkTmpDir('xend-verify-evidence-');
  try {
    writeFileDeep(path.join(dir, 'src', 'a.py'), 'def handler(req):\n    return None\n');
    const evidence = [
      { path: 'src/a.py', line: 1, text: 'def handler(req):' },       // matches verbatim
      { path: 'src/a.py', line: 1, text: '   def   handler(req):  ' }, // matches after whitespace-normalization
      { path: 'src/a.py', line: 2, text: 'this text is not on that line' }, // >=12 chars, wrong
      { path: 'src/a.py', line: 2, text: 'short' },                    // <12 chars: never checked
    ];
    const r = verify.checkCitations([], dir, evidence);
    assert.equal(r.checked, 4);
    assert.equal(r.bad.length, 1);
    assert.match(r.bad[0].reason, /evidence text not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// parseWorkerReply
// ============================================================================

test('parseWorkerReply: parses a well-formed reply', () => {
  const text = [
    'Result: PASS',
    'Changed:',
    '- src/a.py: added function foo',
    '- src/b.py: updated import',
    'Verification: node --test tests/x.test.js -> 3 passed',
    'Notes: none',
  ].join('\n');
  const r = verify.parseWorkerReply(text);
  assert.equal(r.result, 'PASS');
  assert.equal(r.command, 'node --test tests/x.test.js');
  assert.equal(r.summary, '3 passed');
  assert.deepEqual(r.changed, ['src/a.py', 'src/b.py']);
});

test('parseWorkerReply: missing Result line yields result: null', () => {
  const text = ['Changed:', '- a.py: x', 'Verification: npm test -> ok', 'Notes: none'].join('\n');
  const r = verify.parseWorkerReply(text);
  assert.equal(r.result, null);
});

test('parseWorkerReply: Verification line without " -> " yields command: null', () => {
  const text = [
    'Result: BLOCKED',
    'Changed:',
    '(none)',
    'Verification: could not determine what to run',
    'Notes: the spec did not name a test file',
  ].join('\n');
  const r = verify.parseWorkerReply(text);
  assert.equal(r.result, 'BLOCKED');
  assert.equal(r.command, null);
  assert.equal(r.summary, 'could not determine what to run');
});

test('parseWorkerReply: no Verification line at all yields command and summary null', () => {
  const r = verify.parseWorkerReply('Result: FAIL\nChanged:\n- a.py: x\nNotes: broke it');
  assert.equal(r.command, null);
  assert.equal(r.summary, null);
});

// ============================================================================
// commandAllowed
// ============================================================================

test('commandAllowed: accepts allowlisted test/lint commands', () => {
  for (const cmd of [
    'python3 -m pytest -q tests/test_a.py',
    'npm test',
    'node --test tests/x.test.js',
    'bash bench/selftest.sh',
    'go test ./...',
    'pytest',
    'pnpm test',
    'yarn run test',
    'cargo test',
    'cargo check',
    'make test',
    './scripts/run-test.sh',
    'ruff',
    'eslint',
    'tsc',
    'mypy',
  ]) {
    assert.equal(verify.commandAllowed(cmd), true, cmd);
  }
});

test('commandAllowed: rejects commands with shell metacharacters or off-allowlist commands', () => {
  for (const cmd of [
    'pytest; rm -rf /',
    'npm test && echo',
    'cat x',
    'python3 setup.py',
    'pytest | tail',
    'npm test || true',
    'pytest `rm -rf /`',
    'pytest $(rm -rf /)',
    'npm test > out.txt',
    'npm test < in.txt',
    '',
    '   ',
  ]) {
    assert.equal(verify.commandAllowed(cmd), false, cmd);
  }
});

test('commandAllowed: the allowlist\'s own "|" is regex alternation only, not a shell pipe exemption', () => {
  // A command that only matches because of alternation but also pipes output must still be rejected.
  assert.equal(verify.commandAllowed('pytest | tail -n 5'), false);
});

// ============================================================================
// runVerify
// ============================================================================

test('runVerify: captures exit code and stdout for a real subprocess', () => {
  const ok = verify.runVerify('node -e "console.log(1+1)"', process.cwd(), 5000);
  assert.equal(ok.exit, 0);
  assert.equal(ok.stdout.trim(), '2');
  assert.equal(typeof ok.ms, 'number');
  assert.equal(ok.timedOut, false);

  const failing = verify.runVerify('node -e "process.exit(3)"', process.cwd(), 5000);
  assert.equal(failing.exit, 3);
});

// ============================================================================
// verdictFor
// ============================================================================

test('verdictFor: worker verdict mapping', () => {
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'PASS', allowed: true, exit: 0, bad: [] }), 'pass');
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'PASS', allowed: true, exit: 1, bad: [] }), 'mismatch');
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'PASS', allowed: false, exit: null, bad: [] }), 'unverifiable');
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'FAIL', allowed: true, exit: 1, bad: [] }), 'fail');
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'BLOCKED', allowed: false, exit: null, bad: [] }), 'fail');
  assert.equal(verify.verdictFor({ kind: 'worker-lite', claimed: 'PASS', allowed: true, exit: 0, bad: [] }), 'pass');
});

test('verdictFor: malformed and bad-citations override the re-run result', () => {
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'PASS', allowed: true, exit: 0, bad: [], malformed: true }), 'malformed');
  assert.equal(verify.verdictFor({ kind: 'worker', claimed: 'PASS', allowed: true, exit: 0, bad: [{ raw: 'x.py:9', reason: 'not found' }] }), 'bad-citations');
});

test('verdictFor: non-worker kinds (scout/reader/reviewer) verdict from citations only', () => {
  assert.equal(verify.verdictFor({ kind: 'scout', bad: [] }), 'pass');
  assert.equal(verify.verdictFor({ kind: 'reader', bad: [{ raw: 'a.py:1', reason: 'not found' }] }), 'bad-citations');
  assert.equal(verify.verdictFor({ kind: 'reviewer', bad: [] }), 'pass');
});

// ============================================================================
// blockReason
// ============================================================================

test('blockReason: mismatch includes the command, exit code, and last 15 lines', () => {
  const output = Array.from({ length: 20 }, (_, i) => 'line' + (i + 1)).join('\n');
  const reason = verify.blockReason('mismatch', { command: 'npm test', exit: 1, output });
  const expectedLast15 = Array.from({ length: 15 }, (_, i) => 'line' + (i + 6)).join('\n');
  assert.equal(
    reason,
    'xend re-ran "npm test": exit 1. Last lines:\n' + expectedLast15 +
      '\nYour Result claimed PASS. Fix it now if you can within scope, then restate your full reply truthfully in the fixed format; otherwise restate with Result: FAIL and say what fails.'
  );
});

test('blockReason: malformed uses the fixed-format restatement message', () => {
  assert.equal(
    verify.blockReason('malformed', {}),
    'Your reply must use the fixed format: Result / Changed / Verification (<command> -> <summary>) / Notes. Restate it.'
  );
});

test('blockReason: bad-citations lists the raw bad tokens', () => {
  const reason = verify.blockReason('bad-citations', { bad: [{ raw: 'x.py:5' }, { raw: 'y.py:2-9' }] });
  assert.equal(
    reason,
    'These citations do not exist or are out of range: x.py:5, y.py:2-9. Cite only ranges you actually read; correct or remove them and restate.'
  );
});

test('blockReason: returns null for verdicts that are never blocked', () => {
  assert.equal(verify.blockReason('pass', {}), null);
  assert.equal(verify.blockReason('fail', {}), null);
  assert.equal(verify.blockReason('unverifiable', {}), null);
});

// ============================================================================
// editedPathsFromTranscript / firstUserPrompt / lastAssistantText / taskIdFromPrompt
// ============================================================================

test('editedPathsFromTranscript: collects Edit/Write/MultiEdit/NotebookEdit paths, deduped, in order', () => {
  const f = path.join(mkTmpDir('xend-verify-tx-'), 't.jsonl');
  writeJsonl(f, [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/a.py' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.py', old_string: 'x', new_string: 'y' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/p/b.py' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.py', old_string: 'y', new_string: 'z' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/p/nb.ipynb' } }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
  ]);
  assert.deepEqual(verify.editedPathsFromTranscript(f), ['/p/a.py', '/p/b.py', '/p/nb.ipynb']);
});

test('editedPathsFromTranscript: missing file returns []', () => {
  assert.deepEqual(verify.editedPathsFromTranscript('/no/such/transcript.jsonl'), []);
});

test('firstUserPrompt / taskIdFromPrompt: string content and array content', () => {
  const f1 = path.join(mkTmpDir('xend-verify-tx-'), 't.jsonl');
  writeJsonl(f1, [
    { type: 'user', message: { role: 'user', content: '[xend task T7] Do the thing.\nSpec: fix it.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ]);
  const p1 = verify.firstUserPrompt(f1);
  assert.match(p1, /^\[xend task T7\]/);
  assert.equal(verify.taskIdFromPrompt(p1), 'T7');

  const f2 = path.join(mkTmpDir('xend-verify-tx-'), 't.jsonl');
  writeJsonl(f2, [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[xend task T8] hi' }] } },
  ]);
  assert.equal(verify.firstUserPrompt(f2), '[xend task T8] hi');
  assert.equal(verify.taskIdFromPrompt(verify.firstUserPrompt(f2)), 'T8');

  assert.equal(verify.taskIdFromPrompt('no task tag here'), null);
  assert.equal(verify.firstUserPrompt('/no/such/file.jsonl'), '');
});

test('lastAssistantText: returns the last assistant text block, not the first', () => {
  const f = path.join(mkTmpDir('xend-verify-tx-'), 't.jsonl');
  writeJsonl(f, [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first reply' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second reply, final' }] } },
  ]);
  assert.equal(verify.lastAssistantText(f), 'second reply, final');
});

// ============================================================================
// scopeWarnings
// ============================================================================

test('scopeWarnings: flags edited paths outside task.files ∪ task.testFiles', () => {
  const task = { files: ['src/a.py'], testFiles: ['tests/test_a.py'] };
  const cwd = path.join(os.tmpdir(), 'xend-verify-scope-cwd');
  const edited = [
    path.join(cwd, 'src', 'a.py'),   // in scope (absolute)
    path.join(cwd, 'tests', 'test_a.py'), // in scope (absolute)
    path.join(cwd, 'src', 'other.py'), // out of scope
    'src/a.py', // in scope (already relative)
  ];
  const warnings = verify.scopeWarnings(edited, task, cwd);
  assert.deepEqual(warnings, ['src/other.py']);
});

test('scopeWarnings: no task means no warnings', () => {
  assert.deepEqual(verify.scopeWarnings(['/a/b.py'], null, '/a'), []);
});

// ============================================================================
// applyToPlan
// ============================================================================

function freshPlan() {
  return {
    goal: 'g', verify: 'npm test',
    tasks: [
      { id: 'T1', title: 't', tier: 'worker', files: ['a.py'], testFiles: [], deps: [],
        spec: 's', verify: 'npm test', status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ],
  };
}

test('applyToPlan: pass -> done, verified true, attempts unchanged', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'pass' });
  const t = plan.tasks[0];
  assert.equal(t.status, 'done');
  assert.equal(t.verified, true);
  assert.equal(t.attempts, 0);
});

test('applyToPlan: unverifiable with claimed PASS -> done, verified false', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'unverifiable', claimed: 'PASS' });
  const t = plan.tasks[0];
  assert.equal(t.status, 'done');
  assert.equal(t.verified, false);
});

test('applyToPlan: unverifiable without a claimed PASS leaves status untouched', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'unverifiable', claimed: null });
  const t = plan.tasks[0];
  assert.equal(t.status, 'todo');
  assert.equal(t.attempts, 0);
});

test('applyToPlan: fail -> failed, attempts += 1', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'fail', claimed: 'FAIL' });
  const t = plan.tasks[0];
  assert.equal(t.status, 'failed');
  assert.equal(t.attempts, 1);
});

test('applyToPlan: mismatch on the first stop leaves status untouched; the second stop finalizes it (attempts += 1 exactly once)', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'mismatch', claimed: 'PASS', stopHookActive: false });
  let t = plan.tasks[0];
  assert.equal(t.status, 'todo');
  assert.equal(t.attempts, 0);

  verify.applyToPlan(plan, 'T1', { verdict: 'mismatch', claimed: 'PASS', stopHookActive: true });
  t = plan.tasks[0];
  assert.equal(t.status, 'failed');
  assert.equal(t.attempts, 1);
});

test('applyToPlan: mismatch finalizes immediately when blocking is disabled', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'mismatch', claimed: 'PASS', stopHookActive: false, blockingDisabled: true });
  const t = plan.tasks[0];
  assert.equal(t.status, 'failed');
  assert.equal(t.attempts, 1);
});

test('applyToPlan: malformed follows the same first-stop/second-stop pattern as mismatch', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'malformed', stopHookActive: false });
  assert.equal(plan.tasks[0].status, 'todo');
  verify.applyToPlan(plan, 'T1', { verdict: 'malformed', stopHookActive: true });
  assert.equal(plan.tasks[0].status, 'failed');
  assert.equal(plan.tasks[0].attempts, 1);
});

test('applyToPlan: sets lastVerdict and merges scope warnings without dropping earlier ones', () => {
  const plan = freshPlan();
  verify.applyToPlan(plan, 'T1', { verdict: 'pass', note: 'pass', scope: ['out1.py'] });
  verify.applyToPlan(plan, 'T1', { verdict: 'pass', note: 'pass', scope: ['out2.py'] });
  const t = plan.tasks[0];
  assert.equal(t.lastVerdict, 'pass');
  assert.deepEqual(t.scopeWarnings.sort(), ['out1.py', 'out2.py']);
});

test('applyToPlan: unknown task id leaves the plan unchanged', () => {
  const plan = freshPlan();
  const before = JSON.stringify(plan);
  verify.applyToPlan(plan, 'NOPE', { verdict: 'pass' });
  assert.equal(JSON.stringify(plan), before);
});

// ============================================================================
// recordLaunch / lookupLaunch
// ============================================================================

test('recordLaunch / lookupLaunch: round-trips an entry', () => {
  const dir = mkTmpDir('xend-verify-agents-');
  try {
    verify.recordLaunch(dir, { agentId: 'a1', taskId: 'T1', subagentType: 'xend-worker', prompt: 'hello', toolUseId: 'tu1' });
    const got = verify.lookupLaunch(dir, 'a1');
    assert.equal(got.taskId, 'T1');
    assert.equal(got.subagentType, 'xend-worker');
    assert.equal(got.prompt, 'hello');
    assert.equal(got.toolUseId, 'tu1');
    assert.equal(verify.lookupLaunch(dir, 'no-such-agent'), null);
    assert.equal(verify.lookupLaunch(dir, null), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordLaunch: caps the registry at the 200 most recent entries', () => {
  const dir = mkTmpDir('xend-verify-agents-cap-');
  try {
    const reg = {};
    for (let i = 1; i <= 205; i++) reg['a' + i] = { taskId: null, subagentType: null, prompt: '', toolUseId: null, ts: i };
    fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(reg));

    verify.recordLaunch(dir, { agentId: 'a206', taskId: 'T-new', subagentType: 'xend-worker', prompt: '', toolUseId: null });

    const after = JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8'));
    const keys = Object.keys(after);
    assert.equal(keys.length, 200);
    // the 6 oldest (a1..a6) must have been pruned to make room
    for (let i = 1; i <= 6; i++) assert.equal('a' + i in after, false);
    assert.ok('a7' in after);
    assert.ok('a205' in after);
    assert.ok('a206' in after);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// end-to-end: node scripts/subagent-stop.js (and scripts/agent-launch.js)
// ============================================================================

function runHook(scriptPath, input, env) {
  // Strip NODE_TEST_CONTEXT: this test suite itself runs under `node --test`, and that env var
  // would otherwise leak into a fixture's own `node --test ...` verify command (run as a
  // grandchild by scripts/lib/verify.js's runVerify), making it behave as a v8-serialized child
  // reporter instead of a normal process. Production hook invocations never run inside a test
  // runner, so this only matters for the fixtures here.
  const childEnv = Object.assign({}, process.env, env);
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: childEnv,
  });
}

function setupProject() {
  const cwd = mkTmpDir('xend-verify-e2e-cwd-');
  const stateBase = mkTmpDir('xend-verify-e2e-state-');
  writeFileDeep(path.join(cwd, 'tests', 'pass.test.js'), "const test = require('node:test');\ntest('ok', () => {});\n");
  writeFileDeep(path.join(cwd, 'tests', 'fail.test.js'), "const test = require('node:test');\ntest('bad', () => { throw new Error('boom'); });\n");
  return { cwd, stateBase };
}

function stateDirFor(stateBase, sessionId) {
  return path.join(stateBase, sessionId);
}

function writeSessionSetup(dir, planTasks) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ architect: { verify: true, blockOnMismatch: true, verifyTimeoutMs: 10000 } }));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ goal: 'g', verify: 'npm test', tasks: planTasks }));
}

function passReplyText(command) {
  return [
    'Result: PASS',
    'Changed:',
    '- src/thing.py: fixed bug',
    'Verification: ' + command + ' -> ok',
    'Notes: none',
  ].join('\n');
}

test('e2e (a): claimed PASS with a passing verify command -> no stdout, verify.jsonl verdict pass, plan task done+verified', () => {
  const { cwd, stateBase } = setupProject();
  try {
    const sessionId = 'sess-a';
    const dir = stateDirFor(stateBase, sessionId);
    writeSessionSetup(dir, [
      { id: 'T1', title: 't', tier: 'worker', files: ['src/thing.py'], testFiles: [], deps: [],
        spec: 's', verify: 'node --test tests/pass.test.js', status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ]);
    const transcript = path.join(dir, 'agent-transcript.jsonl');
    writeJsonl(transcript, [{ type: 'user', message: { role: 'user', content: '[xend task T1] Fix the thing.' } }]);

    const input = {
      session_id: sessionId, cwd, agent_id: 'agent-a', agent_type: 'xend:xend-worker',
      agent_transcript_path: transcript,
      last_assistant_message: passReplyText('echo unused'), // the plan task's own verify command must win over this
      stop_hook_active: false,
    };
    const res = runHook(SUBAGENT_STOP, input, { XEND_STATE_DIR: stateBase });
    assert.equal(res.status, 0);
    assert.equal((res.stdout || '').trim(), '');

    const verifyLog = fs.readFileSync(path.join(dir, 'verify.jsonl'), 'utf8').trim().split('\n');
    const rec = JSON.parse(verifyLog[verifyLog.length - 1]);
    assert.equal(rec.verdict, 'pass');
    assert.equal(rec.command, 'node --test tests/pass.test.js');
    assert.equal(rec.blocked, false);

    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    assert.equal(plan.tasks[0].status, 'done');
    assert.equal(plan.tasks[0].verified, true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});

test('e2e (b)+(c): claimed PASS with a failing command blocks once, then finalizes to failed/attempts:1 on the restated stop', () => {
  const { cwd, stateBase } = setupProject();
  try {
    const sessionId = 'sess-bc';
    const dir = stateDirFor(stateBase, sessionId);
    writeSessionSetup(dir, [
      { id: 'T2', title: 't', tier: 'worker', files: ['src/thing.py'], testFiles: [], deps: [],
        spec: 's', verify: 'node --test tests/fail.test.js', status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ]);
    const transcript = path.join(dir, 'agent-transcript.jsonl');
    writeJsonl(transcript, [{ type: 'user', message: { role: 'user', content: '[xend task T2] Fix the thing.' } }]);

    const baseInput = {
      session_id: sessionId, cwd, agent_id: 'agent-bc', agent_type: 'xend:xend-worker',
      agent_transcript_path: transcript,
      last_assistant_message: passReplyText('echo unused'),
    };

    // (b) first stop: blocked, plan untouched.
    const res1 = runHook(SUBAGENT_STOP, Object.assign({}, baseInput, { stop_hook_active: false }), { XEND_STATE_DIR: stateBase });
    assert.equal(res1.status, 0);
    const out1 = JSON.parse(res1.stdout);
    assert.equal(out1.decision, 'block');
    assert.match(out1.reason, /node --test tests\/fail\.test\.js/);

    let plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    assert.equal(plan.tasks[0].status, 'todo');
    assert.equal(plan.tasks[0].attempts, 0);

    // (c) same input, restated (stop_hook_active true): no block, plan finalized.
    const res2 = runHook(SUBAGENT_STOP, Object.assign({}, baseInput, { stop_hook_active: true }), { XEND_STATE_DIR: stateBase });
    assert.equal(res2.status, 0);
    assert.equal((res2.stdout || '').trim(), '');

    plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    assert.equal(plan.tasks[0].status, 'failed');
    assert.equal(plan.tasks[0].attempts, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});

test('e2e (d): a command containing ";" is never executed', () => {
  const { cwd, stateBase } = setupProject();
  const sentinel = path.join(cwd, 'SENTINEL_CREATED_IF_RUN');
  try {
    const sessionId = 'sess-d';
    const dir = stateDirFor(stateBase, sessionId);
    const maliciousCmd = 'node --test tests/pass.test.js; node -e "require(\'fs\').writeFileSync(\'SENTINEL_CREATED_IF_RUN\',\'1\')"';
    writeSessionSetup(dir, [
      { id: 'T3', title: 't', tier: 'worker', files: ['src/thing.py'], testFiles: [], deps: [],
        spec: 's', verify: maliciousCmd, status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ]);
    const transcript = path.join(dir, 'agent-transcript.jsonl');
    writeJsonl(transcript, [{ type: 'user', message: { role: 'user', content: '[xend task T3] Fix the thing.' } }]);

    const input = {
      session_id: sessionId, cwd, agent_id: 'agent-d', agent_type: 'xend:xend-worker',
      agent_transcript_path: transcript,
      last_assistant_message: passReplyText('echo unused'),
      stop_hook_active: false,
    };
    const res = runHook(SUBAGENT_STOP, input, { XEND_STATE_DIR: stateBase });
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(sentinel), false, 'the ";"-joined command must never have been executed');

    const verifyLog = fs.readFileSync(path.join(dir, 'verify.jsonl'), 'utf8').trim().split('\n');
    const rec = JSON.parse(verifyLog[verifyLog.length - 1]);
    assert.equal(rec.verdict, 'unverifiable');
    assert.equal(rec.claimed, 'PASS');
    assert.equal(rec.blocked, false); // unverifiable is never blocked
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});

test('e2e: scripts/agent-launch.js records the task id at Agent launch, then subagent-stop.js recovers it with no transcript file (--no-session-persistence)', () => {
  const { cwd, stateBase } = setupProject();
  try {
    const sessionId = 'sess-reg';
    const dir = stateDirFor(stateBase, sessionId);
    writeSessionSetup(dir, [
      { id: 'T9', title: 't', tier: 'worker', files: ['src/thing.py'], testFiles: [], deps: [],
        spec: 's', verify: 'node --test tests/pass.test.js', status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ]);

    // 1) Agent launch: PostToolUse(Agent), async_launched, no transcript exists yet (or ever).
    const launchInput = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      session_id: sessionId,
      cwd,
      tool_use_id: 'tu-1',
      tool_input: { prompt: '[xend task T9] Fix the thing.\nSpec: ...', subagent_type: 'xend:xend-worker' },
      tool_response: { status: 'async_launched', agentId: 'agent-reg-1' },
    };
    const launchRes = runHook(AGENT_LAUNCH, launchInput, { XEND_STATE_DIR: stateBase });
    assert.equal(launchRes.status, 0);
    assert.equal((launchRes.stdout || '').trim(), '');
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8'));
    assert.equal(registry['agent-reg-1'].taskId, 'T9');

    // 2) SubagentStop: no agent_transcript_path file on disk at all.
    const missingTranscript = path.join(dir, 'this-file-does-not-exist.jsonl');
    assert.equal(fs.existsSync(missingTranscript), false);
    const stopInput = {
      session_id: sessionId, cwd, agent_id: 'agent-reg-1', agent_type: 'xend:xend-worker',
      agent_transcript_path: missingTranscript,
      last_assistant_message: passReplyText('echo unused'),
      stop_hook_active: false,
    };
    const stopRes = runHook(SUBAGENT_STOP, stopInput, { XEND_STATE_DIR: stateBase });
    assert.equal(stopRes.status, 0);
    assert.equal((stopRes.stdout || '').trim(), '');

    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    assert.equal(plan.tasks[0].status, 'done');
    assert.equal(plan.tasks[0].verified, true);

    const verifyLog = fs.readFileSync(path.join(dir, 'verify.jsonl'), 'utf8').trim().split('\n');
    const rec = JSON.parse(verifyLog[verifyLog.length - 1]);
    assert.equal(rec.task, 'T9');
    assert.equal(rec.verdict, 'pass');
    assert.equal(rec.scope, null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});

test('e2e: an unrelated agent (not an xend agent, no [xend task] tag) is ignored entirely', () => {
  const { cwd, stateBase } = setupProject();
  try {
    const sessionId = 'sess-ignore';
    const dir = stateDirFor(stateBase, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ architect: { verify: true, blockOnMismatch: true } }));
    const transcript = path.join(dir, 'agent-transcript.jsonl');
    writeJsonl(transcript, [{ type: 'user', message: { role: 'user', content: 'just a normal task, no tag' } }]);

    const input = {
      session_id: sessionId, cwd, agent_id: 'agent-other', agent_type: 'someplugin:general-purpose',
      agent_transcript_path: transcript,
      last_assistant_message: 'Done.',
      stop_hook_active: false,
    };
    const res = runHook(SUBAGENT_STOP, input, { XEND_STATE_DIR: stateBase });
    assert.equal(res.status, 0);
    assert.equal((res.stdout || '').trim(), '');
    assert.equal(fs.existsSync(path.join(dir, 'verify.jsonl')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});

test('e2e: XEND_VERIFY=0 disables the verifier entirely', () => {
  const { cwd, stateBase } = setupProject();
  try {
    const sessionId = 'sess-off';
    const dir = stateDirFor(stateBase, sessionId);
    writeSessionSetup(dir, [
      { id: 'T5', title: 't', tier: 'worker', files: ['src/thing.py'], testFiles: [], deps: [],
        spec: 's', verify: 'node --test tests/pass.test.js', status: 'todo', attempts: 0, verified: false, lastVerdict: '', scopeWarnings: [] },
    ]);
    const transcript = path.join(dir, 'agent-transcript.jsonl');
    writeJsonl(transcript, [{ type: 'user', message: { role: 'user', content: '[xend task T5] Fix the thing.' } }]);
    const input = {
      session_id: sessionId, cwd, agent_id: 'agent-off', agent_type: 'xend:xend-worker',
      agent_transcript_path: transcript,
      last_assistant_message: passReplyText('echo unused'),
      stop_hook_active: false,
    };
    const res = runHook(SUBAGENT_STOP, input, { XEND_STATE_DIR: stateBase, XEND_VERIFY: '0' });
    assert.equal(res.status, 0);
    assert.equal((res.stdout || '').trim(), '');
    assert.equal(fs.existsSync(path.join(dir, 'verify.jsonl')), false);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
    assert.equal(plan.tasks[0].status, 'todo'); // untouched
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(stateBase, { recursive: true, force: true });
  }
});
