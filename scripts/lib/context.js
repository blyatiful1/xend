'use strict';
// Builds the stable session context block. No timestamps, no per-turn variation:
// the block is injected once per session start so the prompt cache stays warm.
const ponytail = require('./ponytail.js');

const TERSE = {
  off: '',
  lite: 'Output style (lite): concise. No filler, pleasantries or hedging; keep full sentences. Do not narrate tool calls, restate diffs or file contents, or add a closing summary beyond one line.',
  full: 'Output style (full): terse, like a smart caveman. Drop articles, filler, pleasantries, hedging; fragments OK; short synonyms. Do not narrate tool calls, restate diffs or file contents, add a closing summary beyond one line, or plan unless asked. Never invent abbreviations or use arrows. Keep exact: code, commands, paths, identifiers, error strings, numbers, units, negations.',
  ultra: 'Output style (ultra): terse, like a smart caveman. Drop articles, filler, pleasantries, hedging, and conjunctions when cause-then-effect stays clear; one word when one word is enough; each fact once. No narration, restated diffs, closing summary, or plans unless asked. Never invent abbreviations or use arrows. Keep exact: code, commands, paths, identifiers, error strings, numbers, units, negations.',
};

const TERSE_EXEMPTIONS = 'Normal prose for security warnings, irreversible-action confirmations, ordered multi-step instructions, anything persisted outside chat (code, comments, commits, PR and issue text, docs, memory files), and when the user asks for clarity.';

const READING = 'Reading: Grep or Glob before Read; read large files by range; do not re-read unchanged files; verify edits with a targeted read or git diff; batch independent tool calls.';

const CONDENSED = 'A tool result ending with a [xend] line was condensed deterministically (escape codes, progress bars, passing-test rows or install chatter removed; very long generic output cut to head and tail; a repeat of a recent command shortened). Errors, failures, diffs and summaries are always kept: treat it as complete. If the marker names a file, that file holds the full original. Do not re-run a command only to see the condensed part; re-run when state may have changed.';

const DELEGATION = 'Subagents xend-scout, xend-reader (Haiku) and xend-worker, xend-reviewer (Sonnet) exist for bulk work only (five or more tool calls, or long output you would otherwise read); each pays a cold prefix, and their output must be verified before use.';

// LEAN/LEAN_LEVEL/LEAN_UPSTREAM/LEAN_BRIDGE: adapted from ponytail (MIT, Dietrich Gebert),
// condensed and reconciled with xend's terse and reading rules — NOT upstream's wording and NOT
// the text JetBrains measured. Verbatim text: vendor/ponytail/SKILL.md. See THIRD_PARTY_NOTICES.md.
const LEAN = 'Lean (adapted from ponytail): laziest solution that works. Ladder, stop at first rung that holds: needed at all (YAGNI); already here (reuse it); stdlib; native platform feature; installed dependency; one line; else minimum new code. Bug fix = root cause: grep callers, guard the shared function once. No unrequested abstraction, boilerplate or new dependency. Delete over add. Fewest files, shortest working diff. Understand first: trace the flow under the reading rule above. Never simplify away validation at trust boundaries, error handling that prevents data loss, security, accessibility, or anything asked for; non-trivial logic leaves one runnable check; mark a deliberate corner-cut with a `ponytail:` comment naming the ceiling. After the code, at most three short lines: what was skipped, when to add it.';

const LEAN_LEVEL = {
  lite: 'Lean lite: build what was asked, then name the lazier alternative in one line; user picks.',
  full: 'Lean full: ladder enforced; stdlib and native before new code; shortest diff, shortest explanation.',
  ultra: 'Lean ultra: deletion before addition; ship the one-liner and challenge the rest of the requirement in the same reply.',
};

const LEAN_UPSTREAM = 'The ponytail plugin injects its own lean ruleset this session; xend does not repeat it. Where it prints an arrow, write "skipped X; add when Y". Its "read fully" means trace the flow under the reading rule above.';

const LEAN_BRIDGE = 'The skipped/add-when note is the one exception to the one-line summary cap, and carries no arrows.';

// Parts 7-9 of the block, plus the header suffix. Exactly one branch emits a ruleset, so
// the one-copy invariant holds by construction. p = opts.ponytail (see SPEC section 5.2).
function ponytailParts(cfg, p) {
  const out = { suffix: '', parts: [], injected: false, degraded: false };
  if (!p) return out;
  const terseOn = cfg.terse && cfg.terse !== 'off';
  if (p.upstreamOwns) {                                   // B2 / B3
    if (p.mode === 'off') return out;                     // B3: upstream owns its own off state
    out.suffix = ', lean ' + p.mode + ' (ponytail plugin)';
    out.parts.push(LEAN_UPSTREAM);
    if (terseOn) out.parts.push(LEAN_BRIDGE);
    return out;
  }
  const level = ponytail.normalizeMode(cfg.ponytail);
  if (!level) return out;                                 // B0: ponytail off, block unchanged
  let strict = false;
  if (p.text === 'upstream') {
    const t = ponytail.upstreamText(level, { root: p.root, channel: p.channel, strict: p.strict === true });
    if (t) { out.parts.push(t); strict = p.strict === true; }
    else out.degraded = true;                             // unreadable source: fall back, never empty
  }
  if (!out.parts.length) {
    out.parts.push(LEAN);
    out.parts.push(LEAN_LEVEL[level]);
  }
  if (!strict) {
    out.suffix = ', lean ' + level;
    if (terseOn) out.parts.push(LEAN_BRIDGE);
  }
  out.injected = true;
  return out;
}

function build(cfg, opts) {
  opts = opts || {};
  const parts = [];
  const lean = ponytailParts(cfg, opts.ponytail);
  parts.push('xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + lean.suffix + ').');
  if (opts.reset) parts.push('Context was reset (' + opts.reset + '); the rules below apply again.');
  if (cfg.terse && cfg.terse !== 'off' && TERSE[cfg.terse]) {
    parts.push(TERSE[cfg.terse]);
    parts.push(TERSE_EXEMPTIONS);
  }
  if (cfg.readingDiscipline !== false) parts.push(READING);
  if (cfg.shape && cfg.shape.enabled) parts.push(CONDENSED);
  for (const l of lean.parts) parts.push(l);
  if (cfg.delegation !== false) parts.push(DELEGATION);
  if (opts.checkpoint) parts.push('Checkpoint from before the reset:\n' + opts.checkpoint.trim());
  return parts.join('\n\n');
}

module.exports = { build, ponytailParts, TERSE, TERSE_EXEMPTIONS, READING, CONDENSED, DELEGATION, LEAN, LEAN_LEVEL, LEAN_UPSTREAM, LEAN_BRIDGE };
