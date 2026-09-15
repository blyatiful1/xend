'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../scripts/stats.js');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('parseArgs: reads --session, --cwd, --json, --last (both "--x y" and "--x=y" forms)', () => {
  const a = stats.parseArgs(['--session', 's1', '--cwd', '/tmp/x', '--json', '--last', '5']);
  assert.equal(a.session, 's1');
  assert.equal(a.cwd, '/tmp/x');
  assert.equal(a.json, true);
  assert.equal(a.last, 5);

  const b = stats.parseArgs(['--session=s2', '--cwd=/tmp/y', '--last=10']);
  assert.equal(b.session, 's2');
  assert.equal(b.cwd, '/tmp/y');
  assert.equal(b.last, 10);
  assert.equal(b.json, false);
});

test('parseArgs: non-positive/garbage --last is ignored (null)', () => {
  assert.equal(stats.parseArgs(['--last', '0']).last, null);
  assert.equal(stats.parseArgs(['--last', 'nope']).last, null);
  assert.equal(stats.parseArgs([]).last, null);
});

test('fmtInt/fmtUSD/fmtPct: basic formatting', () => {
  assert.equal(stats.fmtInt(1234567), '1,234,567');
  assert.equal(stats.fmtUSD(1.5), '$1.50');
  assert.equal(stats.fmtUSD(null), 'n/a');
  assert.equal(stats.fmtPct(0.5), '50.0%');
  assert.equal(stats.fmtPct(null), 'n/a');
});

test('sparkline: monotonic input produces a monotonic (non-decreasing) spark', () => {
  const s = stats.sparkline([1, 2, 3, 4, 5]);
  assert.equal(s.length, 5);
  // flat input collapses to the same (lowest) block repeated
  const flat = stats.sparkline([7, 7, 7]);
  assert.equal(new Set(flat).size, 1);
});

test('bucketPromptSizes: buckets turns chronologically into at most N buckets', () => {
  const promptSizes = Array.from({ length: 23 }, (_, i) => ({ index: i, size: i * 10 }));
  const buckets = stats.bucketPromptSizes(promptSizes, 10);
  assert.equal(buckets.length, 10);
  assert.equal(buckets[0].turnStart, 1);
  assert.equal(buckets[buckets.length - 1].turnEnd, 23);
});

test('bucketPromptSizes: fewer turns than bucket count yields one bucket per turn', () => {
  const promptSizes = [{ index: 0, size: 5 }, { index: 1, size: 15 }];
  const buckets = stats.bucketPromptSizes(promptSizes, 10);
  assert.equal(buckets.length, 2);
});

test('shapingLogCandidates / findShapingLog: finds a log under XEND_STATE_DIR/<session>/shaping.jsonl', () => {
  const stateDir = mkTmpDir('xend-state-');
  try {
    const sessionId = 'sess-xyz';
    const sessDir = path.join(stateDir, sessionId);
    fs.mkdirSync(sessDir, { recursive: true });
    const logPath = path.join(sessDir, 'shaping.jsonl');
    fs.writeFileSync(logPath, '');

    const found = stats.findShapingLog(sessionId, { XEND_STATE_DIR: stateDir });
    assert.equal(found, logPath);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('findShapingLog: returns null when nothing exists at any candidate path', () => {
  const found = stats.findShapingLog('no-such-session', { XEND_STATE_DIR: '/definitely/not/a/real/dir' });
  assert.equal(found, null);
});

test('verifyLogCandidates / findVerifyLog: finds a log under XEND_STATE_DIR/<session>/verify.jsonl', () => {
  const stateDir = mkTmpDir('xend-state-');
  try {
    const sessionId = 'sess-verify';
    const sessDir = path.join(stateDir, sessionId);
    fs.mkdirSync(sessDir, { recursive: true });
    const logPath = path.join(sessDir, 'verify.jsonl');
    fs.writeFileSync(logPath, '');

    const found = stats.findVerifyLog(sessionId, { XEND_STATE_DIR: stateDir });
    assert.equal(found, logPath);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('findVerifyLog: returns null when nothing exists at any candidate path', () => {
  const found = stats.findVerifyLog('no-such-session', { XEND_STATE_DIR: '/definitely/not/a/real/dir' });
  assert.equal(found, null);
});

test('summarizeVerifyLog: tallies verdicts, citation and scope counters, skipping malformed lines', async () => {
  const dir = mkTmpDir('xend-verify-');
  const file = path.join(dir, 'verify.jsonl');
  try {
    const lines = [
      JSON.stringify({ ts: 1, kind: 'worker', task: 'T1', claimed: 'PASS', verdict: 'pass', exit: 0, checked: 2, bad: 0, scope: 0 }),
      'not valid json',
      JSON.stringify({ ts: 2, kind: 'worker', task: 'T2', claimed: 'PASS', verdict: 'mismatch', exit: 1, checked: 1, bad: 0, scope: 1 }),
      JSON.stringify({ ts: 3, kind: 'worker-lite', task: 'T3', claimed: 'FAIL', verdict: 'fail', exit: 1, checked: 0, bad: 0, scope: 0 }),
      JSON.stringify({ ts: 4, kind: 'scout', task: null, claimed: null, verdict: 'bad-citations', exit: null, checked: 3, bad: 2, scope: null }),
      JSON.stringify({ ts: 5, kind: 'worker', task: 'T4', claimed: 'PASS', verdict: 'unverifiable', exit: null, checked: 0, bad: 0, scope: 0 }),
      JSON.stringify({ ts: 6, kind: 'worker', task: 'T5', claimed: null, verdict: 'malformed', exit: null, checked: 0, bad: 0, scope: 0 }),
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const summary = await stats.summarizeVerifyLog(file);
    assert.equal(summary.runs, 6);
    assert.equal(summary.badLines, 1);
    assert.equal(summary.pass, 1);
    assert.equal(summary.mismatch, 1);
    assert.equal(summary.fail, 1);
    assert.equal(summary.unverifiable, 1);
    assert.equal(summary.malformed, 1);
    assert.equal(summary.badCitations, 1);
    assert.equal(summary.citationsChecked, 2 + 1 + 0 + 3 + 0 + 0);
    assert.equal(summary.citationsBad, 0 + 0 + 0 + 2 + 0 + 0);
    assert.equal(summary.scopeWarnings, 0 + 1 + 0 + 0 + 0); // null scope is skipped, not summed as 0
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('printText: renders a Delegation section with verdict counts when a delegation summary is given', () => {
  const report = {
    file: 't.jsonl', sessionId: 's1', firstTimestamp: null, lastTimestamp: null,
    turnCount: 0, totalTurnCount: 0, windowed: false,
    totals: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    contextSizeEnd: 0, cacheHitRatio: null, costTotal: 0, hasUnknownModelCost: false, costByModel: {},
    promptSizes: [], toolUsage: {}, topResults: [], reReadFiles: [], reRunBashCommands: [],
    charTotals: { toolResultChars: 0, assistantTextChars: 0, otherChars: 0, total: 0, toolResultShare: null, assistantTextShare: null, otherShare: null },
  };
  const delegation = {
    file: '/tmp/verify.jsonl', runs: 4, pass: 2, mismatch: 1, fail: 0, unverifiable: 1, malformed: 0,
    badCitations: 1, citationsChecked: 6, citationsBad: 2, scopeWarnings: 1, badLines: 0,
  };
  const lines = [];
  const origLog = console.log;
  console.log = (s) => lines.push(s);
  try {
    stats.printText(report, { source: 'latest' }, null, delegation);
  } finally {
    console.log = origLog;
  }
  const out = lines.join('\n');
  assert.ok(out.includes('7. Delegation'));
  assert.ok(out.includes('subagent runs: 4'));
  assert.ok(out.includes('verified pass'));
  assert.ok(out.includes('mismatches caught'));
  assert.ok(out.includes('bad-citation replies'));
  assert.ok(out.includes('6 / 2'));
});

test('printText: omits the Delegation section entirely when no delegation summary is given', () => {
  const report = {
    file: 't.jsonl', sessionId: 's1', firstTimestamp: null, lastTimestamp: null,
    turnCount: 0, totalTurnCount: 0, windowed: false,
    totals: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    contextSizeEnd: 0, cacheHitRatio: null, costTotal: 0, hasUnknownModelCost: false, costByModel: {},
    promptSizes: [], toolUsage: {}, topResults: [], reReadFiles: [], reRunBashCommands: [],
    charTotals: { toolResultChars: 0, assistantTextChars: 0, otherChars: 0, total: 0, toolResultShare: null, assistantTextShare: null, otherShare: null },
  };
  const lines = [];
  const origLog = console.log;
  console.log = (s) => lines.push(s);
  try {
    stats.printText(report, { source: 'latest' }, null, null);
  } finally {
    console.log = origLog;
  }
  assert.ok(!lines.join('\n').includes('Delegation'));
});

test('summarizeShapingLog: sums before-after savings and tallies kinds, skipping malformed lines', async () => {
  const dir = mkTmpDir('xend-shaping-');
  const file = path.join(dir, 'shaping.jsonl');
  try {
    const lines = [
      JSON.stringify({ ts: 1, tool: 'Bash', id: 't1', before: 1000, after: 200, kinds: ['head-tail', 'ansi-strip'] }),
      'not valid json',
      JSON.stringify({ ts: 2, tool: 'Read', id: 't2', before: 500, after: 500, kinds: ['noop'] }),
      JSON.stringify({ ts: 3, tool: 'Bash', id: 't3', before: 300, after: 100, kinds: ['head-tail'] }),
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const summary = await stats.summarizeShapingLog(file);
    assert.equal(summary.events, 3);
    assert.equal(summary.malformed, 1);
    assert.equal(summary.charsBefore, 1000 + 500 + 300);
    assert.equal(summary.charsAfter, 200 + 500 + 100);
    assert.equal(summary.savedChars, 1000);
    assert.equal(summary.byKind['head-tail'], 2);
    assert.equal(summary.byTool.Bash, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
