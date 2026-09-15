---
name: stats
description: Show token, cost, cache, and tool-result statistics for the current or latest Claude Code session, plus what xend shaping saved.
argument-hint: "[--session <id-or-path>] [--json]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Print the report below verbatim in a fenced block. Do not recompute or round the numbers.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" --cwd "${CLAUDE_PROJECT_DIR:-.}" $ARGUMENTS 2>&1`
