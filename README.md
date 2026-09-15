# xend

**Spend fewer tokens in Claude Code without losing quality.**

xend is a Claude Code plugin built from what the evidence says actually works: keep the prompt cache warm, shrink what the model *reads* (not just what it writes), reset context cheaply, route bulky work to cheaper models with verification, and measure everything with a paired benchmark instead of a marketing percentage. No proxy, no daemon, no database; Node.js 18+ is the only dependency.

Where the numbers come from: `docs/RESEARCH.md` (evidence base and 18 hypotheses, each graded), `docs/ARCHITECTURE.md` (how each mechanism maps to a native Claude Code extension point), `bench/` (the quality gate).

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

Then, in a new session:

```
/xend:doctor                              audit this machine for token waste (offline)
/xend:setup balanced --with-recommended   apply the profile and the recommended native settings (backup + diff)
/xend:stats                               what the last session spent, and what shaping removed
```

## What it does

| Layer | Mechanism | Where it lives |
|---|---|---|
| Measure | session stats from Claude Code's transcript (tokens, cache hit ratio, cost by model, largest tool results, re-reads); static audit of memory files, settings, MCP servers and per-turn hooks with ranked fixes | `/xend:stats`, `/xend:doctor` |
| Say less | caveman-compatible terse style (`lite`, `full`, `ultra`) with hard exemptions: code, errors, numbers, security warnings, and anything persisted outside chat stay exact | session block, `/xend:terse` |
| Read less | deterministic, recoverable shaping of tool results: escape codes, progress bars, repeated lines, passing-test rows and install chatter removed; very long generic output cut to head and tail with the original saved and named; byte-identical command re-runs shortened; grep/glob lists capped with truthful totals | PostToolUse hook (`updatedToolOutput`) |
| Delegate | `xend-scout` (Haiku, citations only), `xend-reader` (Haiku, condense one artifact), `xend-worker` (Sonnet), `xend-reviewer` (Sonnet), and a routing rule: accept a cheaper model's output only after verifying it | `agents/`, `/xend:route` |
| Reset cheaply | a checkpoint (edited files, verification commands, decisions) written before compaction and re-injected after `/compact` or `/clear`, so `/clear` becomes the default way to end a task | PreCompact hook, `/xend:checkpoint` |
| Native levers | prompt-cache TTL, Bash output cap, MCP output cap, a `# Compact instructions` section, and (aggressive) Anthropic's server-side clearing of old tool results | `/xend:setup` |

What xend never does: rewrite your prompts, rewrite memory files into telegraphic prose, alter a `Read` result, summarize tool output with a model, switch the main session's model, or lower effort globally. Each of those has evidence against it (see the rejected list in `docs/RESEARCH.md`).

## Profiles

| Profile | Adds | Use when |
|---|---|---|
| `lite` | terse `lite`, noise-only output cleanup, repeat shortening, audits | you want a conservative start and your own numbers first |
| `balanced` (default) | terse `full`, structured shaping (tests, installs, long generic output), delegation, checkpoints | everyday work |
| `aggressive` | tighter caps, ranged reads of very large files, server-side context clearing (experimental) | long sessions; validate with the bench first |

Switch with `/xend:profile <name>` or a `.xend.json` in the repo. Every transform has a kill switch (`XEND_SHAPE_TESTRUNNERS=0`, `XEND_TERSE=off`, ...). Details: `docs/PROFILES.md`.

## What to expect

Honest numbers beat advertised ones. Independent measurements of the techniques xend combines:

- Terse output style: 8.5% fewer output tokens on 86 real coding tasks, no detectable quality change (JetBrains, paired A/B). Output is a minority of agentic spend, so expect a few percent of total cost from this layer alone; much more in chat-style Q&A.
- Command-rewriting filters (rtk): **+7.6% cost** and more turns in the same harness. This is the failure mode xend's marker contract and recoverability rules are designed against.
- Masking old tool results: 52% cheaper with a slightly higher solve rate on SWE-bench Verified (JetBrains Research). xend enables Anthropic's server-side version in the `aggressive` profile.
- Prompt caching: the fixed prefix measured here was 32,062 tokens per request; cache reads cost a tenth of a miss. Nothing xend injects varies between turns.

xend's own paired runs (Claude Sonnet 5 at low effort, same tasks under both arms; `bench/results/`):

| Run | Tasks x trials | Pass rate (baseline -> xend) | Output tokens | Turns | Cost per task |
|---|---|---|---|---|---|
| r1, pre-review defaults | 16 x 1 | 93.8% -> 93.8% | -9.0% | 4.8 -> 4.6 | -2.2% |
| r2, revised defaults | 21 x 2 | 90.5% -> 95.2% | -3.2% | 4.5 -> 4.6 | **+9.0%** (95% CI +6.1% to +11.9%) |
| r3, trimmed prefix (shipped config) | 21 x 1 | 95.2% -> 90.5% (one adversarial task that is flaky in both arms) | -8.6% | 4.8 -> 4.5 | +3.5% (95% CI -1.2% to +7.9%) |
| r2 + r3 merged | 63 paired runs | 92.1% -> 93.7% (95% CI +0.0 to +4.8 pp) | -5.5% | 4.6 -> 4.6 | +6.9% |

Read r2 carefully, because it is the kind of number this project exists to surface. Quality was never worse on any task and improved on two. But these tasks average 4.5 turns, the plugin's fixed prefix (session block plus skill and agent descriptions) is cache-written once per session and not amortized over so few turns, and the shaping layer had something to condense on one task out of 21. The gate therefore returns **FAIL on cost** for micro-tasks, exactly as rtk's independent benchmark did for rtk. Where xend does win is longer and reading-heavier work: in r1 the log-analysis task went from 8 turns and 455k tokens to 4 turns and 206k, and the navigation task in r2 used 23% fewer tokens with one turn less. After r2 the prefix was cut by roughly 40%; r3 shows the overhead more than halved (+3.5%, interval including zero) with output tokens down 8.6% and turns down. The levers the bench cannot see at all (cache TTL across pauses, MCP output caps, compaction avoidance through checkpoints and `/clear`, deferred tool schemas) are applied through `/xend:setup` and `/xend:doctor`.

The practical guidance that follows from the data: install xend for sessions that read a lot or run long, use `/xend:doctor` and `/xend:setup` for the native levers, and do not expect savings on five-turn micro-tasks. A 21-task suite cannot certify a 3-point quality bound (it detects roughly an 8-point drop); the bench reports its minimum detectable effect and merges evidence across runs. See `bench/README.md`.

## Quality guarantees

Every mechanism follows the same rules, and the benchmark exists to catch violations:

1. Shaping is deterministic string work. No model ever summarizes a tool result.
2. Errors, failures, diffs, stack traces and summary lines are never dropped. Diffs and test runs are never head/tail cut.
3. Anything condensed carries a `[xend]` line saying what was removed and, when it matters, where the full original is. The model is told the result is complete and when re-running is still appropriate.
4. `Read` results are never altered. Grep and Glob caps keep the true counts.
5. Nothing shapes inside subagents.
6. Promotion of a profile requires the bench to pass three gates at once: pass-rate delta not worse than -3 points, cost confidently lower, turns not higher.

## Benchmark

```bash
bash bench/selftest.sh                                  # every task fails before its fix and passes after
node bench/run.js --runs 3 --model sonnet --effort low  # paired baseline vs xend
node bench/analyze.js                                   # merged report with CIs, sign test, MDE, verdict
```

21 tasks: bugfix, feature, refactor, reading-heavy, navigation, Q&A, plus five adversarial tasks designed to catch condensers that hide the middle of an output, a diff hunk, a debug print, grep hits past a cap, or that minify a file the model must edit.

Two native eval cases for `claude plugin eval` live in `evals/` (LLM-graded): commit messages must stay in normal prose under the terse style, and a condensed tool result must be trusted rather than re-run. `claude plugin eval .` needs Claude Code's sandbox backend (bubblewrap and socat on Linux) because the cases grant Bash; it could not run in the container this was developed in, so these two cases are unvalidated.

## Credits

The terse style descends from [caveman](https://github.com/JuliusBrussee/caveman) (MIT), whose maintainers also published the honest-numbers accounting that shaped this project's measurement rules. [rtk](https://github.com/rtk-ai/rtk) and JetBrains' benchmark of it defined the failure mode to avoid. [claude-mem](https://github.com/thedotmack/claude-mem) showed hook-based session lifecycle handling; [ccusage](https://github.com/ccusage/ccusage) showed transcript-based accounting. Anthropic's Claude Code documentation and cost guidance are the source for every native lever.

## License

MIT.
