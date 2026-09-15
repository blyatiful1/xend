# xend bench report

Paired comparison of `xend` against `baseline` on 21 tasks (42 runs).

| Metric | baseline | xend | change |
|---|---|---|---|
| Pass rate | 90.5% | 90.5% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 211247 | 219484 | 6.8% (95% CI -0.8% to 14.2%) |
| Uncached input tokens per task | 18093 | 16607 | -8.2% |
| Output tokens per task | | | -4.9% |
| Turns per task | 4.3 | 4.5 | 0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.117 | 0.113 | 3.9% (95% CI -4.5% to 10.0%) |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 9.3%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.57; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | 2.5% |
| refactor | 2 | +0.0 pp | -17.1% |
| bugfix | 6 | +0.0 pp | 5.7% |
| reading | 5 | +0.0 pp | 11.0% |
| feature | 3 | +0.0 pp | 25.3% |
| navigation | 2 | +0.0 pp | 2.2% |

| Task | cat | pass base | pass xend | tokens base | tokens xend | ratio | turns Δ |
|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 155565 | 158880 | 1.02 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 448553 | 284707 | 0.63 | -2.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 209849 | 215244 | 1.03 | 0.0 |
| adv-middle-of-output | reading | 0% | 0% | 257200 | 258157 | 1.00 | -1.0 |
| adv-print-debugging | bugfix | 100% | 100% | 254403 | 312945 | 1.23 | 1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 200929 | 205667 | 1.02 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 201599 | 206386 | 1.02 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 203164 | 206080 | 1.01 | -1.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 201572 | 206353 | 1.02 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 202843 | 207506 | 1.02 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 151095 | 206534 | 1.37 | 1.0 |
| feature-lru-cache | feature | 100% | 100% | 151975 | 208193 | 1.37 | 1.0 |
| navigation-find-constant | navigation | 100% | 100% | 202300 | 206943 | 1.02 | 0.0 |
| navigation-rename-function | navigation | 100% | 100% | 150923 | 154203 | 1.02 | 0.0 |
| qa-parse-record-impact | qa | 0% | 0% | 150717 | 154765 | 1.03 | 3.0 |
| qa-retry-config | qa | 100% | 100% | 150488 | 154698 | 1.03 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 356822 | 311195 | 0.87 | -1.0 |
| reading-config-drift | reading | 100% | 100% | 167983 | 171486 | 1.02 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 211920 | 257609 | 1.22 | 1.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 151627 | 155065 | 1.02 | 0.0 |
| reading-test-triage | reading | 100% | 100% | 254663 | 366545 | 1.44 | 2.0 |
