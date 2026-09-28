# xend bench report

Base arm: `baseline`, compared against 3 other arm(s): xend-new, new-nolean, new-noterse.

## xend-new vs baseline

Paired comparison of `xend-new` against `baseline` on 1 tasks (12 runs).

| Metric | baseline | xend-new | change |
|---|---|---|---|
| Pass rate | 100.0% | 33.3% | -66.7 pp (95% CI -66.7 pp to -66.7 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 33.3% | -66.7 pp (95% CI -66.7 pp to -66.7 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 146709 | 147646 | 0.6% (95% CI 0.6% to 0.6%) |
| Uncached input tokens per task | 12393 | 12099 | -2.4% |
| Output tokens per task | | | -13.8% |
| Turns per task | 6.7 | 6.0 | -0.7 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.085 | 0.083 | -2.5% (95% CI -2.5% to -2.5%) |
| Cost split (main model / subagents) | $0.085 / $0.000 | $0.083 / $0.000 | main -2.5%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: FAIL** (all three must pass)
- quality: FAIL (one-sided 95% lower bound of pass-rate delta -66.7 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -2.5%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -0.67; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| reading | 1 | -66.7 pp | 0.6% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-middle-of-output | reading | 100% | 33% | 100% | 33% | 146709 | 147646 | 1.01 | -0.7 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 146709 | $0.085 |
| xend-new | claude-sonnet-5 | 147646 | $0.083 |

## new-nolean vs baseline

Paired comparison of `new-nolean` against `baseline` on 1 tasks (12 runs).

| Metric | baseline | new-nolean | change |
|---|---|---|---|
| Pass rate | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 100.0% | +0.0 pp (95% CI +0.0 pp to +0.0 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 146709 | 137136 | -6.5% (95% CI -6.5% to -6.5%) |
| Uncached input tokens per task | 12393 | 11898 | -4.0% |
| Output tokens per task | | | -19.7% |
| Turns per task | 6.7 | 5.7 | -1.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.085 | 0.080 | -6.5% (95% CI -6.5% to -6.5%) |
| Cost split (main model / subagents) | $0.085 / $0.000 | $0.080 / $0.000 | main -6.5%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 0 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: PASS** (all three must pass)
- quality: PASS (one-sided 95% lower bound of pass-rate delta +0.0 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -6.5%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -1.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| reading | 1 | +0.0 pp | -6.5% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-middle-of-output | reading | 100% | 100% | 100% | 100% | 146709 | 137136 | 0.93 | -1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 146709 | $0.085 |
| new-nolean | claude-sonnet-5 | 137136 | $0.080 |

## new-noterse vs baseline

Paired comparison of `new-noterse` against `baseline` on 1 tasks (12 runs).

| Metric | baseline | new-noterse | change |
|---|---|---|---|
| Pass rate | 100.0% | 66.7% | -33.3 pp (95% CI -33.3 pp to -33.3 pp) |
| Score (fraction of hidden tests passed) | 100.0% | 66.7% | -33.3 pp (95% CI -33.3 pp to -33.3 pp) |
| Tokens per task (all models incl. subagents, all four meters) | 146709 | 147072 | 0.2% (95% CI 0.2% to 0.2%) |
| Uncached input tokens per task | 12393 | 11974 | -3.4% |
| Output tokens per task | | | -13.5% |
| Turns per task | 6.7 | 5.7 | -1.0 |
| Cost per task (USD, Claude Code reported, subagents included) | 0.085 | 0.083 | -3.2% (95% CI -3.2% to -3.2%) |
| Cost split (main model / subagents) | $0.085 / $0.000 | $0.083 / $0.000 | main -3.2%, sub n/a |
| Subagents spawned per task | 0.00 | 0.00 | 0.00 |
| Runs with errors | 0 | 0 | |

Sign test on non-tied tasks: 0 better, 1 worse, p = 1.00.
Minimum detectable pass-rate drop at this size (paired, one-sided alpha 0.05, 80% power): n/a.

**Verdict: FAIL** (all three must pass)
- quality: FAIL (one-sided 95% lower bound of pass-rate delta -33.3 pp vs gate -3 pp)
- cost: PASS (one-sided 95% upper bound of cost change -3.2%; must be below 0%)
- turns: PASS (one-sided 95% upper bound of turn delta -1.00; must be at most +0.25)

| Category | tasks | pass delta | token change |
|---|---|---|---|
| reading | 1 | -33.3 pp | 0.2% |

| Task | cat | pass base | pass treat | score base | score treat | tokens base | tokens treat | ratio | turns Δ |
|---|---|---|---|---|---|---|---|---|---|
| adv-middle-of-output | reading | 100% | 67% | 100% | 67% | 146709 | 147072 | 1.00 | -1.0 |

| Arm | model | tokens per task | cost per task |
|---|---|---|---|
| baseline | claude-sonnet-5 | 146709 | $0.085 |
| new-noterse | claude-sonnet-5 | 147072 | $0.083 |

