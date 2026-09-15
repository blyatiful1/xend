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
