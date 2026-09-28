# xend bench report

Base arm: `baseline`, compared against 2 other arm(s): xend-main, xend-new.

## xend-main vs baseline

Paired comparison of `xend-main` against `baseline` on 3 tasks (18 runs).

| Metric | baseline | xend-main | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 766776 | 629212 | -13.6% (95% CI -40.9% to 24.3%) |
| Uncached input tokens per task | 33880 | 33907 | 0.1% |
| Output tokens per task | | | -5.0% |
| Turns per task | 23.3 | 21.3 | -2.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.395 | 0.362 | -7.1% (95% CI -20.5% to 12.6%) |
| Cost split (main model / subagents) | $0.395 / $0.000 | $0.362 / $0.000 | main -8.4%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 3.9%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 0.50; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | -13.6% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 870632 | 514350 | 0.59 | -2.5 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 831561 | 630037 | 0.76 | -5.5 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 598135 | 743248 | 1.24 | 2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 766776 | $0.395 |
| xend-main | claude-sonnet-5 | 629212 | $0.362 |

## xend-new vs baseline

Paired comparison of `xend-new` against `baseline` on 3 tasks (18 runs).

| Metric | baseline | xend-new | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 766776 | 650661 | -8.8% (95% CI -52.3% to 47.0%) |
| Uncached input tokens per task | 33880 | 35880 | 5.9% |
| Output tokens per task | | | -0.4% |
| Turns per task | 23.3 | 23.2 | -0.2 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.395 | 0.378 | -2.3% (95% CI -23.9% to 30.0%) |
| Cost split (main model / subagents) | $0.395 / $0.000 | $0.378 / $0.000 | main -4.4%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 15.7%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 3.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | -8.8% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 870632 | 415583 | 0.48 | -2.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 831561 | 657405 | 0.79 | -4.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 598135 | 878995 | 1.47 | 5.5 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 766776 | $0.395 |
| xend-new | claude-sonnet-5 | 650661 | $0.378 |

