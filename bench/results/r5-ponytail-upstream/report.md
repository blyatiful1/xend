# xend bench report

Paired comparison of `xend` against `baseline` on 21 tasks (42 runs).

| Metric | baseline | xend | change |
|---|---|---|---|
| Pass rate | 95.2% | 90.5% | -4.8 pp (95% CI -14.3 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 219743 | 242416 | 13.9% (95% CI 3.8% to 26.6%) |
| Uncached input tokens per task | 13703 | 16573 | 20.9% |
| Output tokens per task | | | 8.6% |
| Turns per task | 4.5 | 5.0 | 0.4 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.102 | 0.118 | 16.7% (95% CI 10.6% to 24.0%) |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 11.8 pp.

**Verdict: FAIL** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -14.3 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 22.8%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 1.14; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | 41.6% |
| refactor | 2 | +0.0 pp | 33.4% |
| bugfix | 6 | +0.0 pp | 2.6% |
| reading | 5 | -20.0 pp | -0.9% |
| feature | 3 | +0.0 pp | 26.5% |
| navigation | 2 | +0.0 pp | 5.4% |

| Task | cat | pass base | pass xend | tokens base | tokens xend | ratio | turns Δ |
|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 155650 | 163882 | 1.05 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 284214 | 356979 | 1.26 | 3.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 209845 | 221669 | 1.06 | 0.0 |
| adv-middle-of-output | reading | 100% | 0% | 305321 | 266139 | 0.87 | -2.0 |
| adv-print-debugging | bugfix | 100% | 100% | 305965 | 268129 | 0.88 | -1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 200927 | 212043 | 1.06 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 201616 | 212712 | 1.06 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 201217 | 212368 | 1.06 | 0.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 201598 | 212743 | 1.06 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 202759 | 268367 | 1.32 | 1.0 |
| feature-input-validation | feature | 100% | 100% | 201497 | 212948 | 1.06 | 0.0 |
| feature-lru-cache | feature | 100% | 100% | 151914 | 214943 | 1.41 | 1.0 |
| navigation-find-constant | navigation | 100% | 100% | 202274 | 159119 | 0.79 | -1.0 |
| navigation-rename-function | navigation | 100% | 100% | 201436 | 266238 | 1.32 | 1.0 |
| qa-parse-record-impact | qa | 0% | 0% | 150701 | 322187 | 2.14 | 7.0 |
| qa-retry-config | qa | 100% | 100% | 150483 | 159000 | 1.06 | 0.0 |
| reading-config-drift | reading | 100% | 100% | 167971 | 176248 | 1.05 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 356342 | 375875 | 1.05 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 252404 | 273045 | 1.08 | 0.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 151491 | 213992 | 1.41 | 1.0 |
| reading-test-triage | reading | 100% | 100% | 358985 | 322111 | 0.90 | -1.0 |
