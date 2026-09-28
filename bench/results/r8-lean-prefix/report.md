# xend bench report

Base arm: `baseline`, compared against 3 other arm(s): xend-new-noat, xend-new, xend-main.

## xend-new-noat vs baseline

Paired comparison of `xend-new-noat` against `baseline` on 21 tasks (168 runs).

| Metric | baseline | xend-new-noat | change |
|---|---|---|---|
| Pass rate | 95.2% | 92.9% | -2.4 pp (95% CI -7.1 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 95.2% | 92.9% | -2.4 pp (95% CI -7.1 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 133856 | 126156 | 0.6% (95% CI -8.0% to 8.6%) |
| Uncached input tokens per task | 13423 | 13278 | -1.1% |
| Output tokens per task | | | -6.0% |
| Turns per task | 4.7 | 4.6 | -0.1 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.086 | 0.082 | 0.4% (95% CI -7.3% to 7.1%) |
| Cost split (main model / subagents) | $0.086 / $0.000 | $0.082 / $0.000 | main -5.4%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 5.9 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -7.1 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 6.2%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.31; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | -3.1% |
| refactor | 2 | +0.0 pp | -0.7% |
| bugfix | 6 | +0.0 pp | 11.0% |
| reading | 5 | -10.0 pp | -10.3% |
| feature | 3 | +0.0 pp | 2.0% |
| navigation | 2 | +0.0 pp | 1.8% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 100% | 100% | 140802 | 92236 | 0.66 | -0.5 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 197089 | 190760 | 0.97 | 0.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 122884 | 142412 | 1.16 | 0.5 |
| adv-middle-of-output | reading | 100% | 50% | 100% | 50% | 148136 | 133483 | 0.90 | -1.0 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 145932 | 209686 | 1.44 | 2.0 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114154 | 116495 | 1.02 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114796 | 117091 | 1.02 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116282 | 116778 | 1.00 | -1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114734 | 117121 | 1.02 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 101481 | 118158 | 1.16 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 100332 | 87797 | 0.88 | -0.5 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 101716 | 103781 | 1.02 | 0.0 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 86241 | 87637 | 1.02 | -0.5 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85681 | 87462 | 1.02 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 0% | 0% | 71138 | 87650 | 1.23 | 2.0 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85427 | 87156 | 1.02 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 174435 | 207830 | 1.19 | 1.5 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102912 | 104612 | 1.02 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 423422 | 188619 | 0.45 | -4.0 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 176872 | 164371 | 0.93 | -0.5 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86515 | 88149 | 1.02 | 0.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 133856 | $0.086 |
| xend-new-noat | claude-sonnet-5 | 126156 | $0.082 |

## xend-new vs baseline

Paired comparison of `xend-new` against `baseline` on 21 tasks (168 runs).

| Metric | baseline | xend-new | change |
|---|---|---|---|
| Pass rate | 95.2% | 92.9% | -2.4 pp (95% CI -7.1 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 95.2% | 92.9% | -2.4 pp (95% CI -7.1 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 133856 | 111541 | -9.4% (95% CI -18.7% to -0.6%) |
| Uncached input tokens per task | 13423 | 12875 | -4.1% |
| Output tokens per task | | | -14.1% |
| Turns per task | 4.7 | 4.1 | -0.6 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.086 | 0.077 | -5.1% (95% CI -13.1% to 1.1%) |
| Cost split (main model / subagents) | $0.086 / $0.000 | $0.077 / $0.000 | main -11.3%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 5.9 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -7.1 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 0.3%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta 0.02; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | -3.1% |
| refactor | 2 | +0.0 pp | 8.4% |
| bugfix | 6 | +0.0 pp | -14.1% |
| reading | 5 | -10.0 pp | -23.1% |
| feature | 3 | +0.0 pp | -3.0% |
| navigation | 2 | +0.0 pp | 2.0% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 100% | 100% | 140802 | 92194 | 0.65 | -0.5 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 197089 | 226645 | 1.15 | 2.5 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 122884 | 109313 | 0.89 | 0.0 |
| adv-middle-of-output | reading | 100% | 50% | 100% | 50% | 148136 | 147797 | 1.00 | -0.5 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 145932 | 179094 | 1.23 | 1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114154 | 87126 | 0.76 | -1.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114796 | 87503 | 0.76 | -1.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116282 | 87309 | 0.75 | -2.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114734 | 87578 | 0.76 | -1.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 101481 | 118313 | 1.17 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 100332 | 87771 | 0.87 | -0.5 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 101716 | 88572 | 0.87 | -0.5 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 86241 | 87648 | 1.02 | -0.5 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85681 | 87663 | 1.02 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 0% | 0% | 71138 | 87564 | 1.23 | 2.0 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85427 | 87179 | 1.02 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 174435 | 132564 | 0.76 | -1.5 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102912 | 104576 | 1.02 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 423422 | 133998 | 0.32 | -7.0 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 176872 | 133797 | 0.76 | -1.5 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86515 | 88153 | 1.02 | 0.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 133856 | $0.086 |
| xend-new | claude-sonnet-5 | 111541 | $0.077 |

## xend-main vs baseline

Paired comparison of `xend-main` against `baseline` on 21 tasks (168 runs).

| Metric | baseline | xend-main | change |
|---|---|---|---|
| Pass rate | 95.2% | 88.1% | -7.1 pp (95% CI -19.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 95.2% | 88.1% | -7.1 pp (95% CI -19.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 133856 | 128027 | 5.2% (95% CI -4.7% to 13.2%) |
| Uncached input tokens per task | 13423 | 13680 | 1.9% |
| Output tokens per task | | | -4.9% |
| Turns per task | 4.7 | 4.5 | -0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.086 | 0.083 | 4.2% (95% CI -4.9% to 11.0%) |
| Cost split (main model / subagents) | $0.086 / $0.000 | $0.083 / $0.000 | main -3.5%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 2 worse, p = 0.50.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 13.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -16.7 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 10.1%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.29; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | -16.7 pp | 15.0% |
| refactor | 2 | +0.0 pp | 3.6% |
| bugfix | 6 | +0.0 pp | 6.6% |
| reading | 5 | -20.0 pp | -11.3% |
| feature | 3 | +0.0 pp | 15.3% |
| navigation | 2 | +0.0 pp | 13.8% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 50% | 100% | 50% | 140802 | 109681 | 0.78 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 197089 | 201877 | 1.02 | 1.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 122884 | 130683 | 1.06 | 0.5 |
| adv-middle-of-output | reading | 100% | 0% | 100% | 0% | 148136 | 136367 | 0.92 | -1.0 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 145932 | 168482 | 1.15 | 0.5 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114154 | 119788 | 1.05 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114796 | 120445 | 1.05 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116282 | 120099 | 1.03 | -1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114734 | 120406 | 1.05 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 101481 | 106410 | 1.05 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 100332 | 121039 | 1.21 | 0.5 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 101716 | 122515 | 1.20 | 0.5 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 86241 | 105568 | 1.22 | 0.0 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85681 | 90053 | 1.05 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 0% | 0% | 71138 | 89738 | 1.26 | 0.5 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85427 | 120289 | 1.41 | 1.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 174435 | 197700 | 1.13 | 0.5 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102912 | 107122 | 1.04 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 423422 | 125266 | 0.30 | -8.0 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 176872 | 184408 | 1.04 | 0.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86515 | 90632 | 1.05 | 0.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 133856 | $0.086 |
| xend-main | claude-sonnet-5 | 128027 | $0.083 |

