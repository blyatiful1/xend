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

Pre-registration: the shipped bundle (a profile) is what the quality gate certifies. Individual transforms are ablated with the cheap, high-power token and turn endpoints (`XEND_SHAPE_*=0` kill switches, `--extra`), not by re-running the quality gate per transform.

## Run

```bash
bash bench/selftest.sh                       # task suite is sound (fail before, pass after)
node bench/run.js --list                     # tasks
node bench/run.js --runs 3 --model sonnet --effort low -j 3     # full paired run
node bench/analyze.js                        # merges every bench/results/*/runs.jsonl
node bench/analyze.js bench/results/<run> --md report.md
```

`run.js` options: `--arms baseline,xend`, `--runs k`, `--model`, `--effort`, `--tasks a,b` or glob, `--category`, `--concurrency`, `--max-budget-usd` (per run), `--profile lite|balanced|aggressive` (xend arm), `--keep` (keep work dirs), `--extra "<flag>"` (passed to both arms).

Both arms run with `--strict-mcp-config` and the same tool allowlist, model, effort, turn cap, and budget. The xend arm adds `--plugin-dir <repo>` and `XEND_PROFILE`. Nothing else differs.

## What is recorded per run

Pass/fail from `test.sh`, the four token meters of the main context (`input`, `cache_creation`, `cache_read`, `output`), the same summed over all models including subagents, uncached input, turns, wall time, cost as reported by Claude Code, the models used, and what xend shaping did (count of shaped results, chars before and after, transform kinds). Raw result JSON is kept under `raw/`.

## How the verdict is computed

For each task: mean pass rate per arm across trials, paired difference `d = pass_xend - pass_baseline`.
Overall: mean of `d`, a task-level bootstrap confidence interval (4,000 resamples, fixed seed), a sign test on non-tied tasks, and the **minimum detectable effect** for the run size: `MDE = (z_0.05 + z_0.80) * sd(d) / sqrt(n)` (one-sided, 80% power).

Three gates, all required for `PASS`:
1. quality: the one-sided 95% lower bound of the pass-rate delta is at or above **-3 percentage points**;
2. cost: the one-sided 95% upper bound of the cost change (Claude Code's `total_cost_usd`, subagents included) is below 0;
3. turns: the one-sided 95% upper bound of the turn delta is at most +0.25 (turns are the leading indicator of a condenser that hides what the model needs).
`FAIL` on any gate means a confident regression on that axis; anything else is `INCONCLUSIVE`, and the report says which effect size the run could have detected. Quality alone is not a promotion criterion: a plugin can keep quality flat and still cost more.

Tokens are counted from `modelUsage` (all models, subagents included), never from the main-loop `usage` field, which excludes subagent work. Characters removed by shaping are reported as a diagnostic only; savings claims come from the cost and token meters.

## Honest power statement

A 16-task suite run once cannot certify a 3-point bound; nothing that small can. With paired binary outcomes and typical between-arm correlation, detecting a 3-point drop at 80% power needs on the order of 750 paired task-runs (see `docs/RESEARCH.md`, section "Measuring quality"). The suite is built so evidence accumulates: every `runs.jsonl` under `bench/results/` is merged by `analyze.js`, repeated trials (`--runs`) shrink per-task variance, and the report always prints the MDE next to the point estimate. Token savings, by contrast, are continuous and large, so even a small run measures them tightly.

A profile is promoted to a default only when the merged evidence reaches `PASS`.

## Adding a task

Copy an existing task directory. Rules: fixture files under 30 KB (generate bigger artifacts in `gen.sh`, deterministic, offline, under 5 s); `test.sh` exits 0 only on a correct solution and prints a one-line reason otherwise; `reference/apply.sh` applies a correct solution; run `bash bench/selftest.sh`.
