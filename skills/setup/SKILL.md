---
name: setup
description: Apply an xend profile (lite, balanced, aggressive) and optionally the recommended native Claude Code settings, with a backup and a printed diff.
argument-hint: "[lite|balanced|aggressive] [--with-recommended] [--compact-instructions] [--dry-run] [--undo]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Arguments: `$ARGUMENTS` (default: `balanced --dry-run`).

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" ${ARGUMENTS:-balanced --dry-run} 2>&1`

Show the output above verbatim. If it was a dry run, tell the user the exact command to apply it: `/xend:setup <profile> --with-recommended`. If settings were written, remind them that env changes need a restart of Claude Code and that `/xend:setup --undo` restores the backup.
