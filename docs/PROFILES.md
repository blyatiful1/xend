# Profiles and configuration

xend resolves its configuration in this order (later wins):

1. profile defaults (`lite`, `balanced`, `aggressive`), see `scripts/lib/config.js`
2. `~/.config/xend/config.json` (user; `$XDG_CONFIG_HOME/xend/config.json` when set)
3. the nearest `.xend.json` walking up from the working directory (project)
4. environment variables: `XEND_PROFILE`, `XEND_TERSE`, `XEND_SHAPE=0`, `XEND_SHAPE_MAX_CHARS`, `XEND_DEDUPE=0`, `XEND_DELEGATION=0`, `XEND_CHECKPOINT=0`, `XEND_READING=0`, and per-transform kill switches `XEND_SHAPE_TESTRUNNERS=0`, `XEND_SHAPE_PKG=0`, `XEND_SHAPE_HEADTAIL=0`, `XEND_SHAPE_ANSI=0`, `XEND_SHAPE_MCP=0`, plus the lean-rules switches `XEND_PONYTAIL=off|lite|full|ultra`, `XEND_PONYTAIL_TEXT=adapted|upstream`, `XEND_UPSTREAM_PONYTAIL=auto|yield|ignore`, `XEND_PONYTAIL_STRICT=1`
5. session overrides set by skills (`/xend:terse off`, `/xend:ponytail ultra` and friends), stored in the session state directory

Any layer may set `"profile"` and override individual keys. Example `.xend.json` for a repo whose test output is the signal you want to keep in full:

```json
{ "profile": "balanced", "shape": { "testRunners": false, "maxChars": 12000 }, "terse": "lite" }
```

## What each profile turns on

| Key | lite | balanced (default) | aggressive |
|---|---|---|---|
| `terse` | `lite` | `full` | `full` |
| `ponytail` (lean build rules: ladder, root-cause fixes, no unrequested abstraction) | `lite` | `full` | `full` |
| `ponytailText` (**`adapted` is xend's condensation; `upstream` is the upstream-verbatim text JetBrains measured, opt-in in every profile after bench r5 measured +16.7% cost on micro-tasks**) | `adapted` | `adapted` | `adapted` |
| `upstream.ponytail` (`auto` defers to an installed, injecting ponytail plugin; `yield` always defers; `ignore` never does) | `auto` | `auto` | `auto` |
| `ponytailStrict` (drop every xend-authored bridging sentence so the ponytail portion is byte-identical to upstream's own hook output; for replication runs) | `false` | `false` | `false` |
| `shape.maxChars` (head+tail beyond this, generic output kinds only; never diffs or test runs) | 30000 (native cap only) | 12000 | 8000 |
| `shape.stripAnsi` (skipped for terminal-facing commands), progress bars, blank runs, `collapseRepeats` (4+ identical lines, count kept) | on | on | on |
| `shape.testRunners` (drop known passing/progress rows only; outputs of 60+ lines) | off | on | on |
| `shape.packageManagers` (drop download/resolve chatter; warnings and errors kept) | off | on | on |
| `shape.jsonMinify` | off | off | off |
| `shape.dedupe` (Bash only; byte-identical repeat of at least `dedupeMinChars` within `dedupeWindow` calls; first 10 lines kept) | on, window 12, 2000 chars | on, window 12, 2000 chars | off (server-side clearing may remove the referenced result) |
| `shape.grepMaxLines` / `shape.globMaxFiles` (true totals always kept) | off | 400 / 400 | 250 / 250 |
| `shape.readLimitMinLines` (PreToolUse: unranged Read of a file with at least N lines becomes a ranged read of `readLimit` lines) | off | off | 800 lines, limit 250 |
| `shape.mcp` (shape MCP tool text results) | off | off | on |
| `delegation` (subagents advertised in the session block) | on | on | on |
| `checkpoint` (PreCompact checkpoint, re-injected on compact/clear) | on | on | on |
| `contextEditing` (server-side clearing of old tool results via `CLAUDE_CODE_EXTRA_BODY`) | off | off | on: trigger 110k input tokens, keep 12 tool uses, clear at least 40k |

## Session state

Per-session files live in the first of: `$XEND_STATE_DIR/<session-id>`, `<scratchpad_dir>/xend` (Claude Code's per-session scratch directory, when the hook input provides it), `$CLAUDE_PLUGIN_DATA/sessions/<session-id>`, `<tmpdir>/xend/<session-id>`.

| File | Purpose |
|---|---|
| `tool-<id>.txt` | full original of a shaped tool result (the path named in the `[xend]` marker) |
| `config.json` | the configuration resolved at session start (per-call hooks read this instead of walking the filesystem) |
| `dedupe.json` | registry of recent Bash commands and output hashes; reset on compact/clear |
| `edits.jsonl` | files touched by Edit/Write, recorded exactly (the transcript is written with a lag) |
| `shaping.jsonl` | one record per shaped result (chars before/after, transform kinds) and one per recovery (the model read a persisted original) |
| `checkpoint.md` | written by the PreCompact hook and by `/xend:checkpoint`; re-injected after compact/clear |
| `session.json` | overrides set by skills for this session |

Session directories older than 7 days are pruned at session start.

## Native settings written by `/xend:setup <profile> --with-recommended`

| Setting | Value | Why |
|---|---|---|
| `promptCacheTtl` | `1h` | pauses longer than 5 minutes would otherwise miss the cache and re-write the whole prefix (write cost 2x instead of 1.25x; already the default on subscriptions within included usage; skip on an API key with continuous traffic) |
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

Ownership, and what the block looks like at `balanced`:

| Situation | xend's session block |
|---|---|
| nothing injecting, `ponytail: off` | 1,549 B / 408 tok — byte-identical to a build without this feature |
| nothing injecting, adapted text | 2,578 B / 678 tok: the lean paragraph, the level line, and the bridging sentence |
| nothing injecting, `ponytailText: upstream` | 7,056 B / 1,857 tok: the upstream-verbatim ruleset plus three ` [xend]` reconciliation tags |
| same, with `ponytailStrict` | 6,803 B / 1,790 tok: the ponytail portion is byte-identical to upstream's own hook output |
| upstream is injecting | 1,892 B / 498 tok — xend emits a short note instead of a second copy; upstream adds its own ~5,252 B / 1,382 tok |
| upstream is installed with mode `off` | 1,549 B / 408 tok — xend injects nothing either; the user configured one source of truth |

`upstream.ponytail` switches this: `auto` uses the detection above, `yield` always defers (for a
channel xend cannot see, such as a Cursor rule or an enterprise-managed settings layer), and
`ignore` behaves as if upstream were absent.

No profile selects `ponytailText: upstream` by default. Setting it (config, `XEND_PONYTAIL_TEXT=upstream`, or `/xend:ponytail` with the session override) swaps xend's ~215-token adaptation for upstream's ~1,382-token verbatim text; bench run r5 measured that swap at +16.7% cost and +8.6% output tokens on five-turn tasks, so use it only where the JetBrains result applies: long, code-heavy sessions. `/xend:doctor` reports the active text as `text: adapted` or `text: upstream-verbatim (measured)`.

xend ships **no** `SubagentStart` hook and does not port upstream's: it would add ~1,382 tokens to
every `xend-scout` and `xend-reader` call, which are Haiku subagents whose whole purpose is to be
cheap. If an upstream install has one, `/xend:doctor` reports it; there is no xend-side remedy.

Detection depends on undocumented Claude Code internals and is verified against one build. Every
read is guarded and degrades to "not installed", so a CLI change produces a visible duplicate
ruleset, never a silent loss of it. `/xend:doctor` reports the paths it checked and found nothing
in, rather than asserting there is no upstream.
