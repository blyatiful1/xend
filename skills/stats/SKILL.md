---
name: stats
description: Token, cost, cache and tool-result statistics for a session, plus xend shaping diagnostics.
argument-hint: "[--session <id-or-path>] [--json]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Print the report below verbatim in a fenced block. Do not recompute or round the numbers.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" --cwd "${CLAUDE_PROJECT_DIR:-.}" $ARGUMENTS 2>&1`
