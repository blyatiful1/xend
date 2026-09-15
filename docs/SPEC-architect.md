# SPEC: xend architect mode (L7)

Status: implementation spec. Written by the planning model; built by cheaper worker agents; every
claim in it is either verified in this environment (marked *(verified)*) or a design decision.

## 0. Why

The evidence base (`RESEARCH.md`) says reading dominates cost (three quarters of context is tool
results), that a cheaper model's output is safe exactly when it is verified before it is trusted,
and that xend's shipped layers cannot save money on five-turn tasks because the only thing in play
there is the fixed prefix. The lever that is left is structural: **keep file contents out of the
expensive model's context entirely.** The strong model reads interfaces and writes a plan; cheap
models read code and write code in disposable contexts; a deterministic hook verifies what they
claim; the strong model integrates from short reports.

Token economics of one plan-then-build task versus doing it in one context:

| | one context | architect |
|---|---|---|
| file reads (the ~75%) | in the strong model's context, re-read at cache-read price every later turn | in builder contexts only, discarded after the task |
| plan / spec | implicit | ~300-800 output tokens once |
| per builder | none | one cold prefix (~10-20k tokens at the builder's price; `tools:` allowlists and no MCP schemas keep it small) plus ~150-300 tokens of report in the parent |
| verification | the model's own claim | re-run by a hook, mismatch surfaced |
| compaction | likely on long tasks (paid summary + cold cache) | rarely: the parent context stays small |

The bench (`bench/tasks/project-*`) measures this; nothing here claims a number before that run.

## 1. Verified facts this design relies on *(verified, Claude Code 2.1.272, this environment)*

- Plugin agents load under `--plugin-dir` in `claude -p`; the `Agent` tool must be in `--allowedTools`;
  plugin agents are addressed as `xend:xend-scout` etc. in `tool_input.subagent_type`. The result JSON
  reports `modelUsage` per model (subagents included), `total_cost_usd`, and `subagent_stats`
  (`spawned`, `completed`, `failed`, `by_type`).
- The `Agent` tool is asynchronous in this build: `PostToolUse(Agent)` fires at launch with
  `tool_response.status = "async_launched"` and no result. **A verifier cannot live in PostToolUse.**
- `SubagentStop` input carries `agent_id`, `agent_type` (namespaced, e.g. `xend:xend-scout`),
  `agent_transcript_path` (the subagent's own JSONL), `last_assistant_message` (the final reply text),
  `stop_hook_active`, `cwd`, `session_id`, `scratchpad_dir`, `transcript_path` (the parent's).
- `SubagentStop` returning `{"decision":"block","reason":"..."}` makes the subagent continue with the
  reason as input; its next reply triggers `SubagentStop` again with `stop_hook_active: true`. The
  restated reply is what the parent receives. Cost: one extra subagent turn, cache-warm.
- `SubagentStop` returning `hookSpecificOutput.additionalContext` reaches the parent as a system
  reminder **but** the subagent also keeps replying to it (nine extra stops observed until a cap).
  Do not use it for routine verdicts.
- With `--no-session-persistence` (the bench setting) the subagent transcript named by
  `agent_transcript_path` does **not** exist at stop time; `last_assistant_message` is still delivered.
  `PostToolUse(Agent)` at launch carries `tool_input.prompt`, `tool_input.subagent_type` and
  `tool_response.agentId`, which is the same id `SubagentStop` reports as `agent_id`.
- Plugin agents do not honour `omitClaudeMd`, `hooks`, `mcpServers`, `permissionMode` (docs:
  plugins-reference). `tools:` allowlists do work and are the only prefix lever for subagents.
- Model aliases `haiku`, `sonnet`, `opus`, `fable` all resolve in headless mode here.

## 2. Roles and tiers

| Role | Who | Context contains | Never |
|---|---|---|---|
| Architect | the main session (whatever model the user runs; the design assumes the strongest) | the task, scout citations, interfaces it pins, the plan, builder reports, verify output | file bodies it will not edit itself |
| Scout | `xend-scout` (Haiku, low) | read-only search | edits |
| Builder lite | `xend-worker-lite` (Haiku, low), new | one mechanical task: exact diff, or a named function with pinned behaviour and a test to satisfy, 1-3 files | design decisions |
| Builder | `xend-worker` (Sonnet, medium) | one fully specified task | redesign, out-of-scope files |
| Reviewer | `xend-reviewer` (Sonnet, medium) | a diff | edits |
| Verifier | `scripts/subagent-stop.js` (deterministic, no model) | the subagent's final reply, its transcript, the plan | summarizing |

Escalation ladder for a plan task: `tier` as written (lite or worker) → after one failed attempt
`worker` → after a second failed attempt `worker` again → after the third, `self` (the architect
does it, or breaks it into smaller tasks). `plan next` applies this automatically.

## 3. Configuration

`scripts/lib/config.js` gains an `architect` key in every profile:

```js
architect: {
  enabled: false,        // lite
  enabled: true,         // balanced, aggressive
  minFiles: 3,           // guidance in the session block only
  minToolCalls: 8,
  verify: true,          // run the SubagentStop verifier
  verifyTimeoutMs: 120000,
  blockOnMismatch: true, // block once so the builder restates truthfully
}
```

Env: `XEND_ARCHITECT=0|1` overrides `architect.enabled`; `XEND_VERIFY=0` disables the verifier.
`.xend.json` may set any key. Session override: `/xend:plan off` sets `architect: false` for the session.

## 4. Session block (`scripts/lib/context.js`)

New constant `ARCHITECT`, injected after `DELEGATION` when `cfg.architect.enabled`. The block must stay
free of per-turn variation; the CLI path is stable per install and may be embedded. `build(cfg, opts)`
receives `opts.cliPath` (absolute path of `scripts/xend-cli.js`; `session-start.js` passes it; the
`xend-cli.js context` command passes its own path). Text (one paragraph, keep within ~230 tokens):

```
Architect mode: for work touching 3+ files or needing 8+ tool calls, plan first, then let builders build; keep file contents out of your own context. 1) Locate with xend-scout; read only the interfaces you must pin. 2) Write the plan: node "<cliPath>" plan set <<'EOF' {json} EOF — tasks small, fully specified (files, spec, verify command, tier lite=Haiku for mechanical edits / worker=Sonnet otherwise, deps). 3) node "<cliPath>" plan next prints ready briefs; dispatch each with one Agent call (subagent_type xend-worker-lite or xend-worker, prompt = the brief); put independent tasks in the same message. 4) xend re-runs every builder's verify command; a mismatch is flagged in the builder's own reply and in plan status. Trust those, not the claim. 5) Repeat plan next until empty; tasks it lists under "do yourself" are yours. 6) Run the project verify command; dispatch fix tasks for failures; then summarize. Below the size floor, work directly.
```

`xend active (...)` header gains `, architect` when enabled.

## 5. Plan file and CLI (`scripts/lib/plan.js`, `scripts/xend-cli.js`)

Location: `<session state dir>/plan.json`. The CLI resolves the session in this order: `--session <id>`
argument; `CLAUDE_SESSION_ID` or `CLAUDE_CODE_SESSION_ID` from the environment when a state directory
for that id exists *(verified: the model's Bash in headless mode sees `CLAUDE_CODE_SESSION_ID`, not
`CLAUDE_SESSION_ID`, and no `CLAUDE_PLUGIN_ROOT`)*; else the per-working-directory pointer
`<state base dir>/by-cwd/<sha1 of cwd>.json`; else `<state base dir>/latest-session.json`. Both pointer
files are `{ "id", "dir", "cwd" }`, written by `session-start.js` on every start (`dir` is the directory
actually used, so scratchpad-based state works too). `plan status` prints which session it resolved when
it did not come from `--session`.

Input schema (what the architect writes):

```json
{
  "goal": "one line",
  "verify": "python3 -m pytest -q",
  "conventions": "optional, short",
  "tasks": [
    { "id": "T1", "title": "model dataclasses", "tier": "lite",
      "files": ["ledger/model.py"], "testFiles": ["tests/test_model.py"], "deps": [],
      "spec": "exact interface and behaviour...", "verify": "python3 -m pytest -q tests/test_model.py" }
  ]
}
```

Validation (exit 1 with one message per problem): ids unique and `^[A-Za-z][\w-]*$`; `tier` in
`lite|worker` (default `worker`); `files` non-empty array of strings; `deps` reference existing ids and
form no cycle; `spec` and `verify` non-empty strings; `goal` and top-level `verify` non-empty.

Runtime fields xend adds per task: `status` (`todo|dispatched|done|failed|self`), `attempts` (subagent
attempts so far), `verified` (bool), `lastVerdict` (short string), `scopeWarnings` (array of paths).
No timestamps in the file's printed views.

Subcommands (all accept `--session <id>`; JSON via `--file <path>` or stdin):

| Command | Effect | Prints |
|---|---|---|
| `plan set` | validate and write the plan (replaces an existing one; runtime fields reset) | `plan: N tasks, M ready` then one line per task `T1 [lite] title — files: a.py, b.py — deps: none` |
| `plan status` | nothing | one line per task: `T1 done verified` / `T2 dispatched (worker, attempt 2)` / `T3 todo blocked by T1` / `T4 failed x2: <lastVerdict>` / `T5 self: <lastVerdict>`; then `verify: <project verify>`; then `scope warnings: ...` if any |
| `plan next` | marks the printed tasks `dispatched`, computes the tier from attempts | for each ready task (deps done, status todo or failed with attempts < 3): `subagent_type: xend-worker-lite` (or `xend-worker`) followed by the brief; tasks at attempts >= 3 are listed under `do yourself:` with their last verdict; prints `no ready tasks` or `plan complete` when appropriate |
| `plan next --peek` | no state change | same |
| `plan brief <id>` | nothing | the brief |
| `plan done <id> PASS|FAIL [note]` | manual verdict (the architect did it or decided) | one line |
| `plan reset <id>` | back to `todo`, attempts kept | one line |
| `plan show` | nothing | the JSON |

Brief format (exactly this; the first line is what the verifier keys on):

```
[xend task T3] <title>
Goal: <goal>
Scope: edit only <files joined by ", ">; tests you may add or edit: <testFiles or "none">
Spec:
<spec verbatim>
Verify: <verify> (must pass; xend re-runs it after you finish)
Conventions: <conventions, or omit the line>
Reply in the fixed format: Result / Changed / Verification / Notes.
```

Checkpoint integration: `scripts/lib/checkpoint.js` `render()` appends a `Plan:` section (the
`plan status` lines) when `plan.json` exists, so `/clear` and compaction keep the plan alive;
`pre-compact.js` passes the plan through.

## 6. Agents (`agents/*.md`)

All agents declare `tools:` explicitly so MCP schemas never load in a subagent. Reply formats are
contracts parsed by the verifier; wording elsewhere may change, the formats may not.

`xend-worker-lite` (new): `model: haiku`, `effort: low`, `tools: Read, Edit, Write, MultiEdit, Grep, Glob, Bash`,
`maxTurns: 25`. Description: "Applies one fully specified, mechanical change (an exact diff, or a named
function with pinned behaviour and a test to satisfy) in one to three files. Not for anything needing a
decision." Body: read only the files in scope; make the change; run the verify command; never widen scope;
if the spec is ambiguous stop with BLOCKED and say what is missing.

`xend-worker`: add `tools: Read, Edit, Write, MultiEdit, Grep, Glob, Bash`; keep `model: sonnet`,
`effort: medium`, `maxTurns: 60`.

Worker reply format (both tiers), no other text before `Result:`:

```
Result: PASS | FAIL | BLOCKED
Changed:
- <path>: <one-line summary>
Verification: <command> -> <exact summary line of its output>
Notes: <assumptions, follow-ups, or what blocked you; "none" if nothing>
```

Scout reply: one citation per line `path/to/file.ext:START-END  why (max 12 words)` or `path:LINE  why`,
or the single line `no relevant locations found`. Paths relative to the working directory.

Reader reply: `Answer:` line, `Evidence:` bullets `- <file>:<line>: <verbatim line>`, `Counts:`, `Gaps:`.

Reviewer reply: `Blocking:` / `Should fix:` bullets `- <file>:<line>: <what> -> <fix>`, `Verified OK:` line.

## 7. Verifier (`scripts/subagent-stop.js`, `scripts/lib/verify.js`)

Registered in `hooks/hooks.json` under `SubagentStop` (no matcher), timeout 180 s, with the companion
`scripts/agent-launch.js` under `PostToolUse` matcher `^Agent$` (timeout 5 s). Always exits 0; on any
internal error it prints nothing. Steps:

1. Read input. Resolve state dir and config as the other hooks do. If `cfg.architect.verify === false`
   or `XEND_VERIFY=0`: return.
2. `kind` from `agent_type` with the `xend:` prefix stripped: `xend-scout`, `xend-reader`, `xend-reviewer`
   → citation check; `xend-worker`, `xend-worker-lite` → verification check; any other agent → only if
   its transcript's first user message contains `[xend task <id>]` (then treat as a worker); else return.
3. Task id: `scripts/agent-launch.js` (PostToolUse, matcher `^Agent$`) records every launch in
   `<state>/agents.json` as `{ "<agentId>": { taskId, subagentType, prompt (first 400 chars), toolUseId } }`
   where `taskId` is the first `\[xend task ([\w-]+)\]` in `tool_input.prompt` (null when absent);
   the file is capped at the 200 most recent entries. The verifier looks `agent_id` up there; when the
   entry is missing it falls back to the agent transcript's first user message if that file exists.
   Load `plan.json`; the plan task's `verify` command is the contract and wins over the builder's stated
   command.
4. Citation check: every `path:LINE` or `path:START-END` token in `last_assistant_message` whose path
   exists relative to `cwd` (or absolute) must have `LINE`/`END` ≤ the file's line count; a path that does
   not exist at all is a bad citation. For reader evidence lines `- <file>:<line>: <text>`, the quoted text
   (whitespace-normalized, ≥ 12 chars) must be a substring of that file line, else bad. Count `checked` and
   `bad`.
5. Verification check: parse `Result:` and `Verification: <cmd> -> ...` (first ` -> ` splits). Missing
   `Result` or `Verification` on a worker reply → `verdict: malformed`. Command safety: run only when the
   command matches the allowlist `^(python3?\s+-m\s+(pytest|unittest)|pytest|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+(run\s+)?test|node\s+--test|go\s+test|cargo\s+(test|check)|make\s+(test|check)|bash\s+[\w./-]*test[\w./-]*\.sh|\./[\w./-]*test[\w./-]*\.sh|ruff|eslint|tsc|mypy|node\s+[\w./-]+\.test\.js)\b` **and** contains none of `;`, `&&`, `||`, `|`, `>`, `<`, backtick, `$(`. Otherwise `verdict: unverifiable` (recorded, never blocked, never run). Run with `cwd`, `verifyTimeoutMs`, `stdio` captured (cap 64 KB). Exit 0 ↔ PASS.
6. Verdicts: `pass` (claimed PASS, re-run exit 0), `mismatch` (claimed PASS, re-run non-zero), `fail`
   (claimed FAIL or BLOCKED; re-run not needed but run anyway when allowlisted to record), `unverifiable`,
   `malformed`, `bad-citations`.
7. Block once (only when `stop_hook_active` is false and `cfg.architect.blockOnMismatch`):
   - `mismatch`: reason = `xend re-ran "<cmd>": exit <code>. Last lines:\n<last 15 lines>\nYour Result claimed PASS. Fix it now if you can within scope, then restate your full reply truthfully in the fixed format; otherwise restate with Result: FAIL and say what fails.`
   - `malformed` (worker kinds only): reason = `Your reply must use the fixed format: Result / Changed / Verification (<command> -> <summary>) / Notes. Restate it.`
   - `bad-citations`: reason = `These citations do not exist or are out of range: <list>. Cite only ranges you actually read; correct or remove them and restate.`
   Never block on `pass`, `fail`, `unverifiable`, and never when `stop_hook_active` is true.
8. Scope: edited paths = `file_path` of every `Edit|Write|MultiEdit|NotebookEdit` tool_use in the agent
   transcript when that file exists; when it does not (session persistence off), scope is recorded as
   `null` and no warning is produced. With a plan task, paths outside `files ∪ testFiles` (normalized
   relative to `cwd`) become `scopeWarnings` on the task. Reported, never blocked.
9. Plan update (when a task id was found): `pass` → `status: done, verified: true`; `mismatch` after the
   restated reply (second stop) or `fail`/`malformed` → `status: failed, attempts += 1`,
   `lastVerdict` = short reason; `unverifiable` with claimed PASS → `status: done, verified: false`.
   Attempts increment once per subagent run, on its final stop.
10. Append one JSON line to `<state>/verify.jsonl`: `{ts, agent_id, agent_type, kind, task, claimed,
    verdict, command, exit, ms, blocked, checked, bad, scope}`.

`scripts/stats.js` reads `verify.jsonl` when present and prints a `Delegation` section: subagent runs,
verified pass, mismatches caught, unverifiable, malformed, citations checked/bad, scope warnings.

## 8. Skills

`skills/plan/SKILL.md` (user-invocable, `disable-model-invocation: true`, `allowed-tools: Bash(node *)`):
argument `[status|next|off|on]`; runs the matching CLI command and shows it; with no argument prints
`plan status` and restates the six-step protocol in one short paragraph; `off`/`on` set the session
override. `skills/route/SKILL.md` gains two sentences on the tiers and the verifier.

## 9. Doctor

`scripts/doctor.js`: one new finding when `CLAUDE_CODE_SUBAGENT_MODEL` is set in the effective settings
env or the process env: it overrides every agent's `model:` and defeats the tiering (medium impact).

## 10. Bench (built separately; see `bench/README.md`)

Arms `label:kind:model[:mode]`; `Agent` in the tool list for `project` tasks; `SCORE: p/t` partial credit;
per-model cost split; `subagent_stats` recorded. The decision comparison for this spec is
`arch-<strong>:xend:<strong>:architect` versus `solo-<strong>:baseline:<strong>` on the project tasks, with
`solo-sonnet` and `arch-sonnet` as the cheap references.

## 11. Tests

- `tests/plan.test.js`: validation errors, ready-set computation with deps, tier escalation by attempts,
  brief rendering (exact first line), `plan next` marking, `status` text.
- `tests/verify.test.js`: citation extraction and checking against a temp dir, reader verbatim check,
  worker reply parsing, command allowlist (accept/reject cases), verdict mapping, scope diff from a
  synthetic agent transcript, the block-once rule, plan update effects. The verifier must never run a
  command that fails the allowlist (assert with a command containing `;`).
- Existing tests keep passing; `claude plugin validate . --strict` passes.

## 12. Invariants

- The verifier never calls a model, never runs a non-allowlisted command, never blocks twice, never
  alters the subagent's text (a block makes the subagent restate; xend writes nothing into its reply).
- The session block stays free of per-turn variation. The CLI path is the only environment-specific
  string in it.
- Nothing in this layer changes the main session's model or effort.
- Every claim of savings comes from `bench/results/` and is written down whether or not it is favourable.

## 13. The gate (added after the first headless smoke test)

*(verified)*: with the architect paragraph in the session block and `XEND_ARCHITECT=1`, a headless
Sonnet session given a three-module package to implement did the whole task itself: 10 turns, no
plan, zero subagents, $0.28. The rule was read and ignored, exactly as JetBrains found for on-demand
skills. A behavioural rule with a strong prior against it ("just do the work") needs a mechanical
floor, or the layer never runs and cannot be measured.

`scripts/pre-edit-gate.js`, registered under `PreToolUse` with matcher `^(Write|Edit|MultiEdit)$`
(timeout 5). Config `architect.gate: true` in every profile where architect is enabled; env
`XEND_ARCHITECT_GATE=0` disables it. Behaviour, all conditions required before it acts:

1. architect enabled for the session (config and session override), gate enabled, not inside a
   subagent (`agent_id` present or `/subagents/` in the transcript path → exit).
2. no `plan.json` in the session state (a plan means the architect is doing a `self` task or a fix).
3. the gate has not fired yet this session (`<state>/gate.json`); it fires **at most once per session**,
   so the turn tax is bounded at one.
4. the file being written is not already in `<state>/edits.jsonl`, and the number of distinct files
   already there is at least `architect.minFiles - 1` (default 2): this call would be the third
   distinct file edited directly.

When all hold it writes `gate.json` and returns
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}`
with the reason (one paragraph): `xend architect mode: this would be the 3rd file you edit directly, which is above the floor. Plan the remaining work instead: node "<cliPath>" plan set <<'EOF' {goal, verify, tasks:[{id, title, tier, files, testFiles, deps, spec, verify}]} EOF, then node "<cliPath>" plan next and dispatch each brief with one Agent call (subagent_type xend-worker-lite or xend-worker). To keep editing directly, run node "<cliPath>" plan off and retry. This notice appears once.`

The CLI gains `plan off` and `plan on` (session override `architect` false/true, resolved through the
usual session lookup) so the way out never needs a session id. The session block's architect
paragraph ends with: `xend refuses the third direct file edit without a plan, once.`

Tests (`tests/gate.test.js`): fires only on the third distinct file, never twice, never with a plan
present, never inside a subagent, never when disabled; the deny JSON shape; `plan off` clears the
way. Measured effect: the smoke test above re-run after the gate.
