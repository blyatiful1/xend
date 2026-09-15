# xend bench: the quality gate

The bench answers one question with numbers instead of claims: **does xend change task success, and by how much does it change tokens, turns, and cost?** It is a paired design (the same task under both arms), because between-task difficulty variance dwarfs the effect of any token-saving technique.

## Layout

```
bench/
├── run.js          paired runner (claude -p, baseline vs xend via --plugin-dir)
├── analyze.js      paired statistics, bootstrap CI, sign test, MDE, promotion gate
├── selftest.sh     proves every task fails before its reference fix and passes after
├── tasks/<slug>/   task.json, fixture/ (+ gen.sh for large artifacts), test.sh, reference/apply.sh
└── results/<run>/  runs.jsonl (one record per task x arm x trial), raw/, config.json, state/
```

Tasks (21): 4 bugfix, 3 feature, 1 refactor, 4 reading-heavy (log needle, test triage, config drift, big-file edit), 2 navigation, 2 Q&A, and 5 adversarial tasks (`adv-*`) built to catch condensers: the decisive line in the middle of a 6,000-line log, a bug in the middle hunk of a 450-line diff, print-statement debugging through a long verbose test run, a refactor needing every one of ~260 grep hits, and an edit to a pretty-printed JSON file the model read first. Reading-heavy tasks are where tool-output shaping matters; Q&A tasks are where the terse style matters; bugfix/feature tasks guard against regressions in ordinary work.

A `project` category is for long, multi-file tasks with hidden tests and partial credit: bigger fixtures spanning several files, a `test.sh` that runs a held-out test suite the model never sees and prints a `SCORE:` line (see below) instead of a flat pass/fail, and (usually) a higher `budget_usd` and an `Agent`-inclusive `tools` list so the xend arm can actually delegate to subagents. This is where "one model does everything" vs. "architect plans, cheap subagents build" (`--arms ...:xend:...:architect`) is meant to show a real difference — the bugfix/feature/reading tasks above are mostly too small for delegation to pay for itself.

Pre-registration: the shipped bundle (a profile) is what the quality gate certifies. Individual transforms are ablated with the cheap, high-power token and turn endpoints (`XEND_SHAPE_*=0` kill switches, `--extra`), not by re-running the quality gate per transform.

## Run

```bash
bash bench/selftest.sh                       # task suite is sound (fail before, pass after)
node bench/run.js --list                     # tasks
node bench/run.js --runs 3 --model sonnet --effort low -j 3     # full paired run
node bench/analyze.js                        # merges every bench/results/*/runs.jsonl
node bench/analyze.js bench/results/<run> --md report.md
```

`run.js` options: `--arms baseline,xend`, `--runs k`, `--model`, `--effort`, `--tasks a,b` or glob, `--category`, `--concurrency`, `--max-budget-usd` (per run, default; a task's `budget_usd` overrides it), `--tools <comma list>` (default `Bash,Read,Edit,Write,MultiEdit,Grep,Glob`; a task's `tools` overrides the default, `--tools` overrides both), `--profile lite|balanced|aggressive` (xend arms), `--keep` (keep work dirs), `--extra "<flag>"` (passed to every arm).

### Arms

An arm is either the legacy bare label (`baseline`, `xend` — kind = label, model = `--model`, mode = plain) or the full spec `label:kind:model[:mode]`:

- `label` — free string used in records and reports (e.g. `solo-sonnet`, `arch-fable`).
- `kind` — `baseline` (no plugin) or `xend` (adds `--plugin-dir <repo root>` and `XEND_PROFILE`).
- `model` — the `--model` value for that arm (`haiku`, `sonnet`, `opus`, `fable`, or a full id), overriding the global `--model` for that arm only.
- `mode` (xend only, optional) — `architect` runs that arm with `XEND_ARCHITECT=1` (the main model plans, cheap subagents build); `plain` (default) runs with `XEND_ARCHITECT=0`.

Any number of arms can run in one pass, e.g. to compare "one model does everything" against "xend architect mode" across several models:

```bash
node bench/run.js --arms "solo-sonnet:baseline:sonnet,solo-fable:baseline:fable,arch-fable:xend:fable:architect,arch-sonnet:xend:sonnet:architect" \
  --tasks project-* --tools "Bash,Read,Edit,Write,MultiEdit,Grep,Glob,Agent" --max-budget-usd 5 -j 2
```

Every arm in a run gets the same tool allowlist, effort, turn cap, and (per task) budget. Baseline arms get no `XEND_*` environment variables (except `XEND_STATE_DIR`, used only to collect xend's own diagnostics and otherwise inert); xend arms add `XEND_PROFILE` and `XEND_ARCHITECT`. Nothing else differs between arms of the same task.

### Task-level overrides

A `task.json` can carry `"tools": "Bash,Read,...,Agent"` and/or `"budget_usd": N` to override the run's defaults for just that task — used for `project` tasks that need `Agent` (so the xend arm can spawn `xend:xend-worker` subagents) and a bigger budget than small bugfix tasks need.

### The `SCORE:` contract

A `test.sh` that only needs pass/fail should exit 0 on a correct solution, non-zero otherwise, same as any task. A `test.sh` that grades partial credit (hidden test suites, `project` tasks) should also print a line matching `^SCORE:\s*(\d+)\s*/\s*(\d+)` (anywhere in stdout or stderr, even when the script exits non-zero) — e.g. `echo "SCORE: 8/10"`. `run.js` records that as `score` (a 0..1 fraction) plus `score_passed`/`score_total`; `pass`/exit-code keeps its usual meaning regardless. Tasks without a `SCORE:` line get `score = pass`, so `analyze.js` can always use `score`.

## What is recorded per run

Pass/fail from `test.sh` (plus `score`/`score_passed`/`score_total` when `test.sh` prints a `SCORE:` line — see above), the four token meters of the main context (`input`, `cache_creation`, `cache_read`, `output`), the same summed over all models including subagents, uncached input, turns, wall time, cost as reported by Claude Code, the models used, `model_usage` (per-model token/cost breakdown from `modelUsage`), `cost_main_usd`/`cost_sub_usd` (cost split between the arm's own model and everything else — subagents), `subagent_stats` (spawned/completed/failed counts, when the run spawned any), `arm_kind`/`arm_model`/`arm_mode` alongside the arm's `label`, and what xend shaping did (count of shaped results, chars before and after, transform kinds). Raw result JSON is kept under `raw/`.

## How the verdict is computed

`analyze.js` picks a **base** arm — `--base <label>`, else the arm labelled `baseline`, else the first arm whose records have `arm_kind === 'baseline'`, else the first arm seen — and produces one paired comparison per remaining arm against that base (`node bench/analyze.js --json` returns `{ base, comparisons: [...] }`; with exactly two arms total the legacy top-level `overall`/`verdict`/`gates`/`gate`/`rows`/`categories` keys are also populated, for old callers and scripts).

For each comparison, per task: mean pass rate (and `score`) per arm across trials, paired difference `d = pass_treat - pass_base` (and `d_score`).
Overall: mean of `d`, a task-level bootstrap confidence interval (4,000 resamples, fixed seed), a sign test on non-tied tasks, and the **minimum detectable effect** for the run size: `MDE = (z_0.05 + z_0.80) * sd(d) / sqrt(n)` (one-sided, 80% power).

Three gates, all required for `PASS`:
1. quality: the one-sided 95% lower bound of the pass-rate delta is at or above **-3 percentage points**;
2. cost: the one-sided 95% upper bound of the cost change (Claude Code's `total_cost_usd`, subagents included) is below 0;
3. turns: the one-sided 95% upper bound of the turn delta is at most +0.25 (turns are the leading indicator of a condenser that hides what the model needs).
`FAIL` on any gate means a confident regression on that axis; anything else is `INCONCLUSIVE`, and the report says which effect size the run could have detected. Quality alone is not a promotion criterion: a plugin can keep quality flat and still cost more.

The markdown report renders one section per comparison (heading `## <treat> vs <base>`), each with the usual pass-rate/tokens/turns/cost table plus a **Score (fraction of hidden tests passed)** row, a **Cost split (main model / subagents)** row, a **Subagents spawned per task** row (only when any record in that comparison has `subagent_stats`), the per-category and per-task tables, and — when any record carries `model_usage` — a per-model `| Arm | model | tokens per task | cost per task |` table.

Tokens are counted from `modelUsage` (all models, subagents included), never from the main-loop `usage` field, which excludes subagent work. Characters removed by shaping are reported as a diagnostic only; savings claims come from the cost and token meters.

## Honest power statement

A 16-task suite run once cannot certify a 3-point bound; nothing that small can. With paired binary outcomes and typical between-arm correlation, detecting a 3-point drop at 80% power needs on the order of 750 paired task-runs (see `docs/RESEARCH.md`, section "Measuring quality"). The suite is built so evidence accumulates: every `runs.jsonl` under `bench/results/` is merged by `analyze.js`, repeated trials (`--runs`) shrink per-task variance, and the report always prints the MDE next to the point estimate. Token savings, by contrast, are continuous and large, so even a small run measures them tightly.

A profile is promoted to a default only when the merged evidence reaches `PASS`.

## Adding a task

Copy an existing task directory. Rules: fixture files under 30 KB (generate bigger artifacts in `gen.sh`, deterministic, offline, under 5 s); `test.sh` exits 0 only on a correct solution and prints a one-line reason otherwise; `reference/apply.sh` applies a correct solution; run `bash bench/selftest.sh`.
