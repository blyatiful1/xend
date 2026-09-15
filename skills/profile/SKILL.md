---
name: profile
description: Show or switch the xend profile (lite, balanced, aggressive) for new sessions.
argument-hint: "[lite|balanced|aggressive]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" profile $ARGUMENTS 2>&1`

Report the line above. Profiles: **lite** (terse lite, noise-only output cleanup, dedupe), **balanced** (terse full, structured output shaping, delegation, checkpoints), **aggressive** (tighter caps, outline mode for very large files, server-side context editing; validate with the bench before adopting).
