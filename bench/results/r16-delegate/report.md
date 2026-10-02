# Long-session report

Task(s): session-multifix-16. Sessions: 18 (18 complete). Base arm: `baseline`. Paired by trial; CIs are bootstrap 95% intervals of the ratio of means over trials.

| Arm | n | Cost per session | vs base (95% CI) | Subagent share | Main context peak | Context at end | Compactions | Subtasks fixed | Turns | Wall |
|---|---|---|---|---|---|---|---|---|---|---|
| xend | 6 | $1.303 ± 0.128 | -14.6% (-23.6% to -3.0%) | 0.0% | 66.4k | 46.0k | 1.67 | 16.00/16 | 80 | 4 min |
| baseline | 6 | $1.526 ± 0.207 | — | 0.0% | 66.3k | 45.9k | 2.00 | 16.00/16 | 88 | 4 min |
| xend-delegate | 6 | $1.271 ± 0.257 | -16.7% (-30.0% to +0.0%) | 66.4% | 34.5k | 34.5k | 0.00 | 16.00/16 | 34 | 5 min |

## Main context after each subtask (mean, tokens)

| Arm | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| xend | 21.6k | 26.4k | 33.3k | 43.5k | 53.3k | 42.5k | 39.9k | 36.6k | 42.4k | 40.9k | 40.7k | 44.1k | 48.4k | 40.7k | 49.6k | 46.0k |
| baseline | 20.7k | 26.8k | 32.8k | 42.6k | 50.4k | 46.7k | 45.0k | 44.3k | 32.8k | 35.3k | 46.1k | 41.5k | 46.4k | 54.3k | 50.0k | 45.9k |
| xend-delegate | 14.5k | 16.1k | 17.4k | 18.7k | 20.0k | 21.3k | 22.6k | 24.0k | 25.3k | 26.5k | 27.8k | 29.0k | 30.3k | 31.9k | 33.2k | 34.5k |

## Cost per subtask (mean, USD)

| Arm | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | first half | second half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| xend | 0.072 | 0.059 | 0.066 | 0.097 | 0.100 | 0.100 | 0.084 | 0.076 | 0.068 | 0.082 | 0.084 | 0.048 | 0.126 | 0.094 | 0.080 | 0.068 | $0.653 | $0.650 |
| baseline | 0.068 | 0.068 | 0.065 | 0.091 | 0.095 | 0.095 | 0.095 | 0.114 | 0.098 | 0.104 | 0.091 | 0.067 | 0.187 | 0.073 | 0.145 | 0.069 | $0.692 | $0.834 |
| xend-delegate | 0.070 | 0.133 | 0.104 | 0.093 | 0.087 | 0.106 | 0.063 | 0.067 | 0.050 | 0.066 | 0.067 | 0.042 | 0.132 | 0.059 | 0.089 | 0.044 | $0.721 | $0.550 |

## Compactions

| Arm | Trial | After subtask | Trigger | Tokens before | Tokens after | Context of next call |
|---|---|---|---|---|---|---|
| xend | 2 | 10 | auto | 69291 | 6117 | 18952 |
| baseline | 1 | 9 | auto | 66997 | 3286 | 14892 |
| xend | 1 | 6 | auto | 68996 | 4671 | 16902 |
| xend | 1 | 14 | auto | 69498 | 11783 | 27597 |
| baseline | 2 | 8 | auto | 67175 | 3378 | 14857 |
| baseline | 2 | 13 | auto | 67222 | 6530 | 19950 |
| xend | 3 | 11 | auto | 66937 | 3402 | 14993 |
| xend | 3 | 14 | auto | 67859 | 8090 | 21968 |
| baseline | 3 | 6 | auto | 67160 | 2509 | 13500 |
| baseline | 3 | 12 | auto | 67125 | 5950 | 18485 |
| baseline | 3 | 15 | auto | 75323 | 14359 | 30082 |
| xend | 4 | 7 | auto | 67770 | 4026 | 15814 |
| xend | 4 | 13 | auto | 69074 | 4382 | 16805 |
| baseline | 4 | 9 | auto | 67240 | 3481 | 15095 |
| xend | 5 | 6 | auto | 67464 | 3554 | 15168 |
| baseline | 5 | 10 | auto | 68570 | 3621 | 15424 |
| baseline | 5 | 15 | auto | 67411 | 3565 | 15067 |
| xend | 6 | 8 | auto | 67108 | 2772 | 14114 |
| xend | 6 | 16 | auto | 66354 | 6342 | 19173 |
| baseline | 6 | 7 | auto | 71417 | 6638 | 19646 |
| baseline | 6 | 13 | auto | 67111 | 2643 | 14128 |
| baseline | 6 | 16 | auto | 68144 | 4709 | 16721 |

Sessions with commands that touched the standard library (see raw/): xend#4 (1).
