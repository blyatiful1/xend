---
name: doctor
description: Offline audit of token waste (memory files, settings, MCP servers, hooks, cache hit ratio) with ranked fixes.
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run the audit and show the user the result verbatim in a fenced block, then add at most three sentences on which finding to act on first.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js" --cwd "${CLAUDE_PROJECT_DIR:-.}" 2>&1`
