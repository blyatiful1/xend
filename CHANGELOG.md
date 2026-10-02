# Changelog

Claude Code updates an installed plugin only when this version changes, so every release that
changes `scripts/`, `hooks/`, `agents/` or `skills/` bumps it.

## Unreleased

### Bench

- `session-deps-16`: a long session whose later steps depend on rules and facts given only in the
  conversation, graded by the task's own `score.py` (`task_checks` in `session.js`). Bench r17:
  plain Claude Code, xend and xend in delegate mode kept every rule and fact in 6 of 6 sessions;
  delegate mode used 44.8% fewer tokens than plain Claude Code (CI -51.5% to -37.5%) at -15.4% cost
  (CI -24.5% to -3.6%).

## 0.5.0 — 2026-10-02

### Delegate mode for long sessions (opt-in)

- `/xend:delegate on` (or `XEND_DELEGATE=1`, or `{"delegate": true}` in `.xend.json`) adds one
  paragraph to the session block: hand each self-contained subtask the user gives to the new
  `xend-subtask` agent, answer quick questions directly. `xend-subtask` runs on the caller's model
  with Bash, Read, Edit, Write, Grep and Glob and replies in three lines. The setting survives
  `/clear` and compaction; architect mode takes precedence when both are on.
- Measured on Claude Sonnet 5.5 with 16 independent subtasks sent one after another into one
  session (`bench/session.js`, bench r16, 6 paired sessions per arm, every subtask done in every
  session): against plain Claude Code, xend as shipped cost **-14.6%** (95% CI -23.6% to -3.0%)
  and used 15% fewer tokens; with delegate mode on, **-50.0% tokens** (CI -54.8% to -42.9%) and
  -16.7% cost (CI -30.0% to 0.0%), and the main context never compacted (2.0 compactions per
  session for plain Claude Code, 1.67 for xend). Against xend without it, delegate mode saves 41%
  of tokens, and its cost change is within noise (-2.5%, CI -14.1% to +18.5%), so it stays opt-in.
- The new agent's one-line description adds ~50 tokens to every session; turning the mode on adds
  ~130 more.

### Bench

- `bench/session.js` replays a list of messages as one long session and records the main context
  after each, compactions, cost per message and subtask-level quality; `bench/analyze-session.js`
  reports it paired by trial. `session-multifix-16` is its first task.
- Children run with an allowlisted environment: a cloud host's `MAX_THINKING_TOKENS`,
  background-task and compaction overrides no longer reach any arm.
- Orchestration results on Sonnet 5.5 (r13-r15) are in `docs/RESULTS.md`.

## 0.4.0 — 2026-09-28

### Cache lifetime

- `/xend:stats --cache-ttl [--days N]` replays your own transcripts (all projects, main
  conversation, last 30 days by default) at the 5-minute and the 1-hour prompt-cache lifetime and
  says which would have cost less for the way you work.
- Measured on the bench with nothing but `CLAUDE_CODE_PROMPT_CACHE_TTL` different (no plugin in
  either arm, `bench/results/r12-*`): the 5-minute lifetime cost **-25.0%** per short task (95% CI
  -26.4% to -23.6%, cheaper in 42 of 42 pairs, same pass rate) and -12.2% on the three project
  tasks (3 of 3 cheaper, all hidden tests passing). This holds only without pauses over five
  minutes: one long interactive session of this project would have cost 1.4% more.
- `/xend:doctor` no longer claims the default is the 5-minute cache (on a subscription it is one
  hour) or recommends the 1-hour cache for everyone; it points to the replay.

### Shaping

- Past the size limit, output is folded before it is cut: grep/rg hits with the same text in one
  file go on one line listing every line number (lossless), log lines that differ only in numbers
  keep their first and last occurrence with a count, and a head and tail cut keeps the error
  lines from the middle. A long `grep` of a log no longer loses the one ERROR line in its middle;
  on 44 real command outputs, what the model sees fell from -28.3% to -53.4% against raw with no
  decisive line lost (rtk on the same outputs: -32.7%, 13 lost).
- The `[xend]` marker calls a result complete only when nothing but known noise was removed; a
  folded or cut result says it is not the whole output and always names the full original.
- Whitespace is left alone: trailing spaces and blank lines are content in a diff, a failed
  assertion, or `cat` output copied into an Edit. Diffs are kept byte for byte apart from colour
  codes, and a line of dashes (a YAML separator) is no longer taken for a spinner frame.
- A change that cannot save more than its own marker line is not made (a diff used to grow by
  its marker).
- `node --test` output is recognised as a test run: passing tests and their detail blocks drop,
  failures keep theirs, and its middle is never cut.

### Fixes

- The verifier treats a project script that is missing or committed without its exec bit
  (`./run_tests.sh`) as a real failure; only a runner missing from the machine is unverifiable.
- `/xend:stats` finds transcripts under `CLAUDE_CONFIG_DIR` when it is set.

### Docs

- The README is rewritten around what a long day of Claude Code costs and how to make it cost
  less: headline numbers, first commands, habits that save turns and cache, and what was tested
  and left out. Every run moved to `docs/RESULTS.md` and the full rules to `docs/GUARANTEES.md`,
  unchanged.

### Bench

- `--arms-file` entries set their `env` on baseline arms too and can pass extra `claude`
  arguments (`args`); an ambient cache-lifetime setting is removed from every child; each run
  records which lifetime its cache writes were billed at.
- `--help` prints usage, and an unknown argument stops the run before any paid job starts.

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
  session naming the allow rule to add (the exact command, or the runner's own words such as
  `Bash(npm test:*)`; never a bare interpreter); the model gets nothing. Allow rules count only
  from managed settings, the user's settings and the project root (a nested repository's
  `.claude/` can add deny rules only), match literally as Claude Code does, and respect
  `allowManagedPermissionRulesOnly`. Trust and the auto-test settings are resolved when the hook
  runs, never from the model-writable session cache.
- Commands run without a shell (globs expanded as bash would), and must pass an allowlist of
  runners and flags with project-relative paths: a verify line like `pytest --basetemp=$HOME` or
  `npm test\ntouch x` is refused, `ruff` may only check, `tsc` needs `--noEmit`, npm/pnpm/yarn may
  run only the `test` script (so `npm run test:unit` is recorded as unverifiable, not re-run), and
  make only its `test` or `check` target. A command that
  xend cannot start on the machine (missing or not executable) is recorded as unverifiable, not
  as a failure; a check that ran and exited 126 or 127 is an ordinary failure.
- A repository's `.xend.json` can no longer turn the auto-test on (by any value, or by choosing
  a profile), choose its command, trust it, or stretch its timeouts. Timeouts are capped below the
  hook timeouts.
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
  directory the hooks use, and so do the architect's own `plan set` / `plan next` commands.
  `/xend:plan on` actually turns architect mode on; `/xend:plan` accepts only status, next, on and
  off.
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
