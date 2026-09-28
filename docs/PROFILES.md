# Profiles and configuration

xend resolves its configuration in this order (later wins):

1. profile defaults (`lite`, `balanced`, `aggressive`), see `scripts/lib/config.js`
2. `~/.config/xend/config.json` (user; `$XDG_CONFIG_HOME/xend/config.json` when set)
3. the nearest `.xend.json` walking up from the working directory (project)
4. environment variables: `XEND_PROFILE`, `XEND_TERSE`, `XEND_SHAPE=0`, `XEND_SHAPE_MAX_CHARS`, `XEND_DEDUPE=0`, `XEND_DELEGATION=0`, `XEND_CHECKPOINT=0`, `XEND_READING=0`, `XEND_AUTOTEST=0|1`, `XEND_AUTOTEST_CMD=<allowlisted command>`, and per-transform kill switches `XEND_SHAPE_TESTRUNNERS=0`, `XEND_SHAPE_PKG=0`, `XEND_SHAPE_HEADTAIL=0`, `XEND_SHAPE_ANSI=0`, `XEND_SHAPE_MCP=0`, plus the lean-rules switches `XEND_PONYTAIL=off|lite|full|ultra`, `XEND_PONYTAIL_TEXT=adapted|upstream`, `XEND_UPSTREAM_PONYTAIL=auto|yield|ignore`, `XEND_PONYTAIL_STRICT=1`, and the architect switches `XEND_ARCHITECT=0|1` (overrides `architect.enabled`), `XEND_VERIFY=0` (disables the `SubagentStop` verifier), `XEND_ARCHITECT_GATE=0` (disables the `PreToolUse` gate)
5. session overrides set by skills (`/xend:terse off`, `/xend:ponytail ultra`, `/xend:plan off|on` and friends), stored in the session state directory

Any layer may set `"profile"` and override individual keys. Example `.xend.json` for a repo whose test output is the signal you want to keep in full:

```json
{ "profile": "balanced", "shape": { "testRunners": false, "maxChars": 12000 }, "terse": "lite" }
```

## What each profile turns on

| Key | lite | balanced (default) | aggressive |
|---|---|---|---|
| `terse` | `lite` | `full` | `full` |
| `ponytail` (lean build rules: ladder, root-cause fixes, no unrequested abstraction; opt-in since bench r8) | `off` | `off` | `off` |
| `ponytailText` (used when `ponytail` is on: **`adapted` is xend's condensation; `upstream` is the upstream-verbatim text JetBrains measured**) | `adapted` | `adapted` | `adapted` |
| `upstream.ponytail` (`auto` defers to an installed, injecting ponytail plugin; `yield` always defers; `ignore` never does) | `auto` | `auto` | `auto` |
| `ponytailStrict` (drop every xend-authored bridging sentence so the ponytail portion is byte-identical to upstream's own hook output; for replication runs) | `false` | `false` | `false` |
| `shape.maxChars` (beyond this, generic output and searches are folded, then cut to head and tail with error lines kept; never diffs or test runs) | 30000 (native cap only) | 12000 | 8000 |
| `shape.stripAnsi` (skipped for terminal-facing commands), progress bars, blank runs, `collapseRepeats` (4+ identical lines, count kept) | on | on | on |
| `shape.testRunners` (drop known passing/progress rows only; outputs of 60+ lines) | off | on | on |
| `shape.packageManagers` (drop download/resolve chatter; warnings and errors kept) | off | on | on |
| `shape.jsonMinify` | off | off | off |
| `shape.dedupe` (Bash only; byte-identical repeat of at least `dedupeMinChars` within `dedupeWindow` calls; first 10 lines kept) | on, window 12, 2000 chars | on, window 12, 2000 chars | off (server-side clearing may remove the referenced result) |
| `shape.grepMaxLines` / `shape.globMaxFiles` (true totals always kept) | off | 400 / 400 | 250 / 250 |
| `shape.readLimitMinLines` (PreToolUse: unranged Read of a file with at least N lines becomes a ranged read of `readLimit` lines) | off | off | 800 lines, limit 250 |
| `shape.mcp` (shape MCP tool text results) | off | off | on |
| `delegation` (kept for configs that set it; the session block no longer advertises subagents) | on | on | on |
| `autoTest.enabled` (after an Edit/MultiEdit in the main session, run the project's quick tests and attach the result so the model skips its own test turn; allowlisted commands only, and only one Claude Code would run without asking: an allow rule matches it, the session is in `bypassPermissions` mode, or `trustTestCommands` is on; a deny or ask rule always wins; switched off for the session when a run exceeds `autoTest.maxMs`) | off | on | on |
| `autoTest.command` (empty = detect: pytest when Python tests exist, else `npm test` with a real test script, else `node --test` with `*.test.js` files) / `maxMs` / `timeoutMs` (capped at 25 s, under the hook's 30 s) / `maxChars` | `''` / 8000 / 20000 / 1200 | same | same |
| `trustTestCommands` (let hooks run the detected test command, and SubagentStop's re-runs, without an allow rule; `XEND_TRUST_TESTS=1`) | false | false | false |
| `checkpoint` (PreCompact checkpoint, re-injected on compact/clear) | on | on | on |
| `contextEditing` (server-side clearing of old tool results via `CLAUDE_CODE_EXTRA_BODY`) | off | off | on: trigger 110k input tokens, keep 12 tool uses, clear at least 40k |
| `architect.enabled` (plan-then-build: the main model plans, cheap subagents build in disposable contexts) (opt-in: XEND_ARCHITECT=1, .xend.json, or /xend:plan on; docs/ARCHITECTURE.md L7) | false | false | false |
| `architect.minFiles` / `architect.minToolCalls` (guidance floor named in the session block; `minFiles` also sets the gate's file threshold) | 4 / 8 | 4 / 8 | 4 / 8 |
| `architect.verify` (`SubagentStop` re-runs each builder's own verify command instead of trusting its claim) | true | true | true |
| `architect.verifyTimeoutMs` (capped at 170 s, under the hook's 180 s) | 120000 | 120000 | 120000 |
| `architect.blockOnMismatch` (a mismatched or malformed reply is blocked once so the builder restates truthfully) | true | true | true |
| `architect.gate` / `architect.gateMaxDenials` (`PreToolUse` denies a direct edit once a plan is above the file floor and no plan exists yet; bounded to this many denials per session) | true / 3 | true / 3 | true / 3 |

### What a repository's `.xend.json` may set

A `.xend.json` (or `.xend/config.json`) found walking up from the working directory is part of the
repository, so it cannot decide which command a hook runs without a prompt, or for how long:
`autoTest.enabled: true`, `autoTest.command`, `autoTest.timeoutMs`, `autoTest.maxMs`,
`trustTestCommands` and `architect.verifyTimeoutMs` are ignored there (and listed as
`ignoredProjectKeys` in `node scripts/xend-cli.js config`). It can still turn the auto-test off.
Set those keys in `~/.config/xend/config.json` or through `XEND_*` variables instead.

## Session state

Per-session files live in the first of: `$XEND_STATE_DIR/<session-id>`, `<scratchpad_dir>/xend` (Claude Code's per-session scratch directory, when the hook input provides it), `$CLAUDE_PLUGIN_DATA/sessions/<session-id>`, `<tmpdir>/xend-<uid>/<session-id>`. Directories are created `0700` and files `0600`, since saved tool output can hold secrets.

| File | Purpose |
|---|---|
| `tool-<id>.txt` | full original of a shaped tool result (the path named in the `[xend]` marker) |
| `config.json` | the configuration resolved at session start (per-call hooks read this instead of walking the filesystem) |
| `dedupe.json` | registry of recent Bash commands and output hashes; reset on compact/clear |
| `edits.jsonl` | files touched by Edit/Write, recorded exactly (the transcript is written with a lag) |
| `autotest.json` | the auto-test's last result signature, run count, and whether it switched itself off (slow suite, missing runner) |
| `tool-autotest-<id>.txt` | full output of an auto-test run whose note was capped |
| `shaping.jsonl` | one record per shaped result (chars before/after, transform kinds) and one per recovery (the model read a persisted original) |
| `checkpoint.md` | written by the PreCompact hook and by `/xend:checkpoint`; re-injected after compact/clear |
| `session.json` | overrides set by skills for this session |
| `plan.json` | the architect plan: goal, project verify command, tasks with their runtime status, attempts, verified flag, scope warnings (`docs/ARCHITECTURE.md` L7) |
| `agents.json` | launch registry written by `scripts/agent-launch.js` at `PostToolUse(Agent)`: `agentId -> { taskId, subagentType, prompt, toolUseId }`, capped at 200 entries; lets `SubagentStop` recover a task id even when the subagent's own transcript was never written to disk |
| `verify.jsonl` | one record per `SubagentStop` verification: agent, kind, task, claimed result, verdict, command, exit code, duration, whether it blocked, citations checked/bad, scope warnings; read by `scripts/stats.js` |
| `gate.json` | `{ denials, files }` written by `scripts/pre-edit-gate.js` each time it denies a direct edit, up to `architect.gateMaxDenials` times per session |
| `permission-hints.json` | which "add this allow rule" notes the user has already been shown this session |
| `limited-read-<id>.json` | one per Read that `pre-read.js` limited, consumed by the PostToolUse hook for its "file has N lines" note |

Session directories older than 7 days are pruned at session start.

Pointer files live at the *state base directory* (`$XEND_STATE_DIR`, `$CLAUDE_PLUGIN_DATA/sessions`, or `<tmpdir>/xend-<uid>`), written by `session-start.js` on every start so the CLI finds the directory the hooks use: `by-session/<session-id>.json` (`{ id, dir, cwd }`), `latest-session.json` (the most recent start) and `by-cwd/<sha1 of cwd>.json` (keyed by working directory, so `plan next` run from a shell in the project's directory finds the right session). Hooks get `CLAUDE_PLUGIN_DATA` (and sometimes `scratchpad_dir`); the Bash tool that runs a skill's command gets neither, so skills pass the substituted `${CLAUDE_PLUGIN_DATA}` to the CLI as `--data` and the CLI follows the `by-session` pointer.

## Native settings written by `/xend:setup <profile> --with-recommended`

`/xend:setup` with no arguments is a dry run of `balanced`. A settings file that does not parse (a
comment, a trailing comma) is never overwritten: setup stops and names it. Every file it changes is
backed up first, and `/xend:setup --undo` restores the latest backup. It installs the upstream
ponytail plugin only with `--install-ponytail`, never as part of `--with-recommended`, and it does
not set `promptCacheTtl`: the 1-hour cache costs 2x input per cache write against 1.25x for 5
minutes, which pays off only when you pause more than 5 minutes between turns.

| Setting | Value | Why |
|---|---|---|
| `bashOutputMaxChars` | 20000 | native head-only cap (default 30,000); the full output is still persisted to a file by Claude Code |
| `env.MAX_MCP_OUTPUT_TOKENS` | `10000` | MCP results default to a 25,000-token cap |
| `env.CLAUDE_CODE_EXTRA_BODY` | context editing body | only on `aggressive`; removed when switching back; each clearing pass re-caches the remaining context, so it pays off on sessions that continue about 20 or more turns after a pass |
| `# Compact instructions` section in `~/.claude/CLAUDE.md` | with `--compact-instructions` | the native way to steer compaction (PreCompact hooks cannot): keep exact paths, commands, failing test names, decisions; drop narration |

Project scope writes `.claude/settings.local.json` so experimental env vars never reach teammates through a committed file; `--scope project-shared` targets `.claude/settings.json` explicitly.

`/xend:setup` never sets `effortLevel` or `model` globally: effort is a quality lever and belongs to the task (`/effort` per session), and switching the main model mid-session invalidates the prompt cache. `/xend:setup --undo` restores the most recent backup.

## Upstream ponytail

The lean build rules come from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT,
Dietrich Gebert). xend's design rule is that **the ruleset reaches the model exactly once per
session, from whichever source is authoritative on this machine**. At SessionStart xend looks for
an upstream install through four channels, in order:

| Channel | What it looks at |
|---|---|
| `plugin` | `~/.claude/plugins/installed_plugins.json` for a key whose name part is `ponytail`, then that install's manifest (`hooks` as a string path or an object) for a non-empty `SessionStart` array. `enabledPlugins` in the four settings files can disable it; absent means enabled. |
| `skills-dir` | `~/.claude/skills/ponytail/` or `<project>/.claude/skills/ponytail/` containing `.claude-plugin/plugin.json` with `name: ponytail`. |
| `skill-only` | The same folder with a bare `SKILL.md` and no manifest. This is the configuration JetBrains measured as **self-activating zero times**, so it counts as installed but *not* injecting, and xend keeps ownership. |
| `settings-hook` | A `SessionStart` hook command matching `ponytail-activate.js` in any settings file. |

The level upstream would run at comes from `PONYTAIL_DEFAULT_MODE`, else
`$XDG_CONFIG_HOME/ponytail/config.json` (`.defaultMode`), else `full`. `~/.claude/.ponytail-active`
is read as corroboration only: it survives an uninstall, and hook order within one SessionStart is
not guaranteed, so it never makes a detection on its own.

Ownership, and what the block looks like at `balanced` (bytes; this text tokenizes at roughly 2.7
characters per token):

| Situation | xend's session block |
|---|---|
| nothing injecting, `ponytail: off` (the default in every profile since bench r8) | 709 B |
| nothing injecting, `ponytail: full`, adapted text | 1,144 B: the lean paragraph with its level line |
| nothing injecting, `ponytailText: upstream` | 6,216 B: the upstream-verbatim ruleset plus three ` [xend]` reconciliation tags and the bridging sentence |
| same, with `ponytailStrict` | 5,963 B: the ponytail portion is byte-identical to upstream's own hook output |
| upstream is injecting | 1,049 B — xend emits a short note instead of a second copy; upstream adds its own ~5,252 B / 1,382 tok |
| upstream is installed with mode `off` | 709 B — xend injects nothing either; the user configured one source of truth |

`upstream.ponytail` switches this: `auto` uses the detection above, `yield` always defers (for a
channel xend cannot see, such as a Cursor rule or an enterprise-managed settings layer), and
`ignore` behaves as if upstream were absent.

No profile turns lean rules on by default any more. Bench r8 found xend's adapted text no cheaper on short tasks and behind a pass-rate drop on one adversarial task (the model left a required value blank; lean on 3 of 6 passes, lean off 3 of 3), and bench r5 measured the upstream-verbatim text at +16.7% cost and +8.6% output tokens on five-turn tasks. Turn them on with `/xend:ponytail full` or `XEND_PONYTAIL=full`; add `XEND_PONYTAIL_TEXT=upstream` for the text JetBrains measured, and use that where their result applies: long, code-heavy sessions. `/xend:doctor` reports the active text as `text: adapted` or `text: upstream-verbatim (measured)`.

xend ships **no** `SubagentStart` hook and does not port upstream's: it would add ~1,382 tokens to
every subagent call, including the Haiku builders whose whole purpose is to be cheap. If an upstream install has one, `/xend:doctor` reports it; there is no xend-side remedy.

Detection depends on undocumented Claude Code internals and is verified against one build. Every
read is guarded and degrades to "not installed", so a CLI change produces a visible duplicate
ruleset, never a silent loss of it. `/xend:doctor` reports the paths it checked and found nothing
in, rather than asserting there is no upstream.
