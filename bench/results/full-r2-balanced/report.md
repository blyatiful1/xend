# xend bench report

Paired comparison of `xend` against `baseline` on 21 tasks (84 runs).

| Metric | baseline | xend | change |
|---|---|---|---|
| Pass rate | 90.5% | 95.2% | +4.8 pp (95% CI +0.0 pp to +11.9 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 210049 | 224796 | 6.4% (95% CI 1.5% to 11.0%) |
| Uncached input tokens per task | 13392 | 15097 | 12.7% |
| Output tokens per task | | | -3.2% |
| Turns per task | 4.5 | 4.6 | 0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.099 | 0.108 | 9.0% (95% CI 6.1% to 11.9%) |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 2 better, 0 worse, p = 0.50.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 8.2 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 11.4%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.40; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +16.7 pp | 8.7% |
| refactor | 2 | +0.0 pp | 7.4% |
| bugfix | 6 | +0.0 pp | 8.0% |
| reading | 5 | +10.0 pp | 6.3% |
| feature | 3 | +0.0 pp | 11.4% |
| navigation | 2 | +0.0 pp | -10.3% |

| Task | cat | pass base | pass xend | tokens base | tokens xend | ratio | turns Δ |
|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 100% | 155326 | 159829 | 1.03 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 312360 | 350062 | 1.12 | 0.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 209849 | 243247 | 1.16 | 0.5 |
| adv-middle-of-output | reading | 0% | 50% | 254616 | 311717 | 1.22 | 0.5 |
| adv-print-debugging | bugfix | 100% | 100% | 305870 | 367615 | 1.20 | 1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 200918 | 206594 | 1.03 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 201555 | 207230 | 1.03 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 201212 | 207836 | 1.03 | 0.5 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 201545 | 207204 | 1.03 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 203265 | 260970 | 1.28 | 0.5 |
| feature-input-validation | feature | 100% | 100% | 201516 | 207433 | 1.03 | 0.0 |
| feature-lru-cache | feature | 100% | 100% | 151949 | 156154 | 1.03 | 0.0 |
| navigation-find-constant | navigation | 100% | 100% | 202293 | 155127 | 0.77 | -1.0 |
| navigation-rename-function | navigation | 100% | 100% | 150882 | 154989 | 1.03 | 0.0 |
| qa-parse-record-impact | qa | 0% | 50% | 151106 | 181745 | 1.20 | 2.0 |
| qa-retry-config | qa | 100% | 100% | 150509 | 155081 | 1.03 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 304671 | 339128 | 1.11 | 0.5 |
| reading-config-drift | reading | 100% | 100% | 167947 | 172251 | 1.03 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 252197 | 232660 | 0.92 | -0.5 |
| reading-test-triage | reading | 100% | 100% | 279953 | 288115 | 1.03 | 0.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 151488 | 155729 | 1.03 | 0.0 |
