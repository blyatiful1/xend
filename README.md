# xend

**Make your Claude Code usage go further.**

For people who keep Claude Code working for hours a day. xend is a plugin that makes each task
cost less: the model takes fewer turns, re-reads less, keeps shorter command output without
losing the line that matters, and ends tasks cleanly instead of dragging a huge context along.
It also tells you which cache setting is cheaper for the way *you* work. Every number below comes
from paired runs against plain Claude Code, and the misses are published next to the wins.

No proxy, no daemon, no database, no account. Node.js 18+ is the only dependency.

## At a glance

Measured in paired runs, the same tasks in every arm of one pass. The first two rows are 0.5.0 on Claude Sonnet 5.5; the rest are Claude Sonnet 5 (plugin rows on 0.3.0; 0.4.0 changes only output shaping, checked on real outputs in the last row):

| Where | Result |
|---|---|
| Long sessions (16 independent subtasks in one session, Sonnet 5.5) | **-14.6% per session** against plain Claude Code (95% CI -23.6% to -3.0%), 15% fewer tokens, every subtask done in both (6 paired sessions) |
| The same long sessions with `/xend:delegate on` | **-50% tokens** (CI -55% to -43%) and -16.7% cost (CI -30.0% to 0.0%) against plain Claude Code; the main context never compacted (2.0 compactions per session without it); every subtask done |
| Long builds (multi-file projects, ~25 turns) | **-15.9% per task** against plain Claude Code, every hidden test passing in both (6 paired runs; 95% CI -39.6% to -2.5%) |
| Short tasks (bugfix, feature, Q&A, ~4 turns) | cost-neutral (-1.2%, CI -4.4% to +3.1%), with the pass rate up from 91.7% to 96.4% and 11.6% fewer output tokens (84 paired runs) |
| xend 0.3.0 against 0.2.0 | **-9.1%** on short tasks (CI -12.7% to -4.7%) |
| The right cache lifetime, for back-to-back work | **-25.0%** (CI -26.4% to -23.6%, 42 of 42 pairs cheaper, same pass rate). A Claude Code setting; xend replays your own sessions to tell you whether it suits you |
| Command output the model has to read | -53% on 44 real outputs (test runs, logs, greps, diffs), with no decisive line lost. rtk on the same outputs: -33%, with 13 lost |

These are billed costs at API list prices, the only thing a benchmark can measure. Anthropic
doesn't publish how plan usage weighs each kind of token, so read them as the direction and rough
size of the effect on your plan, not an exact count of extra prompts. Every run, with its raw
data: [`docs/RESULTS.md`](docs/RESULTS.md).

## Where your usage actually goes

Every turn sends the whole conversation again. New tokens are written to the prompt cache, and
everything before them is read back. Across 2,848 billed Claude Code runs, cache writes and reads
were about **80%** of the bill; all command and tool output together was **3.3%**
([arXiv 2607.12161](https://arxiv.org/abs/2607.12161)). So:

- **A saved turn beats a shorter answer.** Skipping one turn skips a full re-read of the context.
- **What loads every session is paid over and over.** It is written once and re-read on every
  turn, so a plugin's own instructions have to be tiny. xend adds about 413 tokens.
- **Compressing command output alone rarely pays.** Tools that do only that tend to cost more,
  because the model takes extra turns to recover what was cut (rtk: +7.6% cost at low effort in
  JetBrains' paired test).

xend is built in that order.

## Install

Inside Claude Code:

```
/plugin marketplace add blyatiful1/xend
/plugin install xend@xend
```

Or from a shell:

```bash
curl -fsSL https://raw.githubusercontent.com/blyatiful1/xend/main/install.sh | bash
```

Or try it on a single session without installing: `claude --plugin-dir /path/to/xend`.

## Your first session

```
/xend:doctor                              find what wastes tokens on this machine (offline, changes nothing)
/xend:stats                               what the last session spent, where, and what xend removed
/xend:stats --cache-ttl                   replay your last 30 days at both cache lifetimes: which is cheaper for you
/xend:setup balanced --with-recommended   apply the profile and recommended settings (backup + diff first)
```

## Habits that make a session last longer

These cost nothing and are backed by the measurements above or by Claude Code's own
documentation:

- **Pick the cache lifetime that fits how you work.** On a subscription Claude Code keeps its
  cache for an hour, and each write costs twice the input price. `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`
  makes writes 37.5% cheaper, which cut short tasks run back to back by 25%. But after any pause
  longer than five minutes the whole context is written again. `/xend:stats --cache-ttl` tells you
  which way your own sessions lean. Use 5 minutes for `claude -p`, scripts and CI.
- **End a task with `/clear`, not `/compact`.** Compaction re-reads the whole conversation and
  starts the cache cold. xend saves a checkpoint (edited files, test commands, decisions) and puts
  it back after `/clear`, so the next task starts small without starting blind.
- **Don't switch model or effort mid-session.** A model switch, and on most models an effort
  change, invalidates the cache, so the next turn pays for the whole context again.
- **Approve your test command once** with "don't ask again". xend then runs your quick tests
  right after each edit and hands the result back with it, which saves the separate test turn
  (-5.5% cost on its own; bugfixes went from four turns to three).
- **Keep what loads every session short.** Long CLAUDE.md files, unused MCP servers and chatty
  hooks are paid on every turn. `/xend:doctor` lists them, largest first.
- **Delegate in long sessions, not in single tasks.** In a session that works through many
  independent subtasks, `/xend:delegate on` hands each one to a lean worker on your own model, so
  the main context stays small and stops compacting: half the tokens of plain Claude Code in
  bench r16. For a single task, any orchestration costs more (+9% to +186% on Sonnet 5.5, whether
  forks, general-purpose subagents, the Workflow tool or orchestration plugins), and cheap Haiku
  workers cost more too (+35%, slower, a subtask missed).

## What it does

| Layer | Mechanism | Where it lives |
|---|---|---|
| Measure | session stats from Claude Code's transcript (tokens, cache hit ratio, cost by model, largest tool results, re-reads); static audit of memory files, settings, MCP servers and per-turn hooks with ranked fixes | `/xend:stats`, `/xend:doctor` |
| Stay small | the whole per-session footprint is ~470 cache-write tokens (a 709-byte session block and three one-line agent descriptions; measured in bench r16), down from ~1,400; utilities are user-only skills, which Claude Code does not list to the model | session block, `extras/` |
| Say less | caveman-compatible terse style (`lite`, `full`, `ultra`); code, commands, paths, errors and numbers stay exact, and anything written to files, commits or PRs stays in normal prose | session block, `/xend:terse` |
| Take fewer turns | after an `Edit`, run the project's quick tests and hand the result to the model with the edit, so it does not spend a turn running them; only a command Claude Code would run without asking (an allow rule such as `Bash(npm test:*)`, which approving the command once with "don't ask again" writes), bounded, and off when the suite is slow; a work rule against read-backs and searches for files the task already names | PostToolUse hook, session block |
| Read less | deterministic, recoverable shaping of tool results: escape codes, progress bars, repeated lines, passing-test rows and install chatter removed; past the size limit, grep hits that repeat in a file merged onto one line with every line number, log lines that differ only in numbers folded to the first and last with a count, and only then a head and tail cut that keeps the error lines from the middle, with the original saved and named; byte-identical command re-runs shortened; grep/glob lists capped with truthful totals; every marker explains itself and says whether anything was left out | PostToolUse hook (`updatedToolOutput`) |
| Reset cheaply | a checkpoint (edited files, verification commands, decisions) written before compaction and re-injected after `/compact` or `/clear`, so `/clear` becomes the default way to end a task | PreCompact hook, `/xend:checkpoint` |
| Native levers | Bash output cap, MCP output cap, a `# Compact instructions` section, and (aggressive) Anthropic's server-side clearing of old tool results; which prompt-cache lifetime is cheaper for you, replayed from your own transcripts | `/xend:setup`, `/xend:doctor`, `/xend:stats --cache-ttl` |
| Keep long sessions small (opt-in) | delegate mode: one more paragraph in the session block tells the main session to hand each self-contained subtask to `xend-subtask`, a lean agent on the caller's model (Bash, Read, Edit, Write, Grep, Glob; a three-line report), and to answer quick questions itself | `/xend:delegate on`, `XEND_DELEGATE=1` |
| Opt-in | lean build rules adapted from ponytail (`/xend:ponytail full`); architect mode, where the main model plans and verified Haiku/Sonnet builders implement (`/xend:plan on`); Haiku scout/reader and Sonnet reviewer agents (`extras/agents/`, copy to use) | [measured below](#tested-and-left-out) |

What xend never does: rewrite your prompts, rewrite memory files into telegraphic prose, alter a `Read` result, summarize tool output with a model, run a command that is not on its allowlist or that Claude Code would ask you about, install another plugin unless you ask for it by name, switch the main session's model, or lower effort globally. Each of those has evidence against it (see the rejected list in `docs/RESEARCH.md`).

## Profiles

| Profile | Adds | Use when |
|---|---|---|
| `lite` | terse `lite`, noise-only output cleanup, repeat shortening, audits | you want a conservative start and your own numbers first |
| `balanced` (default) | terse `full`, structured shaping (tests, installs, long generic output), auto-test after edits, checkpoints | everyday work |
| `aggressive` | tighter caps, ranged reads of very large files, server-side context clearing (experimental) | long sessions; validate with the bench first |

Lean build rules and architect mode are opt-in in every profile (`/xend:ponytail full`, `/xend:plan on`): both were measured and neither paid for itself on the bench (see *Tested and left out*). Switch profiles with `/xend:profile <name>` or a `.xend.json` in the repo. Every transform has a kill switch (`XEND_AUTOTEST=0`, `XEND_SHAPE_TESTRUNNERS=0`, `XEND_TERSE=off`, ...). Details: `docs/PROFILES.md`.

## Tested and left out

xend's design comes from measuring the alternatives. Among them (full evidence table:
[`docs/RESEARCH.md`](docs/RESEARCH.md)):

| Idea | Measured cost change | Why it's not in xend |
|---|---|---|
| Rewriting shell commands to filter their output ([rtk](https://github.com/rtk-ai/rtk)) | +7.6% at low effort, +0.1% at high (JetBrains); +1% / +17% (Quesma); -2.7% (arXiv) | removed a line the task needed in 13 of 46 real outputs; extra turns eat the saving |
| Prompt compression and context "packets" ([token-reducer](https://github.com/Madhan230205/token-reducer)) | not measured by anyone | its hook fields aren't supported by Claude Code, so it only adds ~800 tokens per session |
| Heavy output compression (Headroom) | +48.4% (arXiv 2607.12161) | the largest cost increase in that study |
| Caveman-style rules written into CLAUDE.md | +12% median ([skill-receipts](https://github.com/sjh9714/skill-receipts)) | cost more on every task tested; xend's terse style is a short session block instead |
| Generated project overview files | +20% on average, no gain in success (ETH Zürich, arXiv 2602.11988) | `/xend:doctor` audits memory files instead of adding to them |
| Lean-code rules (ponytail) | -10.3% on code-heavy tasks (JetBrains), no saving on xend's short tasks | available opt-in: `/xend:ponytail full` |
| Architect mode (a planner model with cheap builder subagents) | +39% to +251% on the project tasks | works, but costs more at this task size; opt-in: `/xend:plan on` |
| Orchestrating a single task: forks, general-purpose subagents, the Workflow tool, superpowers or oh-my-claudecode | +9% to +186% per task on Sonnet 5.5 (bench r13, r14), every hidden test passing in every arm | Sonnet 5.5 finishes these tasks in about four turns; every subagent pays a prefix and the parent pays turns to brief it. Delegation pays only in long sessions (`/xend:delegate on`) |
| Haiku workers for delegated subtasks | +34.5% per long session (bench r15), 4x slower, one subtask missed | more turns per subtask than they save in price; `xend-subtask` runs on the caller's model |

## Guarantees

1. No model ever summarizes a tool result; shaping is deterministic string work.
2. Errors, failures, diffs, stack traces and summaries are never dropped. Diffs and test runs are
   never cut and their whitespace is never touched.
3. Anything condensed says so, names the full original, and says "complete" only when nothing but
   noise was removed.
4. `Read` results are never altered, and nothing is shaped inside subagents.
5. xend runs a test command only when Claude Code itself would run it without asking. A deny or
   ask rule always wins, a repository can't approve its own command, and commands run without a
   shell from a fixed allowlist.
6. A subagent's claim that its work passed is re-checked by xend, or recorded as unverified; it is
   never trusted on its word.
7. A profile becomes a default only after the bench shows a pass rate no more than 3 points lower,
   a cost that is confidently lower, and no extra turns.

The exact rules: [`docs/GUARANTEES.md`](docs/GUARANTEES.md) and [`SECURITY.md`](SECURITY.md).

## Measure it yourself

```bash
bash bench/selftest.sh                                  # every task fails before its fix and passes after
node bench/run.js --runs 3 --model sonnet --effort low  # paired runs: plain Claude Code vs xend (paid)
node bench/analyze.js                                   # report with confidence intervals and the three gates
```

`node bench/run.js --help` lists the options and never starts a run. How the bench is built:
[`bench/README.md`](bench/README.md) and [`docs/RESULTS.md`](docs/RESULTS.md).

## More

- [`docs/RESULTS.md`](docs/RESULTS.md): every measured run, including the ones that failed
- [`docs/RESEARCH.md`](docs/RESEARCH.md): the evidence base and each idea, graded
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how each mechanism maps to a Claude Code extension point
- [`docs/PROFILES.md`](docs/PROFILES.md): every setting and kill switch
- [`CHANGELOG.md`](CHANGELOG.md)

## Credits

The terse style descends from [caveman](https://github.com/JuliusBrussee/caveman) (MIT), whose maintainers also published the honest-numbers accounting that shaped this project's measurement rules. [rtk](https://github.com/rtk-ai/rtk) and JetBrains' benchmark of it defined the failure mode to avoid. [claude-mem](https://github.com/thedotmack/claude-mem) showed hook-based session lifecycle handling; [ccusage](https://github.com/ccusage/ccusage) showed transcript-based accounting. Anthropic's Claude Code documentation and cost guidance are the source for every native lever. The lean build rules are adapted from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT, Dietrich Gebert), whose only measured configuration — injection at SessionStart — is the one xend reproduces; the verbatim ruleset is vendored under `vendor/ponytail/`. See `THIRD_PARTY_NOTICES.md`.

## License

MIT.
