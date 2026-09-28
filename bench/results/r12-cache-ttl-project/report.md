# xend bench report

Base arm: `ttl-1h`, compared against 1 other arm(s): ttl-5m.

## ttl-5m vs ttl-1h

Paired comparison of `ttl-5m` against `ttl-1h` on 3 tasks (6 runs).

| Metric | ttl-1h | ttl-5m | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 944834 | 894936 | -3.9% (95% CI -12.6% to 2.8%) |
| Uncached input tokens per task | 36001 | 36387 | 1.1% |
| Output tokens per task | | | 4.5% |
| Turns per task | 25.0 | 25.3 | 0.3 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.444 | 0.388 | -12.2% (95% CI -21.5% to -5.8%) |
| Cost split (main model / subagents) | $0.444 / $0.000 | $0.388 / $0.000 | main -12.7%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 0.0 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -7.0%; must be below 0%)
- turns: INCONCLUSIVE (one-sided 95% upper bound of turn delta 2.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| project | 3 | +0.0 pp | -3.9% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| project-brownfield-softdelete | project | 100% | 100% | 100% | 100% | 1231195 | 1075492 | 0.87 | -3.0 |
| project-ledger-cli | project | 100% | 100% | 100% | 100% | 779906 | 801874 | 1.03 | 2.0 |
| project-log-pipeline | project | 100% | 100% | 100% | 100% | 823401 | 807442 | 0.98 | 2.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| ttl-1h | claude-sonnet-5 | 944834 | $0.444 |
| ttl-5m | claude-sonnet-5 | 894936 | $0.388 |

