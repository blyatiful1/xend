'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const c = require('../scripts/lib/cachettl.js');

const M = 'claude-sonnet-5'; // $2 input: read $0.2/M, 5m write $2.5/M, 1h write $4/M
const at = (min) => Date.parse('2026-09-01T10:00:00Z') + min * 60000;
const call = (session, min, read, w1h, extra) => Object.assign({ session, ts: at(min), model: M, input: 0, read, w5m: 0, w1h, output: 0 }, extra);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' != ' + b);

test('back-to-back calls: the 5-minute lifetime only makes the writes cheaper', () => {
  const r = c.replay([call('s', 0, 0, 20000), call('s', 0.5, 20000, 1000), call('s', 1, 21000, 1000)]);
  close(r.actual, r['1h']);
  close(r['1h'] - r['5m'], 22000 * (4 - 2.5) / 1e6);
  assert.equal(r.gapsBetween, 0);
});

test('a 10-minute pause: at 5 minutes the cached context is written again', () => {
  const r = c.replay([call('s', 0, 0, 100000), call('s', 10, 100000, 500)]);
  assert.equal(r.gapsBetween, 1);
  close(r['1h'], (100500 * 4 + 100000 * 0.2) / 1e6);
  close(r['5m'], (100500 * 2.5 + 100000 * 2.5) / 1e6);
  assert.ok(r['5m'] > r['1h']);
});

test('recorded at 5 minutes, a miss after a 10-minute pause would have been a hit at 1 hour', () => {
  const r = c.replay([call('s', 0, 0, 0, { w5m: 50000 }), call('s', 10, 0, 0, { w5m: 50300 })]);
  close(r.actual, r['5m']);
  close(r['1h'], (50000 * 4 + 50000 * 0.2 + 300 * 4) / 1e6);
});

test('a session\'s first call is warm when another session ran within the lifetime', () => {
  const r = c.replay([call('a', 0, 0, 30000), call('b', 3, 30000, 200), call('c', 30, 30000, 200)]);
  // b starts 3 min after a: warm at both lifetimes; c starts 27 min after b: warm only at 1 hour
  close(r['5m'] - r['1h'], (30000 * 2.5 - 30000 * 0.2) / 1e6 - 30400 * 1.5 / 1e6);
});

test('callsFromLines: one record per message id; sidechains and synthetic messages are skipped', () => {
  const usage = { input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 50, ephemeral_5m_input_tokens: 0 } };
  const line = (id, extra) => JSON.stringify(Object.assign({ type: 'assistant', timestamp: '2026-09-01T10:00:00Z', message: { id, model: M, usage } }, extra));
  const calls = c.callsFromLines([line('m1'), line('m1'), line('m2', { isSidechain: true }), JSON.stringify({ type: 'assistant', timestamp: '2026-09-01T10:00:00Z', message: { id: 'm3', model: '<synthetic>', usage } }), 'not json'], 's');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { session: 's', ts: Date.parse('2026-09-01T10:00:00Z'), model: M, input: 3, read: 100, w5m: 0, w1h: 50, output: 7 });
});

test('stats --cache-ttl reads every project\'s transcripts under CLAUDE_CONFIG_DIR', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-ttl-'));
  const dir = path.join(cfg, 'projects', '-work-app');
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push(JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() - 3600000 + i * 20000).toISOString(),
      message: { id: 'id' + i, model: M, usage: { input_tokens: 2, cache_read_input_tokens: i ? 20000 + i * 800 : 0, cache_creation_input_tokens: i ? 800 : 20000, output_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: i ? 800 : 20000, ephemeral_5m_input_tokens: 0 } } } }));
  }
  fs.writeFileSync(path.join(dir, 'sess.jsonl'), rows.join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'stats.js'), '--cache-ttl', '--json'], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: cfg }) });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.calls, 20);
  assert.ok(j['5m'] < j['1h'], 'no pauses: 5 minutes is cheaper');
  const text = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'stats.js'), '--cache-ttl'], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: cfg }) }).stdout;
  assert.match(text, /5-minute lifetime would have cost \d+% less/);
});
