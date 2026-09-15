'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArm, parseScore, splitCost } = require('../bench/run.js');

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
