'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { costFor, findPricing } = require('../scripts/lib/pricing');

test('findPricing matches by prefix, including dated model ids', () => {
  assert.equal(findPricing('claude-sonnet-5').id, 'claude-sonnet-5');
  assert.equal(findPricing('claude-haiku-4-5-20251001').id, 'claude-haiku-4-5');
  assert.equal(findPricing('claude-opus-4-8-20260101').id, 'claude-opus-4-8');
  assert.equal(findPricing('claude-fable-5-1-20260501').id, 'claude-fable-5-1');
});

test('findPricing returns null for unknown models', () => {
  assert.equal(findPricing('claude-nonexistent-9'), null);
  assert.equal(findPricing(null), null);
  assert.equal(findPricing(undefined), null);
});

test('costFor: unknown model -> null costs but tokens still counted', () => {
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const result = costFor('claude-mystery-1', usage);
  assert.equal(result.inputCost, null);
  assert.equal(result.outputCost, null);
  assert.equal(result.totalCost, null);
  assert.equal(result.tokens.input, 1000);
  assert.equal(result.tokens.output, 500);
});

test('costFor: sonnet-5 basic input/output pricing (2/10 per MTok)', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const result = costFor('claude-sonnet-5', usage);
  assert.equal(result.inputCost, 2);
  assert.equal(result.outputCost, 10);
  assert.equal(result.cacheReadCost, 0);
  assert.equal(result.cacheWriteCost, 0);
  assert.equal(result.totalCost, 12);
});

test('costFor: cache read is 0.10x input price for a normal model', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 };
  const result = costFor('claude-sonnet-4-6', usage); // input=3
  assert.ok(Math.abs(result.cacheReadCost - 0.3) < 1e-9); // 3 * 0.10
});

test('costFor: fable-5.1 cache read is a flat $0.25/MTok override, not 0.10x', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 };
  const result = costFor('claude-fable-5-1', usage); // input=10, 0.10x would be 1.0
  assert.equal(result.cacheReadCost, 0.25);
});

test('costFor: cache write defaults to 5-minute (1.25x) rate when no TTL breakdown given', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 };
  const result = costFor('claude-opus-5', usage); // input=5
  assert.equal(result.cacheWriteCost, 5 * 1.25);
  assert.equal(result.tokens.cacheWrite5m, 1_000_000);
  assert.equal(result.tokens.cacheWrite1h, 0);
});

test('costFor: cache write splits 5m (1.25x) and 1h (2x) when breakdown given', () => {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
    cache_creation: { ephemeral_5m_input_tokens: 400_000, ephemeral_1h_input_tokens: 600_000 },
  };
  const result = costFor('claude-haiku-4-5', usage); // input=1
  const expected = (400_000 / 1e6) * (1 * 1.25) + (600_000 / 1e6) * (1 * 2);
  assert.ok(Math.abs(result.cacheWriteCost - expected) < 1e-9);
});

test('costFor: full mixed usage totalCost is the sum of the four components', () => {
  const usage = {
    input_tokens: 100_000,
    output_tokens: 20_000,
    cache_read_input_tokens: 500_000,
    cache_creation_input_tokens: 50_000,
    cache_creation: { ephemeral_5m_input_tokens: 50_000, ephemeral_1h_input_tokens: 0 },
  };
  const result = costFor('claude-opus-4-7', usage); // input=5, output=25
  const inputCost = (100_000 / 1e6) * 5;
  const outputCost = (20_000 / 1e6) * 25;
  const cacheReadCost = (500_000 / 1e6) * (5 * 0.10);
  const cacheWriteCost = (50_000 / 1e6) * (5 * 1.25);
  assert.ok(Math.abs(result.inputCost - inputCost) < 1e-9);
  assert.ok(Math.abs(result.outputCost - outputCost) < 1e-9);
  assert.ok(Math.abs(result.cacheReadCost - cacheReadCost) < 1e-9);
  assert.ok(Math.abs(result.cacheWriteCost - cacheWriteCost) < 1e-9);
  assert.ok(Math.abs(result.totalCost - (inputCost + outputCost + cacheReadCost + cacheWriteCost)) < 1e-9);
});

test('costFor: missing/undefined usage fields default to zero, not NaN', () => {
  const result = costFor('claude-sonnet-5', {});
  assert.equal(result.totalCost, 0);
  const result2 = costFor('claude-sonnet-5', undefined);
  assert.equal(result2.totalCost, 0);
});
