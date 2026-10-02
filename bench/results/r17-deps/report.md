# Long-session report

Task(s): session-deps-16. Sessions: 18 (18 complete). Base arm: `baseline`. Paired by trial; CIs are bootstrap 95% intervals of the ratio of means over trials.

| Arm | n | Cost per session | vs base (95% CI) | Subagent share | Main context peak | Context at end | Compactions | Subtasks fixed | Turns | Wall |
|---|---|---|---|---|---|---|---|---|---|---|
| xend | 6 | $1.605 ± 0.250 | -13.8% (-23.4% to +1.3%) | 0.0% | 66.8k | 41.7k | 2.00 | 16.00/16 | 89 | 5 min |
| baseline | 6 | $1.862 ± 0.133 | — | 0.0% | 66.6k | 36.3k | 2.67 | 16.00/16 | 100 | 6 min |
| xend-delegate | 6 | $1.575 ± 0.181 | -15.4% (-24.5% to -3.6%) | 67.6% | 41.2k | 41.2k | 0.00 | 16.00/16 | 35 | 7 min |

## Main context after each subtask (mean, tokens)

| Arm | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| xend | 20.9k | 26.7k | 32.6k | 41.9k | 48.4k | 46.4k | 37.3k | 44.2k | 49.6k | 50.7k | 43.5k | 39.4k | 51.5k | 50.8k | 35.9k | 40.2k | 41.7k |
| baseline | 20.7k | 27.1k | 33.3k | 42.0k | 49.9k | 51.0k | 43.4k | 44.0k | 33.7k | 44.8k | 47.8k | 34.8k | 49.7k | 49.6k | 29.1k | 34.3k | 36.3k |
| xend-delegate | 14.6k | 16.2k | 17.6k | 19.0k | 20.4k | 22.3k | 24.1k | 25.9k | 27.7k | 29.4k | 31.1k | 32.8k | 34.6k | 36.4k | 38.2k | 39.9k | 41.2k |

## Cost per subtask (mean, USD)

| Arm | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | first half | second half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| xend | 0.069 | 0.071 | 0.067 | 0.090 | 0.085 | 0.110 | 0.117 | 0.080 | 0.077 | 0.112 | 0.128 | 0.072 | 0.177 | 0.099 | 0.168 | 0.052 | 0.031 | $0.689 | $0.916 |
| baseline | 0.069 | 0.075 | 0.069 | 0.087 | 0.098 | 0.189 | 0.133 | 0.113 | 0.111 | 0.096 | 0.118 | 0.084 | 0.247 | 0.105 | 0.173 | 0.058 | 0.037 | $0.834 | $1.028 |
| xend-delegate | 0.072 | 0.126 | 0.116 | 0.091 | 0.089 | 0.168 | 0.100 | 0.083 | 0.072 | 0.087 | 0.086 | 0.061 | 0.151 | 0.074 | 0.105 | 0.063 | 0.030 | $0.846 | $0.729 |

## Compactions

| Arm | Trial | After subtask | Trigger | Tokens before | Tokens after | Context of next call |
|---|---|---|---|---|---|---|
| xend | 1 | 11 | auto | 67549 | 3902 | 15669 |
| xend | 2 | 10 | auto | 69131 | 8061 | 21585 |
| xend | 2 | 15 | auto | 67516 | 8038 | 21040 |
| baseline | 1 | 6 | auto | 67295 | 3591 | 15109 |
| baseline | 1 | 11 | auto | 68248 | 4595 | 16914 |
| baseline | 1 | 14 | auto | 67340 | 3629 | 15452 |
| baseline | 2 | 9 | auto | 67231 | 3355 | 14830 |
| baseline | 2 | 13 | auto | 66812 | 14798 | 31894 |
| baseline | 2 | 15 | auto | 70700 | 16405 | 32785 |
| xend | 3 | 7 | auto | 68237 | 5447 | 18215 |
| xend | 3 | 13 | auto | 69170 | 4476 | 16557 |
| baseline | 3 | 8 | auto | 67540 | 3048 | 14721 |
| baseline | 3 | 13 | auto | 69349 | 6150 | 18897 |
| xend | 4 | 7 | auto | 67304 | 7144 | 20369 |
| xend | 4 | 14 | auto | 67183 | 3824 | 15579 |
| baseline | 4 | 7 | auto | 66622 | 6875 | 20199 |
| baseline | 4 | 12 | auto | 67101 | 4183 | 16171 |
| baseline | 4 | 15 | auto | 68957 | 7871 | 20569 |
| xend | 5 | 12 | auto | 67431 | 7887 | 21493 |
| xend | 5 | 15 | auto | 67920 | 10169 | 24731 |
| baseline | 5 | 7 | auto | 66733 | 7126 | 20216 |
| baseline | 5 | 12 | auto | 66858 | 3476 | 14987 |
| baseline | 5 | 15 | auto | 67499 | 3825 | 15438 |
| baseline | 6 | 9 | auto | 68541 | 4266 | 15674 |
| baseline | 6 | 15 | auto | 70828 | 7201 | 19609 |
| xend | 6 | 6 | auto | 66706 | 6481 | 18724 |
| xend | 6 | 11 | auto | 68134 | 3729 | 15647 |
| xend | 6 | 15 | auto | 67488 | 3744 | 15474 |

## Task checks (mean per session; booleans as the share of sessions)

| Arm | changes | release_exists | tag_ok | helper_ok | release_modules | regress_expected | regress_present | regress_pass_fixed | regress_valid |
|---|---|---|---|---|---|---|---|---|---|
| xend | 16.00 | 100% | 100% | 100% | 16.00 | 11.00 | 11.00 | 11.00 | 11.00 |
| baseline | 16.00 | 100% | 100% | 100% | 16.00 | 11.00 | 11.00 | 11.00 | 11.00 |
| xend-delegate | 16.00 | 100% | 100% | 100% | 16.00 | 11.00 | 11.00 | 11.00 | 11.00 |

Sessions with commands that touched the standard library (see raw/): xend-delegate#1 (2), baseline#3 (2), xend-delegate#3 (1).
