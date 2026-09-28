'use strict';
// Which prompt-cache lifetime is cheaper for the way this user works, replayed from their own
// transcripts. Claude Code writes the main conversation's cache with a 1-hour lifetime on a
// subscription (a write costs 2x input) and a 5-minute one on an API key (1.25x); a read costs
// 0.1x either way. The shorter lifetime makes every write cheaper, but after a pause longer than
// five minutes the whole context is written again instead of read. Which one wins depends only on
// how often a user pauses between 5 and 60 minutes, which the transcripts record.
//
// The replay keeps every call's tokens and changes only what a different lifetime changes:
//   - a call whose gap to the previous call of its session fits both lifetimes, or neither, is
//     billed as it was (same reads, same writes), only at the other lifetime's write price;
//   - a call that was a cache hit but whose gap exceeds the shorter lifetime becomes a miss: its
//     cached tokens are written again;
//   - a call that was a miss only because the gap exceeded the shorter lifetime becomes a hit on
//     the previous call's prompt.
// Only the main conversation is replayed (subagents have their own setting and default to 5
// minutes); a session's first call is compared against the previous call of any session, since
// the system prompt and tools are shared.
const pricing = require('./pricing.js');

const MIN = 60 * 1000;
const TTL_MS = { '5m': 5 * MIN, '1h': 60 * MIN };

// One record per model call from a transcript's JSONL lines: every content block of a call repeats
// the same usage, so calls are keyed by message id.
function callsFromLines(lines, session) {
  const seen = new Set();
  const calls = [];
  for (const line of lines) {
    let o;
    try { o = typeof line === 'string' ? JSON.parse(line) : line; } catch (_) { continue; }
    if (!o || o.type !== 'assistant' || o.isSidechain) continue;
    const m = o.message || {};
    const u = m.usage;
    if (!u || !m.id || seen.has(m.id) || !m.model || m.model === '<synthetic>') continue;
    const ts = Date.parse(o.timestamp);
    if (!Number.isFinite(ts)) continue;
    seen.add(m.id);
    const cc = u.cache_creation || {};
    const w1h = num(cc.ephemeral_1h_input_tokens);
    const w5m = cc.ephemeral_5m_input_tokens != null ? num(cc.ephemeral_5m_input_tokens) : Math.max(0, num(u.cache_creation_input_tokens) - w1h);
    calls.push({ session, ts, model: m.model, input: num(u.input_tokens), read: num(u.cache_read_input_tokens), w5m, w1h, output: num(u.output_tokens) });
  }
  return calls;
}

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }

function rates(model) {
  const p = pricing.findPricing(model);
  if (!p) return null;
  const read = typeof p.cacheReadOverride === 'number' ? p.cacheReadOverride : p.input * pricing.CACHE_READ_MULTIPLIER;
  return { input: p.input / 1e6, output: p.output / 1e6, read: read / 1e6, w5m: (p.input * pricing.CACHE_WRITE_5M_MULTIPLIER) / 1e6, w1h: (p.input * pricing.CACHE_WRITE_1H_MULTIPLIER) / 1e6 };
}

// Replays calls (any order, several sessions) under each lifetime. Returns the actual cost, the
// cost at 5m and at 1h, and how many gaps fell between the two lifetimes.
function replay(calls) {
  const sorted = calls.slice().sort((a, b) => a.ts - b.ts);
  const out = { calls: 0, sessions: 0, unpriced: 0, gapsBetween: 0, gapsLonger: 0, actual: 0, '5m': 0, '1h': 0, observedTtl: { '5m': 0, '1h': 0 } };
  const prevBySession = new Map();
  const sessions = new Set();
  let lastAny = null;
  for (const c of sorted) {
    const r = rates(c.model);
    if (!r) { out.unpriced++; continue; }
    out.calls++;
    sessions.add(c.session);
    const prev = prevBySession.get(c.session) || null;
    const gap = prev ? c.ts - prev.ts : (lastAny ? c.ts - lastAny.ts : Infinity);
    const observedTtl = c.w1h > 0 ? '1h' : c.w5m > 0 ? '5m' : (prev && prev.observedTtl) || '1h';
    c.observedTtl = observedTtl;
    out.observedTtl[observedTtl]++;
    if (gap > TTL_MS['5m'] && gap <= TTL_MS['1h']) out.gapsBetween++;
    else if (gap > TTL_MS['1h'] && gap !== Infinity) out.gapsLonger++;
    const written = c.w5m + c.w1h;
    out.actual += c.input * r.input + c.output * r.output + c.read * r.read + c.w5m * r.w5m + c.w1h * r.w1h;
    for (const ttl of ['5m', '1h']) {
      let read = c.read, write = written;
      const warmObserved = gap <= TTL_MS[observedTtl];
      const warmHere = gap <= TTL_MS[ttl];
      if (warmObserved && !warmHere) { write += read; read = 0; }
      else if (!warmObserved && warmHere && prev) {
        const prompt = c.read + written;
        const cached = Math.max(c.read, Math.min(prev.read + prev.w5m + prev.w1h, prompt));
        write = prompt - cached; read = cached;
      }
      out[ttl] += c.input * r.input + c.output * r.output + read * r.read + write * r[ttl === '5m' ? 'w5m' : 'w1h'];
    }
    prevBySession.set(c.session, c);
    lastAny = c;
  }
  out.sessions = sessions.size;
  return out;
}

function pct(a, b) { return b ? ((a - b) / b) * 100 : 0; }

function formatReport(r, opts) {
  opts = opts || {};
  const usd = (n) => '$' + n.toFixed(n < 10 ? 3 : 2);
  const lines = [];
  lines.push('Prompt-cache lifetime check: ' + r.calls + ' model calls in ' + r.sessions + ' sessions' + (opts.days ? ' (last ' + opts.days + ' days)' : '') + ', main conversation only');
  if (!r.calls) { lines.push('  no priced model calls found in the transcripts'); return lines.join('\n'); }
  const obs = r.observedTtl['1h'] >= r.observedTtl['5m'] ? '1h' : '5m';
  lines.push('  written with: ' + (r.observedTtl['1h'] && r.observedTtl['5m'] ? 'mostly ' : '') + (obs === '1h' ? '1-hour' : '5-minute') + ' lifetime');
  lines.push('  pauses of 5-60 min between calls: ' + r.gapsBetween + ' (' + (100 * r.gapsBetween / r.calls).toFixed(1) + '% of calls); longer than 1 h: ' + r.gapsLonger);
  lines.push('  cost as billed:       ' + usd(r.actual));
  lines.push('  at 1-hour lifetime:   ' + usd(r['1h']));
  lines.push('  at 5-minute lifetime: ' + usd(r['5m']) + '  (' + (pct(r['5m'], r['1h']) >= 0 ? '+' : '') + pct(r['5m'], r['1h']).toFixed(1) + '% vs 1 hour)');
  const better = r['5m'] < r['1h'] ? '5m' : '1h';
  const diff = Math.abs(pct(r['5m'], r['1h']));
  if (diff < 2) lines.push('  -> no real difference for how you work; keep the default.');
  else if (better === '5m') lines.push('  -> the 5-minute lifetime would have cost ' + diff.toFixed(0) + '% less. Set CLAUDE_CODE_PROMPT_CACHE_TTL=5m, or "promptCacheTtl": "5m" in ~/.claude/settings.json (keep 1h for sessions you step away from).');
  else lines.push('  -> the 1-hour lifetime is ' + diff.toFixed(0) + '% cheaper for you: your pauses would make a 5-minute cache write the context again. ' + (obs === '5m' ? 'Set CLAUDE_CODE_PROMPT_CACHE_TTL=1h, or "promptCacheTtl": "1h".' : 'Keep it.'));
  if (r.unpriced) lines.push('  (' + r.unpriced + ' calls with a model missing from the price table were left out)');
  lines.push('  Estimate: replays your recorded calls; it assumes the same work would have been done at either lifetime.');
  return lines.join('\n');
}

module.exports = { TTL_MS, callsFromLines, replay, formatReport };
