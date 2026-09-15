# xend architecture

xend is a Claude Code plugin that lowers token spend without lowering output quality.
It is built on three findings from the research phase (see `RESEARCH.md`):

1. **Reading dominates context, and context drives cost.** In agentic coding sessions roughly
   three quarters of the context window is tool results the model reads (file reads, grep hits,
   command output), not prose it writes. With prompt caching a tool result is billed once at the
   write rate and then at a tenth per turn, so a byte saved is worth about a tenth of its face
   value per remaining turn; it also delays compaction and context rot. Output-style compression
   alone is worth 8.5% of output tokens (JetBrains, 86 tasks, no measurable quality change), which
   is a few percent of total cost. The larger wins are on the input side and in turn counts.
2. **Lossy filtering backfires.** Rewriting commands so the model sees less (rtk) raised cost 7.6%
   in an independent benchmark because the model re-ran commands and took more turns. Any
   condensation must be recoverable, must keep every signal line, and must tell the model how to get
   the original.
3. **Masking beats summarizing.** Replacing *old* tool results with placeholders halved cost and
   slightly raised solve rate on SWE-bench Verified (JetBrains, NeurIPS 2025); LLM summaries of
   tool output extended trajectories 13-15%. Anthropic's server-side context editing implements
   age-based masking and reports +29% task performance on long-horizon work. Note the distinction:
   that evidence supports clearing *old* results (layer L6). Shaping a result at the moment it is
   produced (layer L2) is a different operation, so L2 only removes content that carries no
   decision-relevant information (escape codes, progress bars, passing-test rows, install chatter,
   exact repeats) and never cuts the middle of a diff or a test run.
4. **The turn tax.** Shaping one oversized result saves on the order of $0.05 over a session at
   Sonnet prices; one extra assistant turn costs about $0.03. A transform that causes even one
   extra turn per two uses is net negative. Turn count is therefore a first-class benchmark
   endpoint and part of the promotion gate.

Everything in xend maps to a native Claude Code extension point. There is no proxy, no daemon,
no database, and no dependency beyond Node.js 18+.

## Layers

| Layer | Purpose | Extension point | Default profile |
|---|---|---|---|
| L0 Measure | Know where tokens go before and after | `scripts/stats.js` (session JSONL), `scripts/doctor.js` (static audit), `bench/` (paired A/B) | all |
| L1 Say less | Terse output style; caveman-compatible levels | SessionStart `additionalContext` (once per session, cache-stable) + `/xend:terse` skill | lite: `lite`, balanced: `full` |
| L2 Read less | Lossless-recoverable shaping of tool results | PostToolUse `updatedToolOutput` on Bash, Read, Grep, Glob, MCP tools | balanced |
| L3 Delegate cheaply | Haiku/Sonnet subagents with a verify-or-escalate contract | `agents/*.md` with `model:` frontmatter + `/xend:route` skill | balanced |
| L4 Keep context lean | Checkpoints around `/clear` and compaction; reading discipline | PreCompact hook, SessionStart(`compact|clear`), `/xend:checkpoint` | balanced |
| L5 Native levers | Effort, auto-compact window, bash output cap, prompt-cache TTL, tool search, MCP output cap | `/xend:setup <profile>` writes `settings.json` keys (with backup) | opt-in |
| L6 Server-side masking | Anthropic context editing (`clear_tool_uses`) enabled through `CLAUDE_CODE_EXTRA_BODY` | settings `env` written by `/xend:setup` | aggressive (experimental; strongest external evidence, but each pass re-caches the remaining context) |

## Profiles

| Profile | What is on | Expected saving | Quality risk |
|---|---|---|---|
| `lite` | L0, L1 (`lite` terse), L2 noise-only (ANSI, progress bars, blank runs, trailing whitespace), Bash repeat shortening | a few percent | not measured separately |
| `balanced` (default) | lite + L1 `full`, L2 structured shaping (test-runner and install noise, head+tail on long *generic* output only, grep/glob caps with true totals), L3, L4 | 0-10% on short tasks, more on reading-heavy and long sessions | low; every transform is recoverable and diffs/tests/reads are never cut |
| `aggressive` | balanced + tighter caps, ranged reads of very large files (PreToolUse), L6 server-side masking, L5 recommendations applied | larger on long sessions; can be negative on short ones | medium; must pass the bench gate before adoption |

Profile resolution order: `XEND_PROFILE` env > `.xend.json` in the project (walking up) > `~/.config/xend/config.json` > `balanced`.
Individual keys can be overridden at any level; see `docs/PROFILES.md`.

## Data flow of a shaped tool result

```
Claude calls Bash("npm test")
  -> Claude Code runs it, builds tool_response {stdout, stderr, ...}
  -> PostToolUse hook: scripts/post-tool-use.js
       1. read JSON from stdin (tool_name, tool_input, tool_response, session_id, ...)
       2. pick transforms for the tool + command + profile
       3. shape stdout/stderr; compute chars before/after
       4. if shaped: persist the original to <state>/tool-<id>.txt unless Claude Code already
          persisted it (persistedOutputPath) and append one marker line:
          "[xend] 1,240 lines -> 61 kept (test summary + failures). Full: /path/tool-x.txt"
       5. print {"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": <same shape>}}
       6. append a record to <state>/shaping.jsonl for /xend:stats
  -> Claude Code validates the shape and sends the shaped result to the model
```

Invariants:
- The output object keeps the tool's exact shape (Claude Code rejects mismatches and falls back to the original); `persistedOutputPath` and count fields pass through unchanged.
- Error lines, failure blocks, diffs, stack traces and summary lines are never dropped; diff-shaped and test-run output is never head/tail cut; `Read` results are never altered.
- A marker line is always present when anything changed; it names a recovery path when at least 2,000 characters were removed (a path invites a re-read, so small removals stay unmarked).
- Shaping never calls a model. Transforms are deterministic string operations (masking, not summarizing).
- Nothing is shaped inside subagents; their evidence must be exact and their context is discarded anyway.
- The hook exits 0 and prints nothing when it has nothing to change; it never blocks a tool.
- The resolved configuration is cached in session state at SessionStart so per-call hooks do no filesystem walk.
- Time budget: < 50 ms typical; hard timeout 10 s in `hooks.json`.

## Session context injected at SessionStart

One stable block (~600 tokens, no timestamps, no per-turn re-injection so the prompt cache stays warm; together with seven short skill descriptions and four agent descriptions the plugin's fixed prefix is about 1,000 tokens, roughly 3% of a typical 32,000-token prefix):
- terse rules for the active level and their exemptions (security warnings, ordered instructions,
  anything persisted outside chat stays in full prose),
- reading discipline (grep before read, ranged reads, no re-reads of unchanged files, delegate
  broad exploration to `xend-scout`),
- the condensed-output contract (what a `[xend]` marker means, where the original lives, never
  re-run a command to see more).

On `SessionStart(source: compact|clear)` the block is re-injected together with the session's checkpoint
if one exists. `resume` is not matched: the block is already in the resumed history.

## Delegation contract (L3)

Subagents shipped: `xend-scout` (Haiku, read-only, returns `path:line` citations only),
`xend-reader` (Haiku, condenses a large artifact into a brief with verbatim key lines),
`xend-worker` (Sonnet, implements a fully specified change and runs its tests),
`xend-reviewer` (Sonnet, reviews a diff and returns findings only).
The routing skill states the rules that keep quality flat and cost down: a cheaper model's result is
accepted only when it is verified (tests, a citation the caller checks, or a diff the caller reads);
anything ambiguous, cross-cutting, or unverifiable stays with the main model; failure escalates one
tier; delegation happens only above a work floor (about five tool calls or tens of thousands of
tokens), because every subagent pays a cold prompt prefix; the main session never switches model
(caches are model-scoped).

## Quality gate

`bench/` runs the same tasks under baseline and under xend with `claude -p`, k trials each, and
reports pass rate, tokens (all models, subagents included), turns, and cost (as reported by Claude
Code) with paired bootstrap confidence intervals, a sign test, and the minimum detectable effect for
the run size. Certifying a <=3 point bound needs on the order of 750 paired task-runs, so the suite
accumulates runs over time. A profile is promoted only when three gates pass at once: the one-sided
95% lower bound of the pass-rate delta is above -3 points, the upper bound of the cost change is
below zero, and the upper bound of the turn delta is at most +0.25. Quality alone is not enough: a
plugin can keep quality flat and still cost more, which is what happened to rtk.
