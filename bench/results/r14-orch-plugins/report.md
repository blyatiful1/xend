# xend bench report

Base arm: `solo`, compared against 7 other arm(s): fork, fresh-sub, superpowers, workflow, omc-autopilot, superpowers-sdd, advisor-opus.

## fork vs solo

Paired comparison of `fork` against `solo` on 4 tasks (32 runs).

| Metric | solo | fork | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 362453 | 327.9% (95% CI 236.4% to 471.5%) |
| Uncached input tokens per task | 16551 | 6027 | -63.6% |
| Output tokens per task | | | -57.5% |
| Turns per task | 4.3 | 4.0 | -0.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.244 | 110.9% (95% CI 49.4% to 222.4%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.244 / $0.000 | main 79.4%, sub n/a |
| Subagents spawned per task | 0.00 | 3.00 | 3.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 171.9%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 1.50; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 327.9% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 259882 | 3.20 | 4.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 367073 | 3.86 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 314313 | 3.65 | -2.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 508542 | 6.40 | -1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| fork | claude-sonnet-5-5 | 362453 | $0.244 |
| solo | claude-sonnet-5-5 | 85456 | $0.136 |

## fresh-sub vs solo

Paired comparison of `fresh-sub` against `solo` on 4 tasks (32 runs).

| Metric | solo | fresh-sub | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 393770 | 362.5% (95% CI 241.2% to 510.7%) |
| Uncached input tokens per task | 16551 | 1566 | -90.5% |
| Output tokens per task | | | -74.4% |
| Turns per task | 4.3 | 2.3 | -2.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.387 | 262.7% (95% CI 113.1% to 557.1%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.387 / $0.000 | main 183.9%, sub n/a |
| Subagents spawned per task | 0.00 | 3.00 | 3.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 412.4%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -2.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 362.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 248727 | 3.06 | -2.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 455389 | 4.79 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 323887 | 3.76 | -2.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 547076 | 6.89 | -2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| fresh-sub | claude-sonnet-5-5 | 393770 | $0.387 |
| solo | claude-sonnet-5-5 | 85456 | $0.136 |

## superpowers vs solo

Paired comparison of `superpowers` against `solo` on 4 tasks (32 runs).

| Metric | solo | superpowers | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 114125 | 33.2% (95% CI 18.9% to 47.4%) |
| Uncached input tokens per task | 16551 | 20023 | 21.0% |
| Output tokens per task | | | 1.9% |
| Turns per task | 4.3 | 5.5 | 1.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.157 | 17.9% (95% CI 11.8% to 27.2%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.157 / $0.000 | main 15.2%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 23.6%; must be below 0%)
- turns: FAIL (one-sided 95% upper bound of turn delta 2.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 33.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 118104 | 1.45 | 1.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 142108 | 1.49 | 2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 96298 | 1.12 | 0.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 99990 | 1.26 | 2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo | claude-sonnet-5-5 | 85456 | $0.136 |
| superpowers | claude-sonnet-5-5 | 114125 | $0.157 |

## workflow vs solo

Paired comparison of `workflow` against `solo` on 4 tasks (32 runs).

| Metric | solo | workflow | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 431729 | 409.6% (95% CI 317.6% to 508.9%) |
| Uncached input tokens per task | 16551 | 3416 | -79.4% |
| Output tokens per task | | | -79.2% |
| Turns per task | 4.3 | 2.0 | -2.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.397 | 242.6% (95% CI 128.0% to 420.4%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.397 / $0.000 | main 191.1%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 345.0%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -2.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 409.6% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 341044 | 4.20 | -2.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 395000 | 4.15 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 457201 | 5.31 | -2.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 533669 | 6.72 | -3.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo | claude-sonnet-5-5 | 85456 | $0.136 |
| workflow | claude-sonnet-5-5 | 431729 | $0.397 |

## omc-autopilot vs solo

Paired comparison of `omc-autopilot` against `solo` on 4 tasks (32 runs).

| Metric | solo | omc-autopilot | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 113376 | 33.5% (95% CI 17.9% to 60.9%) |
| Uncached input tokens per task | 16551 | 20968 | 26.7% |
| Output tokens per task | | | 22.6% |
| Turns per task | 4.3 | 5.3 | 1.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.162 | 25.3% (95% CI 10.8% to 50.2%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.162 / $0.000 | main 19.0%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 39.9%; must be below 0%)
- turns: FAIL (one-sided 95% upper bound of turn delta 1.50; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 33.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 94513 | 1.16 | 0.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 115158 | 1.21 | 1.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 105526 | 1.23 | 1.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 138307 | 1.74 | 2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| omc-autopilot | claude-sonnet-5-5 | 113376 | $0.162 |
| solo | claude-sonnet-5-5 | 85456 | $0.136 |

## superpowers-sdd vs solo

Paired comparison of `superpowers-sdd` against `solo` on 4 tasks (32 runs).

| Metric | solo | superpowers-sdd | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 319244 | 275.3% (95% CI 245.5% to 298.2%) |
| Uncached input tokens per task | 16551 | 27222 | 64.5% |
| Output tokens per task | | | -49.8% |
| Turns per task | 4.3 | 7.3 | 3.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.323 | 161.5% (95% CI 100.7% to 237.7%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.323 / $0.000 | main 137.1%, sub n/a |
| Subagents spawned per task | 0.00 | 1.00 | 1.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 208.0%; must be below 0%)
- turns: FAIL (one-sided 95% upper bound of turn delta 4.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 275.3% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 305594 | 3.76 | 3.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 312591 | 3.29 | 5.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 340720 | 3.96 | 3.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 318069 | 4.00 | 1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo | claude-sonnet-5-5 | 85456 | $0.136 |
| superpowers-sdd | claude-sonnet-5-5 | 319244 | $0.323 |

## advisor-opus vs solo

Paired comparison of `advisor-opus` against `solo` on 4 tasks (32 runs).

| Metric | solo | advisor-opus | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 85456 | 126647 | 49.3% (95% CI 6.3% to 104.4%) |
| Uncached input tokens per task | 16551 | 20130 | 21.6% |
| Output tokens per task | | | 25.0% |
| Turns per task | 4.3 | 6.0 | 1.8 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.136 | 0.164 | 31.5% (95% CI 4.3% to 75.9%) |
| Cost split (main model / subagents) | $0.136 / $0.000 | $0.164 / $0.000 | main 20.7%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 58.6%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 3.75; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 4 | +0.0 pp | 49.3% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 81237 | 85630 | 1.05 | 0.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95091 | 140628 | 1.48 | 2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 86072 | 92191 | 1.07 | 0.0 |
| project-multifix-vendored | project | 100% | 100% | 100% | 100% | 79422 | 188138 | 2.37 | 5.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| advisor-opus | claude-sonnet-5-5 | 126647 | $0.164 |
| solo | claude-sonnet-5-5 | 85456 | $0.136 |

