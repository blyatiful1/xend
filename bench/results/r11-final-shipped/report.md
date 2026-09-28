# xend bench report

Base arm: `baseline`, compared against 1 other arm(s): xend-final.

## xend-final vs baseline

Paired comparison of `xend-final` against `baseline` on 21 tasks (84 runs).

| Metric | baseline | xend-final | change |
|---|---|---|---|
| Pass rate | 90.5% | 97.6% | +7.1 pp (95% CI +0.0 pp to +19.0 pp) |
| Score (fraction of hidden tests passed) | 90.5% | 97.6% | +7.1 pp (95% CI +0.0 pp to +19.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 119571 | 111963 | -5.0% (95% CI -11.2% to 2.2%) |
| Uncached input tokens per task | 12502 | 12808 | 2.4% |
| Output tokens per task | | | -9.2% |
| Turns per task | 4.4 | 4.2 | -0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.078 | 0.077 | -1.2% (95% CI -4.2% to 2.6%) |
| Cost split (main model / subagents) | $0.078 / $0.000 | $0.077 / $0.000 | main -1.4%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 2 better, 0 worse, p = 0.50.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 13.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 1.9%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.31; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +16.7 pp | 15.2% |
| refactor | 2 | +0.0 pp | 4.6% |
| bugfix | 6 | +0.0 pp | -20.1% |
| reading | 5 | +20.0 pp | -7.1% |
| feature | 3 | +0.0 pp | -2.5% |
| navigation | 2 | +0.0 pp | 1.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 100% | 100% | 90731 | 91712 | 1.01 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 201080 | 216695 | 1.08 | -0.5 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 124224 | 93581 | 0.75 | -1.5 |
| adv-middle-of-output | reading | 0% | 100% | 0% | 100% | 146187 | 147092 | 1.01 | -0.5 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 160816 | 162723 | 1.01 | 0.0 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114139 | 86567 | 0.76 | -1.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114834 | 86957 | 0.76 | -1.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 115404 | 87352 | 0.76 | -1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114769 | 87025 | 0.76 | -1.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 131009 | 117532 | 0.90 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 86082 | 87205 | 1.01 | 0.0 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 86805 | 88029 | 1.01 | 0.0 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 100726 | 102011 | 1.01 | 0.0 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85906 | 86852 | 1.01 | 0.0 |
| qa-parse-record-impact | qa | 0% | 50% | 0% | 50% | 71243 | 102507 | 1.44 | 4.5 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85947 | 86566 | 1.01 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 189673 | 162077 | 0.85 | -1.0 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102902 | 103751 | 1.01 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 141361 | 134540 | 0.95 | 0.5 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86378 | 87580 | 1.01 | 0.0 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 160786 | 132879 | 0.83 | -1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 119571 | $0.078 |
| xend-final | claude-sonnet-5 | 111963 | $0.077 |

