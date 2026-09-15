# xend bench report

Base arm: `solo-sonnet`, compared against 4 other arm(s): plain-sonnet, solo-fable, arch-sonnet, arch-fable.

## plain-sonnet vs solo-sonnet

Paired comparison of `plain-sonnet` against `solo-sonnet` on 1 tasks (5 runs).

| Metric | solo-sonnet | plain-sonnet | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1560954 | 1486718 | -4.8% (95% CI -4.8% to -4.8%) |
| Uncached input tokens per task | 37371 | 36865 | -1.4% |
| Output tokens per task | | | -4.9% |
| Turns per task | 36.0 | 34.0 | -2.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.541 | 0.520 | -3.9% (95% CI -3.9% to -3.9%) |
| Cost split (main model / subagents) | $0.541 / $0.000 | $0.520 / $0.000 | main -3.9%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: PASS** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -3.9%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -2.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 1 | +0.0 pp | -4.8% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1560954 | 1486718 | 0.95 | -2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| plain-sonnet | claude-sonnet-5 | 1486718 | $0.520 |
| solo-sonnet | claude-sonnet-5 | 1560954 | $0.541 |

## solo-fable vs solo-sonnet

Paired comparison of `solo-fable` against `solo-sonnet` on 1 tasks (5 runs).

| Metric | solo-sonnet | solo-fable | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1560954 | 622359 | -60.1% (95% CI -60.1% to -60.1%) |
| Uncached input tokens per task | 37371 | 34274 | -8.3% |
| Output tokens per task | | | -1.2% |
| Turns per task | 36.0 | 20.0 | -16.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.541 | 1.267 | 134.1% (95% CI 134.1% to 134.1%) |
| Cost split (main model / subagents) | $0.541 / $0.000 | $1.267 / $0.000 | main 134.1%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 134.1%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -16.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 1 | +0.0 pp | -60.1% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1560954 | 622359 | 0.40 | -16.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo-fable | claude-fable-5-1 | 622359 | $1.267 |
| solo-sonnet | claude-sonnet-5 | 1560954 | $0.541 |

## arch-sonnet vs solo-sonnet

Paired comparison of `arch-sonnet` against `solo-sonnet` on 1 tasks (5 runs).

| Metric | solo-sonnet | arch-sonnet | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1560954 | 2989928 | 91.5% (95% CI 91.5% to 91.5%) |
| Uncached input tokens per task | 37371 | 2745 | -92.7% |
| Output tokens per task | | | -93.2% |
| Turns per task | 36.0 | 4.0 | -32.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.541 | 1.077 | 98.9% (95% CI 98.9% to 98.9%) |
| Cost split (main model / subagents) | $0.541 / $0.000 | $0.976 / $0.101 | main 80.3%, sub n/a |
| Subagents spawned per task | 0.00 | 6.00 | 6.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 98.9%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -32.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 1 | +0.0 pp | 91.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1560954 | 2989928 | 1.92 | -32.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| arch-sonnet | claude-haiku-4-5-20251001 | 251649 | $0.101 |
| arch-sonnet | claude-sonnet-5 | 2738279 | $0.976 |
| solo-sonnet | claude-sonnet-5 | 1560954 | $0.541 |

## arch-fable vs solo-sonnet

Paired comparison of `arch-fable` against `solo-sonnet` on 1 tasks (5 runs).

| Metric | solo-sonnet | arch-fable | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 1560954 | 1211822 | -22.4% (95% CI -22.4% to -22.4%) |
| Uncached input tokens per task | 37371 | 44886 | 20.1% |
| Output tokens per task | | | 20.5% |
| Turns per task | 36.0 | 14.0 | -22.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.541 | 1.770 | 227.0% (95% CI 227.0% to 227.0%) |
| Cost split (main model / subagents) | $0.541 / $0.000 | $1.605 / $0.165 | main 196.5%, sub n/a |
| Subagents spawned per task | 0.00 | 5.00 | 5.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 227.0%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -22.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 1 | +0.0 pp | -22.4% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1560954 | 1211822 | 0.78 | -22.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| arch-fable | claude-fable-5-1 | 752490 | $1.605 |
| arch-fable | claude-haiku-4-5-20251001 | 459332 | $0.165 |
| solo-sonnet | claude-sonnet-5 | 1560954 | $0.541 |

