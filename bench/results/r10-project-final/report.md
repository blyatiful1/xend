# xend bench report

Base arm: `baseline`, compared against 2 other arm(s): xend-main, xend-final.

## xend-main vs baseline

Paired comparison of `xend-main` against `baseline` on 3 tasks (18 runs).

| Metric | baseline | xend-main | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 911601 | 599633 | -29.5% (95% CI -55.2% to -1.6%) |
| Uncached input tokens per task | 35022 | 34334 | -2.0% |
| Output tokens per task | | | -7.2% |
| Turns per task | 25.0 | 21.2 | -3.8 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.429 | 0.357 | -16.1% (95% CI -32.0% to 0.4%) |
| Cost split (main model / subagents) | $0.429 / $0.000 | $0.357 / $0.000 | main -16.9%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: PASS** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -5.3%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -2.33; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | -29.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1184953 | 531106 | 0.45 | -3.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 699041 | 688167 | 0.98 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 850808 | 579627 | 0.68 | -6.5 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 911601 | $0.429 |
| xend-main | claude-sonnet-5 | 599633 | $0.357 |

## xend-final vs baseline

Paired comparison of `xend-final` against `baseline` on 3 tasks (18 runs).

| Metric | baseline | xend-final | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 911601 | 572508 | -31.2% (95% CI -70.2% to -8.7%) |
| Uncached input tokens per task | 35022 | 34956 | -0.2% |
| Output tokens per task | | | -4.7% |
| Turns per task | 25.0 | 22.0 | -3.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.429 | 0.357 | -15.9% (95% CI -39.6% to -2.5%) |
| Cost split (main model / subagents) | $0.429 / $0.000 | $0.357 / $0.000 | main -16.9%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: PASS** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -3.5%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -2.33; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | -31.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1184953 | 352970 | 0.30 | -4.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 699041 | 638525 | 0.91 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 850808 | 726030 | 0.85 | -3.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 911601 | $0.429 |
| xend-final | claude-sonnet-5 | 572508 | $0.357 |

