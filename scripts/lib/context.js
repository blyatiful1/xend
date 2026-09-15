'use strict';
// Builds the stable session context block. No timestamps, no per-turn variation:
// the block is injected once per session start so the prompt cache stays warm.

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

function build(cfg, opts) {
  opts = opts || {};
  const parts = [];
  parts.push('xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + ').');
  if (opts.reset) parts.push('Context was reset (' + opts.reset + '); the rules below apply again.');
  if (cfg.terse && cfg.terse !== 'off' && TERSE[cfg.terse]) {
    parts.push(TERSE[cfg.terse]);
    parts.push(TERSE_EXEMPTIONS);
  }
  if (cfg.readingDiscipline !== false) parts.push(READING);
  if (cfg.shape && cfg.shape.enabled) parts.push(CONDENSED);
  if (cfg.delegation !== false) parts.push(DELEGATION);
  if (opts.checkpoint) parts.push('Checkpoint from before the reset:\n' + opts.checkpoint.trim());
  return parts.join('\n\n');
}

module.exports = { build, TERSE, TERSE_EXEMPTIONS, READING, CONDENSED, DELEGATION };
