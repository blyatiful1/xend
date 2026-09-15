# xend bench report

Paired comparison of `xend` against `baseline` on 21 tasks (42 runs).

| Metric | baseline | xend | change |
|---|---|---|---|
| Pass rate | 95.2% | 90.5% | -4.8 pp (95% CI -14.3 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 226495 | 223825 | 0.8% (95% CI -5.9% to 7.7%) |
| Uncached input tokens per task | 13567 | 14713 | 8.4% |
| Output tokens per task | | | -8.6% |
| Turns per task | 4.8 | 4.5 | -0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.103 | 0.107 | 3.5% (95% CI -1.2% to 7.9%) |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 11.8 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -14.3 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 7.2%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta 0.14; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | 12.8% |
| refactor | 2 | +0.0 pp | -2.4% |
| bugfix | 6 | +0.0 pp | 1.9% |
| reading | 5 | -20.0 pp | 1.0% |
| feature | 3 | +0.0 pp | -12.2% |
| navigation | 2 | +0.0 pp | 1.6% |

| Task | cat | pass base | pass xend | tokens base | tokens xend | ratio | turns Δ |
|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 155395 | 157851 | 1.02 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 309463 | 289596 | 0.94 | -1.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 209727 | 268013 | 1.28 | 1.0 |
| adv-middle-of-output | reading | 100% | 0% | 303662 | 256430 | 0.84 | -1.0 |
| adv-print-debugging | bugfix | 100% | 100% | 410499 | 310957 | 0.76 | -2.0 |
| bugfix-date-range | bugfix | 100% | 100% | 200911 | 204309 | 1.02 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 201550 | 204910 | 1.02 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 201195 | 206485 | 1.03 | 1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 201545 | 204909 | 1.02 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 254431 | 257470 | 1.01 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 201500 | 204935 | 1.02 | 0.0 |
| feature-lru-cache | feature | 100% | 100% | 255888 | 154535 | 0.60 | -2.0 |
| navigation-find-constant | navigation | 100% | 100% | 150978 | 153329 | 1.02 | 0.0 |
| navigation-rename-function | navigation | 100% | 100% | 150809 | 153269 | 1.02 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 151223 | 152933 | 1.01 | -3.0 |
| qa-retry-config | qa | 100% | 100% | 150561 | 204287 | 1.36 | 1.0 |
| reading-big-file-edit | reading | 100% | 100% | 356693 | 414266 | 1.16 | 1.0 |
| reading-config-drift | reading | 100% | 100% | 167941 | 170397 | 1.01 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 266060 | 215119 | 0.81 | -1.0 |
| reading-test-triage | reading | 100% | 100% | 254510 | 311082 | 1.22 | 1.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 201859 | 205234 | 1.02 | 0.0 |
