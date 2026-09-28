# xend bench report

Base arm: `baseline`, compared against 2 other arm(s): xend-main, xend-final.

## xend-main vs baseline

Paired comparison of `xend-main` against `baseline` on 21 tasks (126 runs).

| Metric | baseline | xend-main | change |
|---|---|---|---|
| Pass rate | 92.9% | 92.9% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 92.9% | 92.9% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 123764 | 132934 | 10.2% (95% CI 2.3% to 19.2%) |
| Uncached input tokens per task | 12515 | 13939 | 11.4% |
| Output tokens per task | | | -0.5% |
| Turns per task | 4.5 | 4.6 | 0.1 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.079 | 0.086 | 9.3% (95% CI 4.9% to 14.0%) |
| Cost split (main model / subagents) | $0.079 / $0.000 | $0.086 / $0.000 | main 8.3%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 13.3%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.52; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | 20.8% |
| refactor | 2 | +0.0 pp | 23.2% |
| bugfix | 6 | +0.0 pp | 7.6% |
| reading | 5 | +0.0 pp | 0.7% |
| feature | 3 | +0.0 pp | 15.5% |
| navigation | 2 | +0.0 pp | 4.6% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 100% | 100% | 109178 | 94573 | 0.87 | -0.5 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 192264 | 238323 | 1.24 | 2.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 122900 | 161119 | 1.31 | 1.0 |
| adv-middle-of-output | reading | 50% | 50% | 50% | 50% | 144744 | 151435 | 1.05 | -0.5 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 191152 | 183831 | 0.96 | -0.5 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114141 | 119799 | 1.05 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114774 | 120457 | 1.05 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116239 | 120077 | 1.03 | -1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114740 | 120458 | 1.05 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 146061 | 121636 | 0.83 | -1.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 86067 | 120594 | 1.40 | 1.0 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 86805 | 106734 | 1.23 | 0.5 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 100864 | 105532 | 1.05 | -0.5 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85833 | 89816 | 1.05 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 0% | 0% | 71178 | 121173 | 1.70 | 3.5 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85437 | 90152 | 1.06 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 206186 | 182325 | 0.88 | -1.5 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102866 | 107121 | 1.04 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 125529 | 130743 | 1.04 | -0.5 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 195697 | 199979 | 1.02 | 0.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86392 | 105743 | 1.22 | 0.5 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 123764 | $0.079 |
| xend-main | claude-sonnet-5 | 132934 | $0.086 |

## xend-final vs baseline

Paired comparison of `xend-final` against `baseline` on 21 tasks (126 runs).

| Metric | baseline | xend-final | change |
|---|---|---|---|
| Pass rate | 92.9% | 95.2% | +2.4 pp (95% CI +0.0 pp to +7.1 pp) |
| Score (fraction of hidden tests passed) | 92.9% | 95.2% | +2.4 pp (95% CI +0.0 pp to +7.1 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 123764 | 111851 | -6.2% (95% CI -14.1% to 4.8%) |
| Uncached input tokens per task | 12515 | 12720 | 1.6% |
| Output tokens per task | | | -12.4% |
| Turns per task | 4.5 | 4.2 | -0.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.079 | 0.078 | -1.2% (95% CI -5.0% to 3.7%) |
| Cost split (main model / subagents) | $0.079 / $0.000 | $0.078 / $0.000 | main -1.7%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 1 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 5.9 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 2.8%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta 0.17; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | 29.2% |
| refactor | 2 | +0.0 pp | -4.5% |
| bugfix | 6 | +0.0 pp | -22.6% |
| reading | 5 | +10.0 pp | -9.0% |
| feature | 3 | +0.0 pp | -5.6% |
| navigation | 2 | +0.0 pp | -6.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 100% | 100% | 109178 | 109718 | 1.00 | -1.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 192264 | 172403 | 0.90 | 0.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 122900 | 94144 | 0.77 | 1.0 |
| adv-middle-of-output | reading | 50% | 100% | 50% | 100% | 144744 | 132071 | 0.91 | -0.5 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 191152 | 162695 | 0.85 | -1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114141 | 86562 | 0.76 | -1.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114774 | 86965 | 0.76 | -1.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116239 | 87359 | 0.75 | -1.5 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114740 | 87019 | 0.76 | -1.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 146061 | 117598 | 0.81 | -1.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 86067 | 87245 | 1.01 | 0.0 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 86805 | 88009 | 1.01 | 0.0 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 100864 | 87026 | 0.86 | -1.0 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85833 | 87011 | 1.01 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 0% | 0% | 71178 | 132241 | 1.86 | 4.0 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85437 | 86643 | 1.01 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 206186 | 178169 | 0.86 | -1.0 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102866 | 103784 | 1.01 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 125529 | 126795 | 1.01 | 0.0 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 195697 | 147847 | 0.76 | -1.5 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86392 | 87584 | 1.01 | 0.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 123764 | $0.079 |
| xend-final | claude-sonnet-5 | 111851 | $0.078 |

