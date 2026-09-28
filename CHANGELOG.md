# Changelog

Claude Code updates an installed plugin only when this version changes, so every release that
changes `scripts/`, `hooks/`, `agents/` or `skills/` bumps it.

## 0.3.0 — 2026-09-28

### Cheaper per session

- The per-session footprint fell from about 1,400 to about 413 cache-write tokens: a 709-byte
  session block, lean (ponytail) rules opt-in, the scout/reader/reviewer agents moved to
  `extras/`, the `route` skill removed.
- Auto-test: after an `Edit`, the project's quick tests run and the result reaches the model with
  the edit, which saves the separate test turn (bugfix tasks: four turns to three).
- Measured with the paired bench (Sonnet 5, `bench/results/r8-*` to `r11-*`): short tasks
  **-9.1%** cost against 0.2.0 (95% CI -12.7% to -4.7%); against no plugin -1.2% (95% CI -4.4%
  to +3.1%, not a significant difference). Long project tasks: about -16% against no plugin, on
  3 tasks x 2 trials, too few to call. The pass-rate gain against no plugin reported with these
  runs comes from two tasks whose graders reject correct answers; until they are fixed, read it
  as no quality loss, not a gain.

### Safety

- The auto-test and the SubagentStop verifier run a command only when Claude Code itself would
  run it without asking: an allow rule matches it, the session is in `bypassPermissions` mode, or
  the user opted in (`"trustTestCommands": true` in `~/.config/xend/config.json`, or
  `XEND_TRUST_TESTS=1`). A deny or ask rule always wins. Otherwise the user gets one line per
  session naming the allow rule to add; the model gets nothing. Managed settings,
  `CLAUDE_CONFIG_DIR` and the project root (`CLAUDE_PROJECT_DIR`) are now read for these rules.
- Commands run without a shell, and must pass an allowlist of runners and flags with project-
  relative paths: a verify line like `pytest --basetemp=$HOME` or `npm test\ntouch x` is refused.
- A repository's `.xend.json` can no longer turn the auto-test on, choose its command, trust it,
  or stretch its timeouts. Timeouts are capped below the hook timeouts.
- SubagentStop returns at once for subagents that are not xend's and do not belong to the
  session's plan (it used to wait about 0.6 s for each) and never promotes an unrelated
  subagent's `Task:` line.
- `/xend:setup --with-recommended` no longer installs the third-party ponytail plugin (that takes
  `--install-ponytail`) and no longer sets `promptCacheTtl` to `1h`.
- State directories are created `0700` and files `0600`; the temp-dir fallback is per user
  (`<tmpdir>/xend-<uid>`).
- Skills pre-approve only their own script (`Bash(node *scripts/xend-cli.js*)` and so on)
  instead of `Bash(node *)`.
- The aggressive profile's read limiter no longer pre-approves reads outside the project.

### Fixes

- `/xend:terse`, `/xend:ponytail` and `/xend:setup` receive their arguments (they used to ignore
  them and store `full`, show `status`, or run `balanced --dry-run` every time). With no argument
  they show the current value (setup: a dry run of `balanced`).
- Settings made from skills (`/xend:terse`, `/xend:ponytail`, `/xend:plan on|off`,
  `/xend:checkpoint` notes) reach the hooks in a plugin install: the CLI now finds the state
  directory the hooks use. `/xend:plan on` actually turns architect mode on.
- `/xend:setup` stops without writing when a settings file does not parse, instead of replacing
  it; it backs up every file it changes, accepts a UTF-8 byte-order mark, and `--undo` keeps the
  file it replaces.
- Shaping and the auto-test work on the main thread of `claude --agent` sessions.
- Parallel limited reads each keep their "file has N lines" note; a final newline no longer
  counts as an extra line.
- A missing test runner (exit 127) switches the auto-test off quietly.

### Upgrade notes

- If you relied on the auto-test, approve your test command once with "don't ask again" (or add
  e.g. `Bash(npm test:*)` to `permissions.allow`); until then it does not run.
- Keys ignored from a repository's `.xend.json` are listed as `ignoredProjectKeys` in
  `node scripts/xend-cli.js config`.

## 0.2.0 — 2026-09-15

The last version before this changelog; see the git history up to blyatiful1/xend#4.
