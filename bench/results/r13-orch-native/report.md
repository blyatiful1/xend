# xend bench report

Base arm: `solo`, compared against 4 other arm(s): fresh-sub, fork, xend-arch, workflow.

## fresh-sub vs solo

Paired comparison of `fresh-sub` against `solo` on 3 tasks (15 runs).

| Metric | solo | fresh-sub | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 87176 | 444695 | 396.7% (95% CI 25.2% to 583.0%) |
| Uncached input tokens per task | 18890 | 6381 | -66.2% |
| Output tokens per task | | | -58.9% |
| Turns per task | 4.0 | 3.0 | -1.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.160 | 0.412 | 138.5% (95% CI 1.1% to 234.8%) |
| Cost split (main model / subagents) | $0.160 / $0.000 | $0.412 / $0.000 | main 157.9%, sub n/a |
| Subagents spawned per task | 0.00 | 4.00 | 4.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 216.4%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta 0.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | 396.7% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 80865 | 101228 | 1.25 | 1.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95364 | 650296 | 6.82 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 85298 | 582560 | 6.83 | -2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| fresh-sub | claude-sonnet-5-5 | 444695 | $0.412 |
| solo | claude-sonnet-5-5 | 87176 | $0.160 |

## fork vs solo

Paired comparison of `fork` against `solo` on 3 tasks (15 runs).

| Metric | solo | fork | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 87176 | 424543 | 385.4% (95% CI 228.5% to 464.9%) |
| Uncached input tokens per task | 18890 | 8633 | -54.3% |
| Output tokens per task | | | -66.8% |
| Turns per task | 4.0 | 4.3 | 0.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.160 | 0.291 | 87.7% (95% CI 67.7% to 123.2%) |
| Cost split (main model / subagents) | $0.160 / $0.000 | $0.291 / $0.000 | main 82.2%, sub n/a |
| Subagents spawned per task | 0.00 | 4.00 | 4.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 106.2%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 2.67; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | 385.4% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 80865 | 456843 | 5.65 | -2.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95364 | 536612 | 5.63 | -2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 85298 | 280174 | 3.28 | 5.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| fork | claude-sonnet-5-5 | 424543 | $0.291 |
| solo | claude-sonnet-5-5 | 87176 | $0.160 |

## xend-arch vs solo

Paired comparison of `xend-arch` against `solo` on 3 tasks (15 runs).

| Metric | solo | xend-arch | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 87176 | 107178 | 21.3% (95% CI 3.6% to 56.7%) |
| Uncached input tokens per task | 18890 | 19863 | 5.2% |
| Output tokens per task | | | -10.5% |
| Turns per task | 4.0 | 5.0 | 1.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.160 | 0.161 | 0.4% (95% CI -1.1% to 1.8%) |
| Cost split (main model / subagents) | $0.160 / $0.000 | $0.161 / $0.000 | main 0.6%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: INCONCLUSIVE (one-sided 95% upper bound of cost change 1.4%; must be below 0%)
- turns: FAIL (one-sided 95% upper bound of turn delta 1.67; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | 21.3% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 80865 | 83786 | 1.04 | 0.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95364 | 149406 | 1.57 | 2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 85298 | 88341 | 1.04 | 1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo | claude-sonnet-5-5 | 87176 | $0.160 |
| xend-arch | claude-sonnet-5-5 | 107178 | $0.161 |

## workflow vs solo

Paired comparison of `workflow` against `solo` on 3 tasks (15 runs).

| Metric | solo | workflow | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 87176 | 454077 | 418.5% (95% CI 381.5% to 465.2%) |
| Uncached input tokens per task | 18890 | 4013 | -78.8% |
| Output tokens per task | | | -85.7% |
| Turns per task | 4.0 | 2.7 | -1.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.160 | 0.450 | 185.5% (95% CI 164.4% to 198.2%) |
| Cost split (main model / subagents) | $0.160 / $0.000 | $0.450 / $0.000 | main 181.9%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: FAIL** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: FAIL (one-sided 95% upper bound of cost change 196.8%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -1.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | 418.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 80865 | 389391 | 4.82 | -1.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 95364 | 538974 | 5.65 | -1.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 85298 | 433866 | 5.09 | -2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| solo | claude-sonnet-5-5 | 87176 | $0.160 |
| workflow | claude-sonnet-5-5 | 454077 | $0.450 |

