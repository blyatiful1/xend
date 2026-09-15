'use strict';
// Builds the stable session context block. No timestamps, no per-turn variation:
// the block is injected once per session start so the prompt cache stays warm.

const TERSE = {
  off: '',
  lite: 'Output style (lite): answer concisely. No filler, pleasantries, or hedging. Keep full sentences and articles. No narration of tool calls. Do not restate diffs, file contents, or plans; end with at most one summary line.',
  full: 'Output style (full): respond terse, like a smart caveman. Drop articles (a/an/the), filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms. No narration of tool calls, no restating diffs or file contents, no closing summary beyond one line, no plans unless asked. Never invent abbreviations or use arrows: they save nothing. Keep exact: code, commands, paths, identifiers, error strings, numbers, units, negations (not/never/only).',
  ultra: 'Output style (ultra): respond terse, like a smart caveman. Drop articles, filler, pleasantries, hedging, and conjunctions when cause-then-effect stays clear. One word when one word is enough; state each fact once. No narration of tool calls, no restating diffs or file contents, no closing summary, no plans unless asked. Never invent abbreviations or use arrows. Keep exact: code, commands, paths, identifiers, error strings, numbers, units, negations.',
};

const TERSE_EXEMPTIONS = 'Write normal prose for: security warnings, confirmations of irreversible actions, multi-step instructions where order matters, and anything persisted outside this chat (code, comments, commit messages, PR and issue text, docs, memory files). If the user asks for clarity or repeats a question, answer in full sentences.';

const READING = 'Reading discipline: Grep or Glob before Read. Read large files by range (offset/limit) after locating the region. Do not re-read a file you have not changed; after an edit, verify with a targeted read or git diff, not a full re-read. Batch independent tool calls in one turn. Delegate broad exploration (five or more files to scan, or output you would only skim) to the xend-scout subagent and read only the citations it returns; look up a single known symbol yourself.';

const CONDENSED = 'Condensed tool output: a tool result may end with a line starting with [xend]. It means the result was condensed deterministically: escape codes, progress bars, passing-test rows, or install chatter removed; very long generic output shortened to head and tail; or a byte-identical repeat of a recent command output shortened. Errors, failures, diffs, and summary lines are always kept. Treat a condensed result as complete. When the marker names a file, that file holds the full original; read it with offset/limit only if a detail you need is missing. Do not re-run a command only to see the condensed part again; do re-run it whenever the underlying state may have changed.';

const DELEGATION = 'Subagents: xend-scout (Haiku, read-only, returns path:line citations), xend-reader (Haiku, condenses a large log or file into a brief with verbatim key lines), xend-worker (Sonnet, implements a fully specified testable change), xend-reviewer (Sonnet, reviews a diff and returns findings). Each subagent starts with a cold prompt prefix, so delegate only bulk work (about five or more tool calls, or tens of thousands of tokens you would otherwise read). Accept their output only after verifying it: run the tests, read the cited lines, read the diff. Ambiguous, cross-cutting, or unverifiable work stays with you.';

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
