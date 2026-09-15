'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const t = require('../scripts/lib/transcript');
const pricing = require('../scripts/lib/pricing');

function writeFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-transcript-'));
  const file = path.join(dir, 'fixture.jsonl');
  const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  fs.writeFileSync(file, body);
  return { dir, file };
}

// A two-turn synthetic session:
//  - turn 1 (message id msg_1) is split across FOUR jsonl lines (thinking, tool_use x2,
//    text) that all repeat the SAME usage object, exactly like real Claude Code
//    transcripts. Aggregation must count this as one turn, not four.
//  - turn 2 (msg_2) re-reads the same file and re-runs the same bash command, to
//    exercise re-read detection.
//  - includes a malformed line and an unrecognized record `type` that must both be
//    skipped without throwing.
const USER_PROMPT = 'Now read it again and run ls again';
const USAGE_1 = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 50 };
const USAGE_2 = { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, output_tokens: 20 };

function buildFixtureLines() {
  return [
    { type: 'system', subtype: 'init', sessionId: 'sess-abc' },
    '{ this is not valid json',
    { type: 'assistant', sessionId: 'sess-abc', timestamp: '2026-01-01T00:00:00.000Z', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: USAGE_1, content: [{ type: 'thinking', thinking: 'abcde' }] } },
    { type: 'assistant', sessionId: 'sess-abc', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: USAGE_1, content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/f/a.js' } }] } },
    { type: 'user', sessionId: 'sess-abc', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'hello world' }] } },
    { type: 'assistant', sessionId: 'sess-abc', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: USAGE_1, content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'ls -la' } }] } },
    { type: 'user', sessionId: 'sess-abc', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'file1\nfile2' }] }] } },
    { type: 'assistant', sessionId: 'sess-abc', timestamp: '2026-01-01T00:00:02.000Z', message: { id: 'msg_1', model: 'claude-sonnet-5', usage: USAGE_1, content: [{ type: 'text', text: 'Done reading.' }] } },
    { type: 'user', sessionId: 'sess-abc', message: { content: USER_PROMPT } },
    { type: 'assistant', sessionId: 'sess-abc', message: { id: 'msg_2', model: 'claude-sonnet-5', usage: USAGE_2, content: [{ type: 'tool_use', id: 'tu_3', name: 'Read', input: { file_path: '/f/a.js' } }] } },
    { type: 'user', sessionId: 'sess-abc', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: 'hello world' }] } },
    { type: 'assistant', sessionId: 'sess-abc', message: { id: 'msg_2', model: 'claude-sonnet-5', usage: USAGE_2, content: [{ type: 'tool_use', id: 'tu_4', name: 'Bash', input: { command: 'ls -la' } }] } },
    { type: 'user', sessionId: 'sess-abc', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_4', content: 'file1\nfile2' }] } },
    { type: 'assistant', sessionId: 'sess-abc', timestamp: '2026-01-01T00:00:03.000Z', message: { id: 'msg_2', model: 'claude-sonnet-5', usage: USAGE_2, content: [{ type: 'text', text: 'Done again.' }] } },
  ];
}

test('summarizeTranscript: dedupes a multi-line assistant turn by message.id', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    assert.equal(data.turns.length, 2, 'four lines sharing msg_1 must collapse into one turn');
    assert.equal(data.turns[0].id, 'msg_1');
    assert.equal(data.turns[1].id, 'msg_2');
    assert.equal(data.malformedLines, 1);
    assert.equal(data.sessionId, 'sess-abc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('summarizeTranscript: sums usage once per turn, not once per content-block line', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    assert.equal(report.totals.input_tokens, USAGE_1.input_tokens + USAGE_2.input_tokens);
    assert.equal(report.totals.cache_creation_input_tokens, USAGE_1.cache_creation_input_tokens + USAGE_2.cache_creation_input_tokens);
    assert.equal(report.totals.cache_read_input_tokens, USAGE_1.cache_read_input_tokens + USAGE_2.cache_read_input_tokens);
    assert.equal(report.totals.output_tokens, USAGE_1.output_tokens + USAGE_2.output_tokens);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: contextSizeEnd is the max per-turn (input+cache_creation+cache_read)', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    const size1 = USAGE_1.input_tokens + USAGE_1.cache_creation_input_tokens + USAGE_1.cache_read_input_tokens;
    const size2 = USAGE_2.input_tokens + USAGE_2.cache_creation_input_tokens + USAGE_2.cache_read_input_tokens;
    assert.equal(report.contextSizeEnd, Math.max(size1, size2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: cache hit ratio = cache_read / (input + cache_creation + cache_read)', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    const denom = report.totals.input_tokens + report.totals.cache_creation_input_tokens + report.totals.cache_read_input_tokens;
    assert.ok(Math.abs(report.cacheHitRatio - report.totals.cache_read_input_tokens / denom) < 1e-9);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: cost by model matches pricing.costFor on the combined per-model usage', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    const entry = report.costByModel['claude-sonnet-5'];
    assert.ok(entry);
    assert.equal(entry.turns, 2);
    const expected = pricing.costFor('claude-sonnet-5', entry.tokens);
    assert.equal(entry.cost.totalCost, expected.totalCost);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: tool usage counts and result chars are attributed to the right tool', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    assert.equal(report.toolUsage.Read.count, 2);
    assert.equal(report.toolUsage.Bash.count, 2);
    // 'hello world' (11 chars) read twice; 'file1\nfile2' (11 chars) via string and via
    // a text-block array both twice -> contentToText must handle both shapes equally.
    assert.equal(report.toolUsage.Read.resultChars, 'hello world'.length * 2);
    assert.equal(report.toolUsage.Bash.resultChars, 'file1\nfile2'.length * 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: re-reads detects files read >1x and bash commands run >1x verbatim', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    assert.deepEqual(report.reReadFiles, [['/f/a.js', 2]]);
    assert.deepEqual(report.reRunBashCommands, [['ls -la', 2]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: --last N windows totals to only the last N turns', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const windowed = t.buildReport(data, { lastN: 1 });
    assert.equal(windowed.turnCount, 1);
    assert.equal(windowed.totalTurnCount, 2);
    assert.equal(windowed.totals.input_tokens, USAGE_2.input_tokens);
    assert.equal(windowed.totals.cache_read_input_tokens, USAGE_2.cache_read_input_tokens);
    // only turn 2's tool calls (Read + Bash, one each) should count in the window
    assert.equal(windowed.toolUsage.Read.count, 1);
    assert.equal(windowed.toolUsage.Bash.count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport: char totals attribute text/thinking/tool-input/user-prompt chars', async () => {
  const { dir, file } = writeFixture(buildFixtureLines());
  try {
    const data = await t.summarizeTranscript(file);
    const report = t.buildReport(data);
    assert.equal(report.charTotals.assistantTextChars, 'Done reading.'.length + 'Done again.'.length);
    assert.equal(report.charTotals.thinkingChars, 'abcde'.length);
    assert.ok(report.charTotals.userTextChars >= USER_PROMPT.length);
    assert.equal(
      report.charTotals.total,
      report.charTotals.toolResultChars + report.charTotals.assistantTextChars + report.charTotals.otherChars
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contentToText: handles a plain string, an array of text blocks, and unknown block shapes', () => {
  assert.equal(t.contentToText('plain string'), 'plain string');
  assert.equal(t.contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
  assert.equal(t.contentToText(null), '');
  // unknown block shape falls back to JSON length instead of throwing
  const withUnknown = t.contentToText([{ type: 'tool_reference', tool_name: 'X' }]);
  assert.ok(withUnknown.length > 0);
});

test('labelForTool: extracts a human label per tool kind', () => {
  assert.equal(t.labelForTool('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(t.labelForTool('Read', { file_path: '/a/b.js' }), '/a/b.js');
  assert.equal(t.labelForTool('Grep', { pattern: 'TODO' }), 'TODO');
});

test('estimateTokens: chars / 3.8, rounded', () => {
  assert.equal(t.estimateTokens(38), 10);
  assert.equal(t.estimateTokens(0), 0);
  assert.equal(t.estimateTokens(undefined), 0);
});

test('encodeProjectDir: replaces every "/" with "-"', () => {
  assert.equal(t.encodeProjectDir('/home/user/xend'), '-home-user-xend');
  assert.equal(t.encodeProjectDir('/a/b/c'), '-a-b-c');
});

test('resolveTranscriptPath: CLAUDE_TRANSCRIPT_PATH env takes precedence over --session and cwd', () => {
  const result = t.resolveTranscriptPath({ session: 'whatever', cwd: '/nope', env: { CLAUDE_TRANSCRIPT_PATH: '/explicit/path.jsonl' } });
  assert.equal(result.path, '/explicit/path.jsonl');
  assert.equal(result.source, 'CLAUDE_TRANSCRIPT_PATH');
});

test('resolveTranscriptPath: missing project dir reports an error instead of throwing', () => {
  const result = t.resolveTranscriptPath({ cwd: '/definitely/not/a/real/project/dir/xyz', env: {} });
  assert.equal(result.path, null);
  assert.ok(result.error);
});

test('summarizeTranscript: an entirely empty/garbage file yields zero turns, not a crash', async () => {
  const { dir, file } = writeFixture(['not json at all', '{"type":"queue-operation"}', '']);
  try {
    const data = await t.summarizeTranscript(file);
    assert.equal(data.turns.length, 0);
    assert.equal(data.malformedLines, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
