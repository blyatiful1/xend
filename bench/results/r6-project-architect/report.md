# xend bench report

Base arm: `solo-sonnet`, compared against 4 other arm(s): plain-sonnet, solo-fable, arch-sonnet, arch-fable.

## plain-sonnet vs solo-sonnet

Paired comparison of `plain-sonnet` against `solo-sonnet` on 2 tasks (10 runs).

| Metric | solo-sonnet | plain-sonnet | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1247073 | 1028798 | -15.6% (95% CI -37.9% to 6.7%) |
| Uncached input tokens per task | 36023 | 38076 | 5.7% |
| Output tokens per task | | | 6.1% |
| Turns per task | 19.5 | 17.0 | -2.5 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.510 | 0.484 | -5.0% (95% CI -24.6% to 14.6%) |
| Cost split (main model / subagents) | $0.510 / $0.000 | $0.484 / $0.000 | main -5.1%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 14.6%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 1.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 2 | +0.0 pp | -15.6% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 1140964 | 1216859 | 1.07 | 1.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 1353182 | 840736 | 0.62 | -6.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| plain-sonnet | claude-sonnet-5 | 1028798 | $0.484 |
| solo-sonnet | claude-sonnet-5 | 1247073 | $0.510 |

## solo-fable vs solo-sonnet

Paired comparison of `solo-fable` against `solo-sonnet` on 2 tasks (10 runs).

| Metric | solo-sonnet | solo-fable | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1247073 | 525111 | -56.3% (95% CI -74.8% to -37.8%) |
| Uncached input tokens per task | 36023 | 38450 | 6.7% |
| Output tokens per task | | | 13.2% |
| Turns per task | 19.5 | 13.0 | -6.5 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.510 | 1.605 | 214.8% (95% CI 169.2% to 260.4%) |
| Cost split (main model / subagents) | $0.510 / $0.000 | $1.605 / $0.000 | main 214.4%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 260.4%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -6.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 2 | +0.0 pp | -56.3% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 1140964 | 709591 | 0.62 | -6.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 1353182 | 340631 | 0.25 | -7.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo-fable | claude-fable-5-1 | 525111 | $1.605 |
| solo-sonnet | claude-sonnet-5 | 1247073 | $0.510 |

## arch-sonnet vs solo-sonnet

Paired comparison of `arch-sonnet` against `solo-sonnet` on 2 tasks (10 runs).

| Metric | solo-sonnet | arch-sonnet | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1247073 | 2523896 | 103.4% (95% CI 91.1% to 115.8%) |
| Uncached input tokens per task | 36023 | 2356 | -93.5% |
| Output tokens per task | | | -94.6% |
| Turns per task | 19.5 | 3.5 | -16.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.510 | 1.146 | 124.6% (95% CI 121.1% to 128.1%) |
| Cost split (main model / subagents) | $0.510 / $0.000 | $1.146 / $0.000 | main 124.6%, sub n/a |
| Subagents spawned per task | 0.00 | 6.00 | 6.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 128.1%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -13.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 2 | +0.0 pp | 103.4% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 1140964 | 2462383 | 2.16 | -13.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 1353182 | 2585408 | 1.91 | -19.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| arch-sonnet | claude-sonnet-5 | 2523896 | $1.146 |
| solo-sonnet | claude-sonnet-5 | 1247073 | $0.510 |

## arch-fable vs solo-sonnet

Paired comparison of `arch-fable` against `solo-sonnet` on 2 tasks (10 runs).

| Metric | solo-sonnet | arch-fable | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1247073 | 995203 | -18.8% (95% CI -35.1% to -2.6%) |
| Uncached input tokens per task | 36023 | 58303 | 61.9% |
| Output tokens per task | | | 100.1% |
| Turns per task | 19.5 | 24.0 | 4.5 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.510 | 2.685 | 426.3% (95% CI 381.6% to 471.1%) |
| Cost split (main model / subagents) | $0.510 / $0.000 | $2.632 / $0.052 | main 415.7%, sub n/a |
| Subagents spawned per task | 0.00 | 3.00 | 3.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 471.1%; must be below 0%)
- turns: FAIL (one-sided 95% upper bound of turn delta 8.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 2 | +0.0 pp | -18.8% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 1140964 | 1111793 | 0.97 | 8.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 1353182 | 878612 | 0.65 | 1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| arch-fable | claude-fable-5-1 | 873462 | $2.632 |
| arch-fable | claude-haiku-4-5-20251001 | 121741 | $0.052 |
| solo-sonnet | claude-sonnet-5 | 1247073 | $0.510 |

