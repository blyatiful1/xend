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
| L1b Build less | Lazy-solution ladder: YAGNI, reuse, stdlib, native, one line; root-cause bug fixes | SessionStart `additionalContext` after upstream detection + `/xend:ponytail` | lite: `lite`, balanced and aggressive: `full`, all with the adapted text; the upstream-verbatim text is opt-in |
| L2 Read less | Lossless-recoverable shaping of tool results | PostToolUse `updatedToolOutput` on Bash, Read, Grep, Glob, MCP tools | balanced |
| L3 Delegate cheaply | Haiku/Sonnet subagents with a verify-or-escalate contract | `agents/*.md` with `model:` frontmatter + `/xend:route` skill | balanced |
| L4 Keep context lean | Checkpoints around `/clear` and compaction; reading discipline | PreCompact hook, SessionStart(`compact|clear`), `/xend:checkpoint` | balanced |
| L5 Native levers | Effort, auto-compact window, bash output cap, prompt-cache TTL, tool search, MCP output cap | `/xend:setup <profile>` writes `settings.json` keys (with backup) | opt-in |
| L6 Server-side masking | Anthropic context editing (`clear_tool_uses`) enabled through `CLAUDE_CODE_EXTRA_BODY` | settings `env` written by `/xend:setup` | aggressive (experimental; strongest external evidence, but each pass re-caches the remaining context) |
| L7 Plan, then build | Keep file contents out of the main model's context entirely: it plans, disposable Haiku/Sonnet subagents read and write, a deterministic hook verifies their claims before the plan advances | SessionStart block (architect paragraph), PreToolUse gate (`pre-edit-gate.js`), PostToolUse(Agent) launch registry (`agent-launch.js`), SubagentStop verifier (`subagent-stop.js`), `xend-cli.js plan` | balanced, aggressive |

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

One stable block (no timestamps, no per-turn re-injection so the prompt cache stays warm). At
`balanced` with the adapted lean rules it is **2,578 B / ~678 tokens** (1,549 B / ~408 tokens with
`ponytail: off`), before architect mode. Together with eight short skill descriptions and four
agent descriptions the plugin's fixed prefix was about **1,033 tokens, roughly 3.2%** of a typical
32,000-token prefix; the benchmark showed that even the smaller prefix is not amortized on
five-turn tasks (~0.8% cost per 100 tokens), which is why the cheap adapted text is the default on
`lite` and `balanced`. Architect mode adds a ninth skill (`/xend:plan`) and a fifth agent
(`xend-worker-lite`), and (default on in `balanced`/`aggressive`) one more paragraph to the block
itself: measured with `node scripts/xend-cli.js context | wc -c` *(measured here)*, the block is
**2,869 B / ~755 tokens** at `balanced` with architect enabled against **1,680 B / ~442 tokens**
with `XEND_ARCHITECT=0` — the architect paragraph costs about **1,189 B / ~313 tokens** (this
command renders the block without the lean-rules detection pass, so its totals are not directly
comparable to the 2,578 B figure above, which includes the adapted lean text). Whether that ~313
extra tokens per session, plus each builder's own cold prefix, pays for itself is exactly what the
project bench is for (see "Architect mode (L7)" below); it is not assumed. Contents:
- terse rules for the active level and their exemptions (security warnings, ordered instructions,
  anything persisted outside chat stays in full prose),
- reading discipline (grep before read, ranged reads, no re-reads of unchanged files, delegate
  broad exploration to `xend-scout`),
- the condensed-output contract (what a `[xend]` marker means, where the original lives, never
  re-run a command to see more),
- the lean build rules (the ladder, root-cause bug fixes, no unrequested abstraction), placed after
  the reading rules so "trace the flow under the reading rule above" resolves to text already seen,
- (`balanced`, `aggressive`) the architect paragraph: when to plan, how to write and dispatch a
  plan, and to trust xend's own re-run of a builder's verify command over its claim.

`vendor/ponytail/` costs **zero** tokens: Claude Code scans only `skills/` for model-invocable
skills, so the byte-identical vendored ruleset sits outside the skill index and is read only when
`ponytailText: upstream` is active or someone runs `/xend:ponytail rules`. Hooks cost nothing in the
skill index either.

**Detect-then-defer.** `scripts/lib/ponytail.js` runs one bounded, offline detection at SessionStart
(≤ ~25 stat/read calls, every one guarded) and caches the result in the session config, so per-call
hooks never repeat the walk. If an upstream ponytail plugin can actually inject, it owns the topic
— including its own `off` state — and xend emits a short reconciliation note instead of a second
copy. Otherwise xend owns it. Exactly one branch emits a ruleset, so the **one-copy invariant**
holds by construction; `tests/ponytail.test.js` asserts it across the full
(channel × mode × level × upstream switch × text) matrix. A detection failure degrades to "not
installed", which costs a visible duplicate at worst, never a silently missing ruleset.

On `SessionStart(source: compact|clear)` the block is re-injected together with the session's checkpoint
if one exists. `resume` is not matched: the block is already in the resumed history.

## Delegation contract (L3)

Subagents shipped: `xend-scout` (Haiku, read-only, returns `path:line` citations only),
`xend-reader` (Haiku, condenses a large artifact into a brief with verbatim key lines),
`xend-worker-lite` (Haiku, one mechanical fully-specified change in 1-3 files),
`xend-worker` (Sonnet, implements a fully specified change and runs its tests),
`xend-reviewer` (Sonnet, reviews a diff and returns findings only).
The routing skill states the rules that keep quality flat and cost down: a cheaper model's result is
accepted only when it is verified (tests, a citation the caller checks, or a diff the caller reads);
anything ambiguous, cross-cutting, or unverifiable stays with the main model; failure escalates one
tier; delegation happens only above a work floor (about five tool calls or tens of thousands of
tokens), because every subagent pays a cold prompt prefix; the main session never switches model
(caches are model-scoped).

Every agent declares `tools:` explicitly so MCP schemas never load in a subagent's prefix: `Read,
Glob, Grep` for `xend-scout`; `Read, Grep, Glob, Bash` (read-only use) for `xend-reader` and
`xend-reviewer`; `Read, Edit, Write, MultiEdit, Grep, Glob, Bash` for `xend-worker-lite` and
`xend-worker`. `tools:` is the only prefix lever that actually reaches a subagent: plugin agents do
not honour `omitClaudeMd`, `hooks`, `mcpServers` or `permissionMode` *(verified here, Claude Code
2.1.272; contradicts an earlier claim in this project that `omitClaudeMd` strips the memory prefix
from `xend-scout` and `xend-reader` — for plugin-installed agents it does not, and the comment in
each agent file says so)*. The `tools:` allowlist still cuts real weight: no MCP tool schemas load
for any of them.

## Architect mode (L7)

The other layers shrink what the main model reads; L7 removes file bodies from its context
altogether. The main model plans; disposable Haiku/Sonnet subagents read code and write code; a
deterministic hook verifies what they claim before the plan advances. Full design: `docs/SPEC-architect.md`.

### Roles

| Role | Who | Context contains | Never |
|---|---|---|---|
| Architect | the main session | the task, scout citations, pinned interfaces, the plan, builder reports, verify output | file bodies it will not edit itself |
| Scout | `xend-scout` (Haiku, low) | read-only search | edits |
| Builder lite | `xend-worker-lite` (Haiku, low) | one mechanical task: exact diff, or a named function with pinned behaviour and a test to satisfy, 1-3 files | design decisions |
| Builder | `xend-worker` (Sonnet, medium) | one fully specified task | redesign, out-of-scope files |
| Reviewer | `xend-reviewer` (Sonnet, medium) | a diff | edits |
| Verifier | `scripts/subagent-stop.js` (deterministic, no model) | the subagent's final reply, its transcript, the plan | summarizing |

### The plan

`node xend-cli.js plan set` writes `<session state dir>/plan.json`: a `goal`, a project-level
`verify` command, optional `conventions`, and `tasks[]` (`id`, `title`, `tier` — `lite` or
`worker` — `files`, `testFiles`, `deps`, `spec`, `verify`). xend adds runtime fields per task as it
runs: `status` (`todo|dispatched|done|failed|self`), `attempts`, `verified`, `lastVerdict`,
`scopeWarnings`. `plan next` computes the ready set from `deps`, dispatches by printing one brief
per ready task, and marks it `dispatched`; `plan status` prints one line per task plus the project
verify command and any scope warnings; `plan brief <id>`, `plan done <id> PASS|FAIL`, `plan reset
<id>` and `plan show` round out the CLI. The checkpoint (`scripts/lib/checkpoint.js`) appends a
`Plan:` section from `plan status` when a plan exists, so `/clear` and compaction keep it alive.

Each dispatched task becomes a brief — the exact text sent as the subagent's prompt:

```
[xend task T3] <title>
Goal: <goal>
Scope: edit only <files>; tests you may add or edit: <testFiles or "none">
Spec:
<spec verbatim>
Verify: <verify> (must pass; xend re-runs it after you finish)
Conventions: <conventions, or omit the line>
Reply in the fixed format: Result / Changed / Verification / Notes.
```

The `[xend task T3]` tag on the first line is load-bearing: `scripts/agent-launch.js` reads it out
of the prompt to associate the launch with a task id (see Launch registry, below).

**Escalation ladder.** A task runs at its written `tier` (`lite` or `worker`); after one failed
attempt it runs as `worker` regardless of tier; after a second failure, `worker` again; after a
third, the architect does it itself or breaks it into smaller tasks. `plan next` applies this by
attempt count automatically.

### The verifier (`scripts/subagent-stop.js`, `scripts/lib/verify.js`)

Registered under `SubagentStop` with no matcher, so it runs after every subagent, not only workers.
Always exits 0; on any internal error it prints nothing rather than surfacing a stack trace to the
model. Steps:

1. Return immediately if `architect.verify` is `false` or `XEND_VERIFY=0`.
2. Classify the agent by its (namespace-stripped) `agent_type`: `xend-scout`/`xend-reader`/
   `xend-reviewer` get a citation check only; `xend-worker`/`xend-worker-lite` get a citation check
   plus a verification check; any other agent is treated as a worker only if its first prompt
   carries an `[xend task <id>]` tag, otherwise the hook returns without acting.
3. **Citation check** (every kind): every `path:LINE` or `path:START-END` token in the reply must
   name a file that exists and a line within its length; reader evidence bullets must also quote
   text that is actually on the cited line.
4. **Verification check** (workers only): parse the fixed `Result: … / Verification: <cmd> -> …`
   reply. A missing `Result` or `Verification` is `malformed`. The plan task's own `verify` command
   is the contract and overrides whatever the builder wrote. The command is checked against a
   fixed allowlist of test/lint/typecheck runners (`pytest`, `npm test`, `go test`, `cargo test`,
   `tsc`, `eslint`, …) and against a forbidden-character set (`; & | < > `` $(`); only an allowlisted,
   metacharacter-free command is ever run, with `cwd`, a capped timeout, and capped output.
5. **Verdicts**: `pass` (claimed PASS, re-run exit 0), `mismatch` (claimed PASS, re-run non-zero),
   `fail` (claimed FAIL/BLOCKED), `unverifiable` (command not allowlisted, or no re-run possible),
   `malformed`, `bad-citations`.
6. **Block once.** When `stop_hook_active` is false and `architect.blockOnMismatch` is on, a
   `mismatch`, `malformed` or `bad-citations` verdict returns `{"decision":"block","reason":...}`
   with the re-run's last lines (mismatch), the fixed-format reminder (malformed), or the bad
   citations (bad-citations). The subagent restates once; its restated reply triggers `SubagentStop`
   again with `stop_hook_active: true`, and the hook never blocks a second time on the same run.
7. **Plan update.** When the reply carries a task id, the plan is updated: `pass` → `done, verified:
   true`; `unverifiable` with a claimed PASS → `done, verified: false` (recorded honestly, not
   trusted); `fail`, or `mismatch`/`malformed` on their final stop → `failed`, `attempts += 1`; scope
   (edited paths outside `files ∪ testFiles`) is recorded as a warning, never blocked.
8. One JSON line is appended to `<state>/verify.jsonl` per run: timestamp, agent, kind, task,
   claimed result, verdict, command, exit code, duration, whether it blocked, citations
   checked/bad, scope-warning count. `scripts/stats.js` reads this file when present and prints a
   `Delegation` section (subagent runs, verified pass, mismatches caught, unverifiable, malformed,
   citations checked/bad, scope warnings).

### Launch registry (`scripts/agent-launch.js`)

The `Agent` tool is asynchronous *(verified here, Claude Code 2.1.272)*: `PostToolUse(Agent)` fires
at launch with `tool_response.status: "async_launched"` and no result, so a verifier cannot live
there. It is, however, the only point that ever sees a subagent's launch-time prompt and its new
`agentId` together, so `scripts/agent-launch.js` records `{ agentId: { taskId, subagentType,
prompt (first 400 chars), toolUseId } }` in `<state>/agents.json` (capped at 200 entries), reading
the task id out of the same `[xend task <id>]` tag the brief carries. `SubagentStop` looks the
`agent_id` it receives up in this registry first. This matters because with
`--no-session-persistence` (the bench setting) the subagent's own transcript file named by
`agent_transcript_path` does **not** exist at stop time *(verified here)* — `last_assistant_message`
still arrives, but nothing else does — so without the registry the verifier would lose the task id
on every bench run and could not close the loop back into `plan.json`.

### The gate (`scripts/pre-edit-gate.js`)

Registered under `PreToolUse` for `Write|Edit|MultiEdit`. Two headless smoke tests *(verified
here)* showed why a purely advisory rule does not work: with the architect paragraph in context but
no gate, a Sonnet session given a three-module package did the whole task itself — 10 turns, no
plan, zero subagents, $0.28. A first gate that refused the third direct edit once and *named* `plan
off` as the way out was taken as an escape hatch: the model ran `plan off` and finished directly —
11 turns, one denial, $0.18. The shipped gate therefore has no advertised exit: when architect mode
and the gate are both enabled, no `plan.json` exists yet (a plan means the architect is doing a
deliberate `self` task or a fix), and the call is not from inside a subagent, it denies a direct
`Write`/`Edit`/`MultiEdit` of any not-yet-edited file once the session has already edited at least
`minFiles - 1` (default 3, i.e. `architect.minFiles: 4`) distinct files directly — so three files
may still be edited directly before the gate engages, and it denies again on the next new file after
that. Each denial is recorded in `gate.json` (`{ denials, files }`); once `architect.gateMaxDenials`
(3) denials have accumulated in the session, the gate stops firing and direct edits are allowed
again, bounding the turn tax at three denied turns even if the model keeps retrying instead of
planning. The denial reason gives the exact `plan set` JSON shape and the dispatch steps, and never
mentions a way to turn the gate off; `/xend:plan off` (the CLI's `plan off`) remains the user's
actual switch, reached through the session block or the skill, not through the denial text.

### Invariants

- The verifier never calls a model, never runs a command outside the allowlist, and never blocks
  the same subagent run twice.
- The gate never advertises a way to disable itself; the only reset is the user's own `/xend:plan
  off`.
- Nothing in this layer changes the main session's model or effort.
- Every claim of savings from this layer comes from `bench/results/` (the `project-*` tasks) and is
  written down whether or not it is favourable.

## Quality gate

`bench/` runs the same tasks under baseline and under xend with `claude -p`, k trials each, and
reports pass rate, tokens (all models, subagents included), turns, and cost (as reported by Claude
Code) with paired bootstrap confidence intervals, a sign test, and the minimum detectable effect for
the run size. Certifying a <=3 point bound needs on the order of 750 paired task-runs, so the suite
accumulates runs over time. A profile is promoted only when three gates pass at once: the one-sided
95% lower bound of the pass-rate delta is above -3 points, the upper bound of the cost change is
below zero, and the upper bound of the turn delta is at most +0.25. Quality alone is not enough: a
plugin can keep quality flat and still cost more, which is what happened to rtk.
