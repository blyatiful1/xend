---
name: delegate
description: Long-session mode: hand each self-contained subtask to the lean xend-subtask agent so this session's context stays small.
argument-hint: "[on|off|status]"
disable-model-invocation: true
allowed-tools: Bash(node *scripts/xend-cli.js*)
---

Delegate mode is off unless enabled with `/xend:delegate on`, `XEND_DELEGATE=1` or `.xend.json` (`{"delegate": true}`).

Requested: `$ARGUMENTS` (empty means `status`; one of `status`, `on`, `off`).

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" delegate "${CLAUDE_SESSION_ID}" "$ARGUMENTS" 2>&1 || true`

Show the output above verbatim. If it says delegate mode is on, follow the rule it prints from now on.
