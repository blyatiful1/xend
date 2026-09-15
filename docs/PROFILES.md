# Profiles and configuration

xend resolves its configuration in this order (later wins):

1. profile defaults (`lite`, `balanced`, `aggressive`), see `scripts/lib/config.js`
2. `~/.config/xend/config.json` (user; `$XDG_CONFIG_HOME/xend/config.json` when set)
3. the nearest `.xend.json` walking up from the working directory (project)
4. environment variables: `XEND_PROFILE`, `XEND_TERSE`, `XEND_SHAPE=0`, `XEND_SHAPE_MAX_CHARS`, `XEND_DEDUPE=0`, `XEND_DELEGATION=0`, `XEND_CHECKPOINT=0`, `XEND_READING=0`, and per-transform kill switches `XEND_SHAPE_TESTRUNNERS=0`, `XEND_SHAPE_PKG=0`, `XEND_SHAPE_HEADTAIL=0`, `XEND_SHAPE_ANSI=0`, `XEND_SHAPE_MCP=0`
5. session overrides set by skills (`/xend:terse off` and friends), stored in the session state directory

Any layer may set `"profile"` and override individual keys. Example `.xend.json` for a repo whose test output is the signal you want to keep in full:

```json
{ "profile": "balanced", "shape": { "testRunners": false, "maxChars": 12000 }, "terse": "lite" }
```

## What each profile turns on

| Key | lite | balanced (default) | aggressive |
|---|---|---|---|
| `terse` | `lite` | `full` | `full` |
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
