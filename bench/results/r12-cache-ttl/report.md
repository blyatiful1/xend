# xend bench report

Base arm: `ttl-1h`, compared against 1 other arm(s): ttl-5m.

## ttl-5m vs ttl-1h

Paired comparison of `ttl-5m` against `ttl-1h` on 21 tasks (84 runs).

| Metric | ttl-1h | ttl-5m | change |
|---|---|---|---|
| Pass rate | 95.2% | 95.2% | +0.0 pp (95% CI -7.1 pp to +7.1 pp) |
| Score (fraction of hidden tests passed) | 95.2% | 95.2% | +0.0 pp (95% CI -7.1 pp to +7.1 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 122656 | 119003 | -2.2% (95% CI -4.8% to 0.2%) |
| Uncached input tokens per task | 12418 | 12331 | -0.7% |
| Output tokens per task | | | 2.0% |
| Turns per task | 4.5 | 4.5 | -0.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.078 | 0.059 | -25.0% (95% CI -26.4% to -23.6%) |
| Cost split (main model / subagents) | $0.078 / $0.000 | $0.059 / $0.000 | main -25.0%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 1 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): 8.6 pp.

**Verdict: INCONCLUSIVE** (all three must pass)
- quality: INCONCLUSIVE (one-sided 95% lower bound of pass-rate delta -4.8 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -23.9%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta 0.17; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| qa | 3 | +0.0 pp | -0.0% |
| refactor | 2 | +0.0 pp | -2.9% |
| bugfix | 6 | +0.0 pp | -2.6% |
| reading | 5 | +0.0 pp | -2.1% |
| feature | 3 | +0.0 pp | -4.8% |
| navigation | 2 | +0.0 pp | 0.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-diff-review-300 | qa | 100% | 50% | 100% | 50% | 90666 | 90635 | 1.00 | 0.0 |
| adv-grep-many-hits | refactor | 100% | 100% | 100% | 100% | 205252 | 193236 | 0.94 | 1.0 |
| adv-json-edit-after-read | bugfix | 100% | 100% | 100% | 100% | 124275 | 123024 | 0.99 | -1.0 |
| adv-middle-of-output | reading | 100% | 100% | 100% | 100% | 146752 | 160693 | 1.09 | 0.0 |
| adv-print-debugging | bugfix | 100% | 100% | 100% | 100% | 206433 | 175879 | 0.85 | -1.0 |
| bugfix-date-range | bugfix | 100% | 100% | 100% | 100% | 114218 | 114240 | 1.00 | 0.0 |
| bugfix-mutable-default | bugfix | 100% | 100% | 100% | 100% | 114898 | 114870 | 1.00 | 0.0 |
| bugfix-pagination-offset | bugfix | 100% | 100% | 100% | 100% | 116306 | 116324 | 1.00 | 0.0 |
| bugfix-retry-swallowed | bugfix | 100% | 100% | 100% | 100% | 114837 | 114835 | 1.00 | 0.0 |
| feature-cli-json | feature | 100% | 100% | 100% | 100% | 131124 | 131109 | 1.00 | 0.0 |
| feature-input-validation | feature | 100% | 100% | 100% | 100% | 100498 | 86121 | 0.86 | -0.5 |
| feature-lru-cache | feature | 100% | 100% | 100% | 100% | 86909 | 86907 | 1.00 | 0.0 |
| navigation-find-constant | navigation | 100% | 100% | 100% | 100% | 100624 | 101106 | 1.00 | 0.5 |
| navigation-rename-function | navigation | 100% | 100% | 100% | 100% | 85944 | 85857 | 1.00 | 0.0 |
| qa-parse-record-impact | qa | 0% | 50% | 0% | 50% | 85659 | 86000 | 1.00 | 1.0 |
| qa-retry-config | qa | 100% | 100% | 100% | 100% | 85828 | 85486 | 1.00 | 0.0 |
| reading-big-file-edit | reading | 100% | 100% | 100% | 100% | 174491 | 146512 | 0.84 | -1.0 |
| reading-config-drift | reading | 100% | 100% | 100% | 100% | 102968 | 103009 | 1.00 | 0.0 |
| reading-log-needle | reading | 100% | 100% | 100% | 100% | 125515 | 120547 | 0.96 | 0.5 |
| reading-test-triage | reading | 100% | 100% | 100% | 100% | 176037 | 176181 | 1.00 | 0.0 |
| refactor-dedupe-helper | refactor | 100% | 100% | 100% | 100% | 86545 | 86507 | 1.00 | 0.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| ttl-1h | claude-sonnet-5 | 122656 | $0.078 |
| ttl-5m | claude-sonnet-5 | 119003 | $0.059 |

