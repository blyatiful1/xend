# Results

Every measured run behind the numbers in the README, with the design notes each one produced.
Runs are paired (the same tasks in every arm, in one pass) on Claude Sonnet 5 unless noted; raw
data, per-run `config.json`, `warmup.jsonl` and `report.md` are under `bench/results/`. Costs are
billed cost at API list prices as Claude Code reports it.

## Cache lifetime (r12, 0.4.0)

Paired with nothing different but `CLAUDE_CODE_PROMPT_CACHE_TTL` (no plugin in either arm; each
arm's system prompt carried a one-line label so the arms could not share cache entries; the
lifetime every write was billed at was checked on every call):

| Cache lifetime, 5 minutes vs 1 hour | Paired runs | Pass rate | Cache hit ratio | Cost per task |
|---|---|---|---|---|
| short tasks, back to back (r12) | 42 | 95.2% in both | 0.898 -> 0.896 | **-25.0%** (95% CI -26.4% to -23.6%), cheaper in 42 of 42 |
| project tasks, medium effort (r12p) | 3 | 100% of hidden tests in both | 0.961 -> 0.959 | -12.2%, cheaper in 3 of 3 |

A 5-minute cache write costs 37.5% less than a 1-hour one, so the saving is 0.375 x the share of
the bill that is cache writes (63.6% on the short tasks, 32.4% on the project tasks). It holds
only while no pause between calls crosses five minutes; replayed at both lifetimes, one long
interactive session of this project would have cost 1.4% more at 5 minutes. Details:
`docs/RESEARCH.md` H13.

## Shaping, replayed on real command output (0.4.0)

44 real command outputs, Claude Code's 30,000-character cap modelled, each checked for the lines
its task depends on (`docs/RESEARCH.md` section 7c):

| | Characters the model sees | vs raw | Decisive lines lost |
|---|---|---|---|
| rtk | 319,955 | -32.7% | 13 |
| xend 0.3.0 | 341,179 | -28.3% | 1 |
| xend 0.4.0 | 221,757 | -53.4% | 0 |

## Plugin runs (0.3.0)

Measured with the paired bench (Claude Sonnet 5; the 21 short tasks at low effort, the three project tasks at medium effort; each run pairs the same tasks across arms; `bench/results/r8-*` to `r11-*`, details in `docs/RESEARCH.md` section 7b). "This release" is 0.3.0. Output shaping, the part 0.4.0 changes, fired on one of the 21 short tasks in these runs (a 270-hit grep); the 0.4.0 changes are measured offline in the section above:

| Comparison | Paired runs | Pass rate | Output tokens | Turns | Cost per task |
|---|---|---|---|---|---|
| this release vs the previous one, short tasks (r10) | 42 | 92.9% -> 95.2% | -12.1% | 4.6 -> 4.2 | **-9.1%** (95% CI -12.7% to -4.7%), all three gates PASS |
| this release vs no plugin, short tasks (r10 + r11) | 84 | 91.7% -> 96.4% | -11.6% | 4.5 -> 4.2 | -1.2% (95% CI -4.4% to +3.1%) |
| previous release vs no plugin, short tasks (r8 + r10) | 84 | 94.0% -> 90.5% | -4.1% | 4.6 -> 4.5 | +5.8% (95% CI -1.2% to +11.4%), cost gate FAIL |
| this release vs no plugin, project tasks (r10p) | 6 | 100% of hidden tests in both | -4.7% | 25.0 -> 22.0 | **-15.9%** (95% CI -39.6% to -2.5%), all three gates PASS |
| this release vs the previous one, project tasks (r10p) | 6 | 100% in both | +2.7% | 21.2 -> 22.0 | -0.2% (95% CI -11.1% to +13.5%) |

What changed, and what each part is worth:

- **The plugin's own footprint was the first cost.** Measured through a request-logging proxy, the previous release added ~1,400 cache-write tokens to every session, and Claude Code now writes the cache at the 1-hour rate (2x the input price). This release adds ~413. On its own that took the short-task suite from +4.2% to +0.4% against no plugin (r8).
- **The turn is the unit of cost on short tasks.** After an `Edit`, xend runs the project's quick tests and hands the result over with the edit, so the model does not spend a turn running them. Measured alone on the same build: **-5.5% cost (95% CI -9.7% to -2.0%), turns -0.5, pass rate unchanged, all three gates PASS** (r8). Bugfix tasks went from four turns to three. Asking the model to batch the edit and the test itself did not work (Sonnet kept them in separate turns in every traced run), so a hook does it. The bench pre-approves Bash, so these runs had the auto-test permitted; since 0.3.0 it runs only where Claude Code would run the test command without asking (guarantee 7), so a session with no allow rule for it does not get this saving until the command is approved once.
- **Lean rules are opt-in now.** xend's adapted ponytail text bought no measurable saving and made the model leave a required value blank on one adversarial task (lean on passed 3 of 6, lean off 3 of 3), which by this project's own pre-registered rule turns a feature off.

So on short tasks this release is cost-neutral against no plugin, with a higher pass rate and fewer output tokens; the confident saving there is against the previous release. On long tasks (a 50-module brownfield change and two greenfield packages) both releases cost about 16% less than no plugin at 100% of hidden tests, and they cannot be told apart. The levers the bench cannot see (MCP output caps, compaction avoidance through checkpoints and `/clear`) come on top through `/xend:setup` and `/xend:doctor`.

Independent measurements of the techniques xend combines:

- Terse output style: 8.5% fewer output tokens on 86 real coding tasks, no detectable quality change (JetBrains, paired A/B). Output is a minority of agentic spend, so expect a few percent of total cost from this layer alone; much more in chat-style Q&A.
- Command-rewriting filters (rtk): **+7.6% cost** and more turns in the same harness at low effort, +0.1% at high effort (JetBrains); +1% and +17% per task on two models (Quesma); -2.7% (arXiv 2607.12161). Replayed offline on 46 real command outputs, rtk removed a line the task depended on in 13 of them. This is the failure mode xend's marker contract and recoverability rules are designed against.
- Masking old tool results: 52% cheaper with a slightly higher solve rate on SWE-bench Verified (JetBrains Research). xend enables Anthropic's server-side version in the `aggressive` profile.
- Prompt caching: cache reads cost a tenth of the input price, and on a subscription Claude Code writes the cache at the 1-hour rate (2x). Nothing xend injects varies between turns, so its ~413 tokens are written once per session and then read at a tenth. Cache writes and reads are about 80% of billed cost and all tool output 3.3% ([arXiv 2607.12161](https://arxiv.org/abs/2607.12161), 2,848 runs), which bounds what any output condenser can save.
- The ponytail ruleset: **-10.3% cost (p = 0.004)**, -15.4% code (p = 0.088, against an advertised -54%), -11% time, and no significant quality difference across 80 paired tasks (JetBrains; 251 trials, $246.09), measured with the ~1,382-token upstream text injected at SessionStart on longer tasks. xend's own runs never reproduced a saving on short tasks with either text (r4, r5, r8), so lean rules are opt-in: `/xend:ponytail full` for xend's short adapted text, `XEND_PONYTAIL_TEXT=upstream` for the measured one.

### Earlier runs

Before r8 the bench ran with the hosting session's tool set and without a warm-up, so the percentages below are relative to a heavier base than a local session has (`docs/RESEARCH.md` H25); they remain valid as paired comparisons of the builds of the time (Claude Sonnet 5, low effort):

| Run | Tasks x trials | Pass rate (baseline -> xend) | Output tokens | Turns | Cost per task |
|---|---|---|---|---|---|
| r1, pre-review defaults | 16 x 1 | 93.8% -> 93.8% | -9.0% | 4.8 -> 4.6 | -2.2% |
| r2, revised defaults | 21 x 2 | 90.5% -> 95.2% | -3.2% | 4.5 -> 4.6 | **+9.0%** (95% CI +6.1% to +11.9%) |
| r3, trimmed prefix (shipped config) | 21 x 1 | 95.2% -> 90.5% (one adversarial task that is flaky in both arms) | -8.6% | 4.8 -> 4.5 | +3.5% (95% CI -1.2% to +7.9%) |
| r2 + r3 merged | 63 paired runs | 92.1% -> 93.7% (95% CI +0.0 to +4.8 pp) | -5.5% | 4.6 -> 4.6 | +6.9% |
| r4, ponytail on (xend's adapted text, the shipped `balanced` default) | 21 x 1 | 90.5% -> 90.5% (same two tasks fail in both arms) | -4.9% | 4.3 -> 4.5 | +3.9% (95% CI -4.5% to +10.0%) |
| r5, ponytail on (upstream-verbatim text, opt-in) | 21 x 1 | 95.2% -> 90.5% (the flaky adversarial task again) | **+8.6%** | 4.5 -> 5.0 | **+16.7%** (95% CI +10.6% to +24.0%) |

These runs are why this release exists: on five-turn tasks the plugin's fixed prefix cost more than terse output saved, and the ponytail texts did not reproduce the JetBrains saving on tasks that write little code.

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

## How the numbers are made

```bash
bash bench/selftest.sh                                  # every task fails before its fix and passes after
node bench/run.js --runs 3 --model sonnet --effort low  # paired baseline vs xend
node bench/analyze.js                                   # merged report with CIs, sign test, MDE, verdict
```

Every child runs as a plain local `claude -p` with an explicit local tool set (`--toolset local`, the default), and each arm first makes one warm-up request so no arm pays the shared cache write by running first. Arms can load the plugin from any checkout (`label:xend@/path/to/checkout:sonnet`, or `--arms-file` with per-arm environment), which is how the previous release and this one run side by side in one paired pass:

```bash
git worktree add ../xend-main origin/main
node bench/run.js --arms "baseline,xend-main:xend@../xend-main:sonnet,xend-new:xend:sonnet" --runs 2 -j 4
```

21 tasks: bugfix, feature, refactor, reading-heavy, navigation, Q&A, plus five adversarial tasks designed to catch condensers that hide the middle of an output, a diff hunk, a debug print, grep hits past a cap, or that minify a file the model must edit. Three more, `project-*`, are bigger multi-file tasks with hidden tests and partial credit (`test.sh` prints `SCORE: p/t` instead of a flat pass/fail) — where "one model does everything" is compared against architect mode with a multi-arm run, e.g.:

```bash
node bench/run.js --arms "solo-sonnet:baseline:sonnet,arch-sonnet:xend:sonnet:architect" \
  --tasks project-* --tools "Bash,Read,Edit,Write,MultiEdit,Grep,Glob,Agent" --max-budget-usd 5 -j 2
```

Two native eval cases for `claude plugin eval` live in `evals/` (LLM-graded): commit messages must stay in normal prose under the terse style, and a condensed tool result must be trusted rather than re-run. `claude plugin eval .` needs Claude Code's sandbox backend (bubblewrap and socat on Linux) because the cases grant Bash; it could not run in the container this was developed in, so these two cases are unvalidated.
