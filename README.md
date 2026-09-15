# xend

**Spend fewer tokens in Claude Code without losing quality.**

xend is a Claude Code plugin built from what the evidence says actually works: keep the prompt cache warm, shrink what the model *reads* (not just what it writes), reset context cheaply, route bulky work to cheaper models with verification, keep file contents out of the main model's context by planning on the main model and building with verified cheap subagents, and measure everything with a paired benchmark instead of a marketing percentage. No proxy, no daemon, no database; Node.js 18+ is the only dependency.

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
/xend:plan                                architect plan status, or turn it off/on for this session
```

## What it does

| Layer | Mechanism | Where it lives |
|---|---|---|
| Measure | session stats from Claude Code's transcript (tokens, cache hit ratio, cost by model, largest tool results, re-reads); static audit of memory files, settings, MCP servers and per-turn hooks with ranked fixes | `/xend:stats`, `/xend:doctor` |
| Say less | caveman-compatible terse style (`lite`, `full`, `ultra`) with hard exemptions: code, errors, numbers, security warnings, and anything persisted outside chat stay exact | session block, `/xend:terse` |
| Build less | ponytail's lazy-senior-dev ladder (YAGNI, reuse what is here, stdlib, native feature, one line) injected at SessionStart; xend defers to the upstream ponytail plugin when one is installed | session block, `/xend:ponytail` |
| Read less | deterministic, recoverable shaping of tool results: escape codes, progress bars, repeated lines, passing-test rows and install chatter removed; very long generic output cut to head and tail with the original saved and named; byte-identical command re-runs shortened; grep/glob lists capped with truthful totals | PostToolUse hook (`updatedToolOutput`) |
| Delegate | `xend-scout` (Haiku, citations only), `xend-reader` (Haiku, condense one artifact), `xend-worker` (Sonnet), `xend-worker-lite` (Haiku, one mechanical fully-specified change), `xend-reviewer` (Sonnet), and a routing rule: accept a cheaper model's output only after verifying it | `agents/`, `/xend:route` |
| Plan, then build cheaply | Opt-in. The main model writes a plan through a small CLI; Haiku/Sonnet builders implement each task in disposable contexts; a deterministic SubagentStop hook re-runs every builder's verify command and sends false claims back for restatement; a PreToolUse gate refuses direct edits above the file floor until a plan exists | `/xend:plan`, session block, `scripts/subagent-stop.js`, `scripts/pre-edit-gate.js` |
| Reset cheaply | a checkpoint (edited files, verification commands, decisions) written before compaction and re-injected after `/compact` or `/clear`, so `/clear` becomes the default way to end a task | PreCompact hook, `/xend:checkpoint` |
| Native levers | prompt-cache TTL, Bash output cap, MCP output cap, a `# Compact instructions` section, and (aggressive) Anthropic's server-side clearing of old tool results | `/xend:setup` |

What xend never does: rewrite your prompts, rewrite memory files into telegraphic prose, alter a `Read` result, summarize tool output with a model, switch the main session's model, or lower effort globally. Each of those has evidence against it (see the rejected list in `docs/RESEARCH.md`).

## Profiles

| Profile | Adds | Use when |
|---|---|---|
| `lite` | terse `lite`, noise-only output cleanup, repeat shortening, audits, plus lean `lite` (xend's adapted ruleset) | you want a conservative start and your own numbers first |
| `balanced` (default) | terse `full`, structured shaping (tests, installs, long generic output), delegation, checkpoints, plus lean `full` (xend's adapted ruleset); architect mode is opt-in (`/xend:plan on`) | everyday work |
| `aggressive` | tighter caps, ranged reads of very large files, server-side context clearing (experimental), plus lean `full` (adapted text; set `XEND_PONYTAIL_TEXT=upstream` for the upstream-verbatim ruleset JetBrains measured, ~1,400 tokens more per session) | long sessions; validate with the bench first |

Switch with `/xend:profile <name>` or a `.xend.json` in the repo. Every transform has a kill switch (`XEND_SHAPE_TESTRUNNERS=0`, `XEND_TERSE=off`, ...). Details: `docs/PROFILES.md`.

## What to expect

Honest numbers beat advertised ones. Independent measurements of the techniques xend combines:

- Terse output style: 8.5% fewer output tokens on 86 real coding tasks, no detectable quality change (JetBrains, paired A/B). Output is a minority of agentic spend, so expect a few percent of total cost from this layer alone; much more in chat-style Q&A.
- Command-rewriting filters (rtk): **+7.6% cost** and more turns in the same harness. This is the failure mode xend's marker contract and recoverability rules are designed against.
- Masking old tool results: 52% cheaper with a slightly higher solve rate on SWE-bench Verified (JetBrains Research). xend enables Anthropic's server-side version in the `aggressive` profile.
- Prompt caching: the fixed prefix measured here was 32,062 tokens per request; cache reads cost a tenth of a miss. Nothing xend injects varies between turns.
- The ponytail ruleset: **-10.3% cost (p = 0.004)**, -15.4% code (p = 0.088, against an advertised -54%), -11% time, and no significant quality difference across 80 paired tasks (JetBrains; 251 trials, $246.09). The load-bearing finding is about *delivery*, not content: "If you copy the SKILL.md into a skills folder and let the model decide when to use it, it will self-activate zero times." That is why xend injects it from the SessionStart hook. **Two honest caveats:** only the cost figure is statistically solid — the code figure is not — and the text xend injects by default on `lite` and `balanced` is xend's own 240-token condensation, **not** the ~1,382-token artifact those numbers describe; this text is xend's adaptation and is untested. Set `XEND_PONYTAIL_TEXT=upstream` (the default on `aggressive`) to run the measured text — that text is upstream-verbatim (the measured artifact).

xend's own paired runs (Claude Sonnet 5 at low effort, same tasks under both arms; `bench/results/`):

| Run | Tasks x trials | Pass rate (baseline -> xend) | Output tokens | Turns | Cost per task |
|---|---|---|---|---|---|
| r1, pre-review defaults | 16 x 1 | 93.8% -> 93.8% | -9.0% | 4.8 -> 4.6 | -2.2% |
| r2, revised defaults | 21 x 2 | 90.5% -> 95.2% | -3.2% | 4.5 -> 4.6 | **+9.0%** (95% CI +6.1% to +11.9%) |
| r3, trimmed prefix (shipped config) | 21 x 1 | 95.2% -> 90.5% (one adversarial task that is flaky in both arms) | -8.6% | 4.8 -> 4.5 | +3.5% (95% CI -1.2% to +7.9%) |
| r2 + r3 merged | 63 paired runs | 92.1% -> 93.7% (95% CI +0.0 to +4.8 pp) | -5.5% | 4.6 -> 4.6 | +6.9% |
| r4, ponytail on (xend's adapted text, the shipped `balanced` default) | 21 x 1 | 90.5% -> 90.5% (same two tasks fail in both arms) | -4.9% | 4.3 -> 4.5 | +3.9% (95% CI -4.5% to +10.0%) |
| r5, ponytail on (upstream-verbatim text, opt-in) | 21 x 1 | 95.2% -> 90.5% (the flaky adversarial task again) | **+8.6%** | 4.5 -> 5.0 | **+16.7%** (95% CI +10.6% to +24.0%) |

On these micro-tasks ponytail does not reproduce the JetBrains saving: the tasks write too little code for a "write less code" rule to remove any, so only the rule's prefix shows up. The adapted text (about 215 tokens) is within noise of no ponytail at all (r3 vs r4); the upstream-verbatim text (about 1,400 tokens) costs 17% more and makes the model write longer replies and take more turns. The JetBrains result came from larger SkillsBench tasks. Hence the shipped default is the adapted text in every profile, and the upstream text is opt-in for people who want the measured artifact on long, code-heavy work.

Read r2 carefully, because it is the kind of number this project exists to surface. Quality was never worse on any task and improved on two. But these tasks average 4.5 turns, the plugin's fixed prefix (session block plus skill and agent descriptions) is cache-written once per session and not amortized over so few turns, and the shaping layer had something to condense on one task out of 21. The gate therefore returns **FAIL on cost** for micro-tasks, exactly as rtk's independent benchmark did for rtk. Where xend does win is longer and reading-heavier work: in r1 the log-analysis task went from 8 turns and 455k tokens to 4 turns and 206k, and the navigation task in r2 used 23% fewer tokens with one turn less. After r2 the prefix was cut by roughly 40%; r3 shows the overhead more than halved (+3.5%, interval including zero) with output tokens down 8.6% and turns down. The levers the bench cannot see at all (cache TTL across pauses, MCP output caps, compaction avoidance through checkpoints and `/clear`, deferred tool schemas) are applied through `/xend:setup` and `/xend:doctor`.

The practical guidance that follows from the data: install xend for sessions that read a lot or run long, use `/xend:doctor` and `/xend:setup` for the native levers, and do not expect savings on five-turn micro-tasks. A 21-task suite cannot certify a 3-point quality bound (it detects roughly an 8-point drop); the bench reports its minimum detectable effect and merges evidence across runs. See `bench/README.md`.

### Architect mode on long tasks

Architect mode (`docs/ARCHITECTURE.md` L7) is a different bet from the layers above: instead of shrinking what the main model reads, it keeps file bodies out of the main model's context entirely by having it plan and delegating the reading and editing to disposable Haiku/Sonnet subagents, verified by a deterministic hook rather than trusted. Two headless smoke tests *(verified here)* shaped the design: given a three-module package to implement, a Sonnet session with the architect paragraph in its context but no gate did the whole task itself — 10 turns, $0.28, zero subagents. A first, soft gate that named `plan off` as its way out was taken exactly that way: the model ran `plan off` and finished directly — 11 turns, one denial, $0.18. A behavioural rule with a strong prior against it ("just do the work") needed a mechanical floor with no advertised exit, which is why the shipped gate (`scripts/pre-edit-gate.js`) never mentions a way to disable itself.

Whether the extra machinery pays for itself is a question for the project bench (`bench/tasks/project-*`, `--arms ...:xend:...:architect`), measured in runs r6, r7 and r7b:

Runs r6, r7 and r7b (`bench/results/`, one trial per arm, main model at medium effort, hidden tests as the score; architect arms plan from the first file):

| Task | solo Sonnet | plain xend on Sonnet | architect on Sonnet | solo Fable | architect on Fable |
|---|---|---|---|---|---|
| ledger CLI (greenfield, 60 hidden tests) | 60/60, 18 turns, $0.51 | 60/60, 19 turns, $0.58 | 60/60, 5 turns, $1.15 (6 Sonnet builders); Haiku builders forced: 10 turns, $1.76 | 60/60, 12 turns, $1.82 | 60/60, 26 turns, $2.89 (3 Haiku builders, $0.06); Haiku forced: 40 turns, $4.57 |
| log pipeline (greenfield, 58) | 58/58, 21 turns, $0.51 | 58/58, 15 turns, $0.39 | 58/58, 2 turns, $1.14 (6 Sonnet builders); Haiku forced: 8 turns, $1.82 | 58/58, 14 turns, $1.39 | 58/58, 22 turns, $2.48 (3 Haiku builders, $0.05); Haiku forced: 19 turns, $2.07, no builders used |
| soft-delete across a 50-module codebase (brownfield, 56) | 56/56, 36 turns, $0.54 | 56/56, 34 turns, $0.52 | 56/56, 4 turns, $1.08 (6 builders, Haiku share $0.10) | 56/56, 20 turns, $1.27 | 56/56, 14 turns, $1.77 (5 Haiku builders, $0.17) |

Every arm passed every hidden test, so the comparison is cost and turns alone. Plain xend (shaping, terse style, reading rules, no architect) against solo Sonnet, one trial per task: -24.6% on the log pipeline (15 turns instead of 21), -3.9% on the brownfield change (34 instead of 36), but +14.6% on the ledger CLI (19 instead of 18). The mean of -4.6% is carried by one task, and single trials cannot separate that from run-to-run noise; what can be said is that these long tasks are the first where the plugin's own prefix stopped being the dominant term (five micro-task runs were +3% to +15%). Note that this arm carries about 100 more prefix tokens than the plugin on `main` (the `plan` skill and `xend-worker-lite` descriptions plus one reading clause), so it measures xend against no plugin, not new against old. Architect mode never beat solo: +125% (Sonnet planner, Sonnet builders), +251% (Sonnet planner, Haiku builders), +99% on the brownfield task; Fable as planner cost +67% and +39% over solo Fable. The main context did get tiny (2-5 turns instead of 18-36) and the Haiku builders did their share for $0.05-0.17 per task with verified passes, but two costs ate the saving: every builder pays a cold prefix plus its own reading, and the planner's briefs are output tokens (26k on Fable, about $1.30 of its $1.77). On tasks a single Sonnet context finishes for about $0.50 there is no reading bill large enough to move. The layer ships as an opt-in (`/xend:plan on`, `XEND_ARCHITECT=1`) for work a single context cannot hold, and is off in every profile.

On tasks below the size floor (three files or fewer, fewer than 8 tool calls) the layer is off by construction: the model works directly, exactly as without it.

## Quality guarantees

Every mechanism follows the same rules, and the benchmark exists to catch violations:

1. Shaping is deterministic string work. No model ever summarizes a tool result.
2. Errors, failures, diffs, stack traces and summary lines are never dropped. Diffs and test runs are never head/tail cut.
3. Anything condensed carries a `[xend]` line saying what was removed and, when it matters, where the full original is. The model is told the result is complete and when re-running is still appropriate.
4. `Read` results are never altered. Grep and Glob caps keep the true counts.
5. Nothing shapes inside subagents.
6. Promotion of a profile requires the bench to pass three gates at once: pass-rate delta not worse than -3 points, cost confidently lower, turns not higher.
7. A subagent's claim is never trusted unverified: when its `Verification: <command> -> ...` line matches the allowlist, xend re-runs the command itself; every citation it makes is checked against the real files; a mismatch or a bad citation is sent back to the subagent for restatement; a command outside the allowlist is recorded as unverifiable, never run and never trusted as a PASS.

## Benchmark

```bash
bash bench/selftest.sh                                  # every task fails before its fix and passes after
node bench/run.js --runs 3 --model sonnet --effort low  # paired baseline vs xend
node bench/analyze.js                                   # merged report with CIs, sign test, MDE, verdict
```

21 tasks: bugfix, feature, refactor, reading-heavy, navigation, Q&A, plus five adversarial tasks designed to catch condensers that hide the middle of an output, a diff hunk, a debug print, grep hits past a cap, or that minify a file the model must edit. Two more, `project-*`, are bigger multi-file tasks with hidden tests and partial credit (`test.sh` prints `SCORE: p/t` instead of a flat pass/fail) — where "one model does everything" is compared against architect mode with a multi-arm run, e.g.:

```bash
node bench/run.js --arms "solo-sonnet:baseline:sonnet,arch-sonnet:xend:sonnet:architect" \
  --tasks project-* --tools "Bash,Read,Edit,Write,MultiEdit,Grep,Glob,Agent" --max-budget-usd 5 -j 2
```

Two native eval cases for `claude plugin eval` live in `evals/` (LLM-graded): commit messages must stay in normal prose under the terse style, and a condensed tool result must be trusted rather than re-run. `claude plugin eval .` needs Claude Code's sandbox backend (bubblewrap and socat on Linux) because the cases grant Bash; it could not run in the container this was developed in, so these two cases are unvalidated.

## Credits

The terse style descends from [caveman](https://github.com/JuliusBrussee/caveman) (MIT), whose maintainers also published the honest-numbers accounting that shaped this project's measurement rules. [rtk](https://github.com/rtk-ai/rtk) and JetBrains' benchmark of it defined the failure mode to avoid. [claude-mem](https://github.com/thedotmack/claude-mem) showed hook-based session lifecycle handling; [ccusage](https://github.com/ccusage/ccusage) showed transcript-based accounting. Anthropic's Claude Code documentation and cost guidance are the source for every native lever. The lean build rules are adapted from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT, Dietrich Gebert), whose only measured configuration — injection at SessionStart — is the one xend reproduces; the verbatim ruleset is vendored under `vendor/ponytail/`. See `THIRD_PARTY_NOTICES.md`.

## License

MIT.
