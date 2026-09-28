'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArm, normalizeArm, toolArgs, parseScore, splitCost, parseArmEnv, TOOLSETS } = require('../bench/run.js');

test('parseArm: legacy bare label uses the label as kind and the default model, mode plain', () => {
  assert.deepStrictEqual(parseArm('baseline', { model: 'sonnet' }), { label: 'baseline', kind: 'baseline', model: 'sonnet', mode: 'plain' });
  assert.deepStrictEqual(parseArm('xend', { model: 'opus' }), { label: 'xend', kind: 'xend', model: 'opus', mode: 'plain' });
});

test('parseArm: label:kind:model spec overrides the default model, mode stays plain without a 4th field', () => {
  assert.deepStrictEqual(parseArm('solo-sonnet:baseline:sonnet', { model: 'haiku' }), { label: 'solo-sonnet', kind: 'baseline', model: 'sonnet', mode: 'plain' });
  assert.deepStrictEqual(parseArm('solo-fable:baseline:fable', { model: 'haiku' }), { label: 'solo-fable', kind: 'baseline', model: 'fable', mode: 'plain' });
});

test('parseArm: label:kind:model:architect sets architect mode only for xend arms', () => {
  assert.deepStrictEqual(parseArm('arch-fable:xend:fable:architect', {}), { label: 'arch-fable', kind: 'xend', model: 'fable', mode: 'architect' });
  assert.deepStrictEqual(parseArm('arch-sonnet:xend:sonnet:architect', {}), { label: 'arch-sonnet', kind: 'xend', model: 'sonnet', mode: 'architect' });
  // baseline ignores a trailing "architect" mode field - always plain
  assert.deepStrictEqual(parseArm('weird:baseline:sonnet:architect', {}), { label: 'weird', kind: 'baseline', model: 'sonnet', mode: 'plain' });
});

test('parseArm: missing model segment falls back to defaults.model', () => {
  assert.deepStrictEqual(parseArm('lbl:xend:', { model: 'sonnet' }), { label: 'lbl', kind: 'xend', model: 'sonnet', mode: 'plain' });
});

test('parseScore: finds SCORE: passed/total anywhere in the text, tolerant of whitespace', () => {
  assert.deepStrictEqual(parseScore('some noise\nSCORE: 8/10\nmore noise'), { passed: 8, total: 10 });
  assert.deepStrictEqual(parseScore('SCORE:3 / 5'), { passed: 3, total: 5 });
  assert.deepStrictEqual(parseScore('stdout stuff\nSCORE:   12   /   12   \n'), { passed: 12, total: 12 });
});

test('parseScore: returns null when there is no SCORE line or total is 0', () => {
  assert.strictEqual(parseScore('PASS\nno score here'), null);
  assert.strictEqual(parseScore(''), null);
  assert.strictEqual(parseScore(undefined), null);
  assert.strictEqual(parseScore('SCORE: 0/0'), null);
});

test('splitCost: attributes cost to the model matching the arm alias, the rest counts as subagents', () => {
  const mu = {
    'claude-sonnet-5': { input: 1, cache_creation: 0, cache_read: 0, output: 1, cost: 0.08 },
    'claude-haiku-4-5': { input: 1, cache_creation: 0, cache_read: 0, output: 1, cost: 0.02 },
  };
  const r = splitCost(mu, 'sonnet');
  assert.strictEqual(r.main_model, 'claude-sonnet-5');
  assert.ok(Math.abs(r.cost_main_usd - 0.08) < 1e-9);
  assert.ok(Math.abs(r.cost_sub_usd - 0.02) < 1e-9);
});

test('splitCost: matches a full model id exactly, not just an alias substring', () => {
  const mu = {
    'claude-opus-4-1': { cost: 0.5 },
    'claude-haiku-4-5': { cost: 0.01 },
  };
  const r = splitCost(mu, 'claude-opus-4-1');
  assert.strictEqual(r.main_model, 'claude-opus-4-1');
  assert.strictEqual(r.cost_main_usd, 0.5);
  assert.strictEqual(r.cost_sub_usd, 0.01);
});

test('splitCost: falls back to the highest-cost model as main when the alias is not found', () => {
  const mu = {
    'some-custom-model-a': { cost: 0.03 },
    'some-custom-model-b': { cost: 0.11 },
  };
  const r = splitCost(mu, 'fable');
  assert.strictEqual(r.main_model, 'some-custom-model-b');
  assert.ok(Math.abs(r.cost_main_usd - 0.11) < 1e-9);
  assert.ok(Math.abs(r.cost_sub_usd - 0.03) < 1e-9);
});

test('splitCost: empty modelUsage yields zero cost on both sides and no main model', () => {
  assert.deepStrictEqual(splitCost({}, 'sonnet'), { cost_main_usd: 0, cost_sub_usd: 0, main_model: null });
  assert.deepStrictEqual(splitCost(null, 'sonnet'), { cost_main_usd: 0, cost_sub_usd: 0, main_model: null });
});

test('parseArmEnv: empty or undefined input yields {}', () => {
  assert.deepStrictEqual(parseArmEnv(''), {});
  assert.deepStrictEqual(parseArmEnv(undefined), {});
});

test('parseArmEnv: splits pairs on "," and each pair on its first "=" (a value may itself contain "=")', () => {
  assert.deepStrictEqual(parseArmEnv('A=1,B=x=y'), { A: '1', B: 'x=y' });
  assert.deepStrictEqual(parseArmEnv('XEND_ARCHITECT_MIN_FILES=1'), { XEND_ARCHITECT_MIN_FILES: '1' });
});

test('parseArm: xend@<dir> loads the plugin from another checkout; baseline ignores a dir', () => {
  assert.deepStrictEqual(parseArm('old:xend@/tmp/xend-main:sonnet', {}), { label: 'old', kind: 'xend', model: 'sonnet', mode: 'plain', pluginDir: '/tmp/xend-main' });
  assert.deepStrictEqual(parseArm('b:baseline@/x:sonnet', {}), { label: 'b', kind: 'baseline', model: 'sonnet', mode: 'plain' });
});

test('normalizeArm: arms-file entries keep per-arm env and plugin dir, unknown kinds fall back to baseline', () => {
  assert.deepStrictEqual(normalizeArm({ label: 'noterse', kind: 'xend', env: { XEND_TERSE: 'off' } }, { model: 'sonnet' }),
    { label: 'noterse', kind: 'xend', model: 'sonnet', mode: 'plain', env: { XEND_TERSE: 'off' } });
  assert.deepStrictEqual(normalizeArm({ label: 'x', kind: 'weird', pluginDir: '/p', env: { A: '1' } }, { model: 'haiku' }),
    { label: 'x', kind: 'baseline', model: 'haiku', mode: 'plain', env: { A: '1' } });
});

test('toolArgs: local toolset makes the available set explicit and pre-approves it plus the task tools', () => {
  const r = toolArgs('Bash,Read,Edit,Write,MultiEdit,Grep,Glob', 'local');
  assert.strictEqual(r.tools, TOOLSETS.local);
  for (const t of TOOLSETS.local.split(',')) assert.ok(r.allowedTools.split(',').includes(t), t);
  assert.ok(r.allowedTools.split(',').includes('MultiEdit'));
  assert.ok(!r.tools.split(',').includes('MultiEdit'), 'MultiEdit is not a built-in tool name for --tools');
});

test('toolArgs: host toolset keeps the legacy behaviour (no --tools, only task tools approved)', () => {
  assert.deepStrictEqual(toolArgs('Bash,Read', 'host'), { tools: null, allowedTools: 'Bash,Read' });
});

test('jobEnv: an arms-file env reaches a baseline arm; the global --arm-env reaches xend arms only', () => {
  const { jobEnv } = require('../bench/run.js');
  const opts = { profile: 'balanced', arm_env: { XEND_SHAPE: '0' } };
  const base = jobEnv({ kind: 'baseline', env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } }, opts, '/s', 'Bash,Read');
  assert.deepStrictEqual(base, { XEND_STATE_DIR: '/s', CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' });
  const x = jobEnv({ kind: 'xend', mode: 'plain', env: { XEND_TERSE: 'off' } }, opts, '/s', 'Bash,Read');
  assert.strictEqual(x.XEND_SHAPE, '0');
  assert.strictEqual(x.XEND_TERSE, 'off');
  assert.strictEqual(x.XEND_TRUST_TESTS, '1');
});

test('cleanEnv: an ambient cache-lifetime setting never reaches an arm unless the arm sets it', () => {
  const { cleanEnv } = require('../bench/run.js');
  const saved = Object.assign({}, process.env);
  try {
    process.env.CLAUDE_CODE_PROMPT_CACHE_TTL = '5m';
    process.env.FORCE_PROMPT_CACHING_5M = '1';
    const e = cleanEnv({});
    assert.strictEqual(e.CLAUDE_CODE_PROMPT_CACHE_TTL, undefined);
    assert.strictEqual(e.FORCE_PROMPT_CACHING_5M, undefined);
    assert.strictEqual(cleanEnv({ CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }).CLAUDE_CODE_PROMPT_CACHE_TTL, '1h');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('normalizeArm keeps per-arm claude args; parseArgs flags --help and refuses unknown arguments', () => {
  const { parseArgs } = require('../bench/run.js');
  assert.deepStrictEqual(normalizeArm({ label: 'b5', kind: 'baseline', args: ['--append-system-prompt', 'arm b5'] }, { model: 'sonnet' }).args, ['--append-system-prompt', 'arm b5']);
  assert.strictEqual(parseArgs(['--help']).help, true);
  assert.match(parseArgs(['--runs', '2', '--hepl']).error, /unknown argument: --hepl/);
  assert.strictEqual(parseArgs(['--runs', '2']).error, undefined);
});
