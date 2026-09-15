'use strict';
// Claude model pricing (USD per million tokens) and cost calculation from a
// Claude Code / Anthropic API `usage` object.
//
// Rules (see docs/ARCHITECTURE.md and the plugin's ground-truth spec):
//   - cache read     = 0.10x the model's input price, EXCEPT claude-fable-5-1
//                       where cache read is a flat $0.25 / MTok.
//   - cache write     = 1.25x input price for the 5-minute TTL, 2x input price
//                       for the 1-hour TTL.
//   - unknown models  -> every *Cost field is null, but token counts are still
//                       returned so callers can keep counting tokens.
//
// Model ids are matched by prefix (e.g. "claude-haiku-4-5-20251001" matches
// the "claude-haiku-4-5" entry), longest prefix wins so more specific ids
// never get shadowed by a shorter one.

const CACHE_READ_MULTIPLIER = 0.10;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

// input/output are USD per 1,000,000 tokens.
const PRICE_TABLE = [
  { id: 'claude-fable-5-1', input: 10, output: 50, cacheReadOverride: 0.25 },
  { id: 'claude-opus-5', input: 5, output: 25 },
  { id: 'claude-opus-4-8', input: 5, output: 25 },
  { id: 'claude-opus-4-7', input: 5, output: 25 },
  { id: 'claude-opus-4-6', input: 5, output: 25 },
  { id: 'claude-sonnet-5', input: 2, output: 10 },
  { id: 'claude-sonnet-4-6', input: 3, output: 15 },
  { id: 'claude-haiku-4-5', input: 1, output: 5 },
];

// Longest-prefix-first so e.g. "claude-opus-4-8" is tried before any shorter
// entry that might otherwise accidentally prefix-match it.
const SORTED_PRICE_TABLE = PRICE_TABLE.slice().sort((a, b) => b.id.length - a.id.length);

function findPricing(model) {
  if (!model || typeof model !== 'string') return null;
  for (const entry of SORTED_PRICE_TABLE) {
    if (model.startsWith(entry.id)) return entry;
  }
  return null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// costFor(model, usage) -> {
//   model, matchedPricingId, tokens: {...}, inputCost, outputCost,
//   cacheReadCost, cacheWriteCost, totalCost
// }
// Every *Cost field is `null` when the model is unrecognized; `tokens` is
// always populated so counts are never lost.
function costFor(model, usage) {
  const u = usage || {};
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const cacheReadTokens = num(u.cache_read_input_tokens);
  const cacheCreationTokens = num(u.cache_creation_input_tokens);

  const cc = u.cache_creation || {};
  const has5m = typeof cc.ephemeral_5m_input_tokens === 'number';
  const has1h = typeof cc.ephemeral_1h_input_tokens === 'number';
  let write5m;
  let write1h;
  if (has5m || has1h) {
    write5m = num(cc.ephemeral_5m_input_tokens);
    write1h = num(cc.ephemeral_1h_input_tokens);
  } else {
    // No TTL breakdown reported: assume the default 5-minute cache write.
    write5m = cacheCreationTokens;
    write1h = 0;
  }

  const pricing = findPricing(model);
  const result = {
    model: model || null,
    matchedPricingId: pricing ? pricing.id : null,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheCreation: cacheCreationTokens,
      cacheWrite5m: write5m,
      cacheWrite1h: write1h,
    },
    inputCost: null,
    outputCost: null,
    cacheReadCost: null,
    cacheWriteCost: null,
    totalCost: null,
  };
  if (!pricing) return result;

  const cacheReadRate = typeof pricing.cacheReadOverride === 'number'
    ? pricing.cacheReadOverride
    : pricing.input * CACHE_READ_MULTIPLIER;

  const inputCost = (inputTokens / 1e6) * pricing.input;
  const outputCost = (outputTokens / 1e6) * pricing.output;
  const cacheReadCost = (cacheReadTokens / 1e6) * cacheReadRate;
  const cacheWriteCost =
    (write5m / 1e6) * (pricing.input * CACHE_WRITE_5M_MULTIPLIER) +
    (write1h / 1e6) * (pricing.input * CACHE_WRITE_1H_MULTIPLIER);

  result.inputCost = inputCost;
  result.outputCost = outputCost;
  result.cacheReadCost = cacheReadCost;
  result.cacheWriteCost = cacheWriteCost;
  result.totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return result;
}

module.exports = {
  PRICE_TABLE,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  findPricing,
  costFor,
};
