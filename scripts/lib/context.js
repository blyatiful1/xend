'use strict';
// Builds the stable session context block. No timestamps, no per-turn variation:
// the block is injected once per session start so the prompt cache stays warm.
const path = require('path');
const ponytail = require('./ponytail.js');

// Every sentence below is paid for in every session: written once to the prompt cache at 2x the
// input price (Claude Code's 1-hour TTL) and re-read at 0.1x on every later turn. Bench r8 measured
// the previous ~950-token prefix at +7% cost on short tasks; keep additions rare and short.
const TERSE = {
  off: '',
  lite: 'Replies: concise, full sentences. No filler, hedging or narration of tool calls; do not restate code, diffs or file contents; end with at most one summary line.',
  full: 'Replies: terse; fragments fine. No filler, hedging, narration of tool calls or upfront plans; do not restate code, diffs or file contents; end with at most one summary line. Keep code, commands, paths, identifiers, errors and numbers exact; never invent abbreviations or use arrows.',
  ultra: 'Replies: as terse as clarity allows; one word when one word is enough; each fact once. No filler, hedging, narration, plans, restated code or diffs, or closing summary. Keep code, commands, paths, identifiers, errors and numbers exact; never invent abbreviations or use arrows.',
};

const TERSE_EXEMPTIONS = 'Normal prose for anything written to files, commits, PRs or issues, and for warnings.';

// Turn economy: every model call re-reads the whole context, so on short tasks a saved call is worth
// more than any amount of output trimming. Each clause removes a call the model otherwise makes.
// Asking the model to send an edit and its test in one message did not change Sonnet's behaviour
// (Claude Code's own prompt says to run dependent calls sequentially); the auto-test hook
// (scripts/lib/autotest.js) removes that turn mechanically instead.
const READING = 'Work in few turns; each turn re-reads the whole context. Put independent tool calls in one message. Open files the task names directly (by range if large); search only for what you cannot name. Never re-read a file to confirm an edit, or re-read an unchanged file. Quiet test flags (pytest -q).';

// Kept for callers that still reference it; the explanation now travels in every [xend] marker
// itself, so a session in which nothing is condensed pays nothing for it.
const CONDENSED = '';

const DELEGATION = '';

// scripts/xend-cli.js, used verbatim inside ARCHITECT below; session-start.js and the `context`
// CLI command both pass their own resolved absolute path via opts.cliPath, but a default keeps
// the block sane for any other caller.
const DEFAULT_CLI_PATH = path.join(__dirname, '..', 'xend-cli.js');

// One paragraph, SPEC-architect.md section 4. Injected after DELEGATION when architect mode is
// enabled; the CLI path is the only environment-specific string in it, so the block otherwise
// stays free of per-turn variation. `gate` (SPEC section 13) appends one sentence noting the
// mechanical floor pre-edit-gate.js enforces; omit or pass false to leave it out.
function architectText(cliPath, gate) {
  const p = cliPath || DEFAULT_CLI_PATH;
  let text = 'Architect mode: for work touching 3+ files or needing 8+ tool calls, plan first, then let builders build; keep file contents out of your own context. 1) Locate with Grep/Glob or the Explore agent; outline a file with node "' + p + '" outline <file>; read only the interfaces you must pin. 2) Write the plan: node "' + p + '" plan set <<\'EOF\' {json} EOF — tasks small, fully specified (files, spec, verify command, tier lite=Haiku by default (a precise spec is enough), worker=Sonnet only where judgement is needed, deps). 3) node "' + p + '" plan next prints ready briefs; dispatch each with one Agent call (subagent_type xend-worker-lite or xend-worker, prompt = the brief); put independent tasks in the same message. 4) xend re-runs every builder\'s verify command; a mismatch is flagged in the builder\'s own reply and in plan status. Trust those, not the claim. 5) Repeat plan next until empty; tasks it lists under "do yourself" are yours. 6) Run the project verify command; dispatch fix tasks for failures; then summarize. Below the size floor, work directly.';
  if (gate) text += ' Above three files edited directly, xend refuses further direct edits until a plan exists.';
  return text;
}

// LEAN/LEAN_LEVEL/LEAN_UPSTREAM/LEAN_BRIDGE: adapted from ponytail (MIT, Dietrich Gebert),
// condensed and reconciled with xend's terse and reading rules — NOT upstream's wording and NOT
// the text JetBrains measured. Verbatim text: vendor/ponytail/SKILL.md. See THIRD_PARTY_NOTICES.md.
const LEAN = 'Lean (adapted from ponytail): smallest change that works. Ladder, stop at the first rung that holds: needed at all (YAGNI); already here (reuse it); stdlib; native feature; installed dependency; else minimum new code. Fix bugs at the root cause. No unrequested abstraction, boilerplate or dependency; never drop validation, error handling, security or anything asked for.';

const LEAN_LEVEL = {
  lite: 'Lean lite: build what was asked, then name the lazier alternative in one line.',
  full: 'Lean full: ladder enforced; shortest working diff.',
  ultra: 'Lean ultra: deletion before addition; ship the one-liner and question the rest of the requirement.',
};

const LEAN_UPSTREAM = 'The ponytail plugin injects its own lean ruleset this session; xend does not repeat it. Where it prints an arrow, write "skipped X; add when Y". Its "read fully" means trace the flow under the work rule above.';

// Only needed where upstream's own text asks for a skipped/add-when note (the verbatim ruleset or
// the upstream plugin); the adapted text asks for no such note, so it carries no bridge.
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
  let upstreamText = false;
  if (p.text === 'upstream') {
    const t = ponytail.upstreamText(level, { root: p.root, channel: p.channel, strict: p.strict === true });
    if (t) { out.parts.push(t); strict = p.strict === true; upstreamText = true; }
    else out.degraded = true;                             // unreadable source: fall back, never empty
  }
  if (!out.parts.length) {
    out.parts.push(LEAN + ' ' + LEAN_LEVEL[level]);
  }
  if (!strict) {
    out.suffix = ', lean ' + level;
    if (terseOn && upstreamText) out.parts.push(LEAN_BRIDGE);
  }
  out.injected = true;
  return out;
}

function build(cfg, opts) {
  opts = opts || {};
  const parts = [];
  const lean = ponytailParts(cfg, opts.ponytail);
  const archOn = !!(cfg.architect && cfg.architect.enabled);
  parts.push('xend active (profile ' + cfg.profile + ', terse ' + cfg.terse + lean.suffix + (archOn ? ', architect' : '') + ').');
  if (opts.reset) parts.push('Context was reset (' + opts.reset + '); the rules below apply again.');
  if (cfg.terse && cfg.terse !== 'off' && TERSE[cfg.terse]) parts.push(TERSE[cfg.terse] + ' ' + TERSE_EXEMPTIONS);
  if (cfg.readingDiscipline !== false) parts.push(READING);
  for (const l of lean.parts) parts.push(l);
  if (archOn) parts.push(architectText(opts.cliPath, cfg.architect.gate !== false));
  if (opts.checkpoint) parts.push('Checkpoint from before the reset:\n' + opts.checkpoint.trim());
  return parts.join('\n\n');
}

module.exports = { build, ponytailParts, TERSE, TERSE_EXEMPTIONS, READING, CONDENSED, DELEGATION, LEAN, LEAN_LEVEL, LEAN_UPSTREAM, LEAN_BRIDGE, architectText, DEFAULT_CLI_PATH };
