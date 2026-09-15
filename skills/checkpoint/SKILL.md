---
name: checkpoint
description: Save a compact checkpoint (decisions, open items, files touched, verification commands) so it survives /clear or /compact. Run it before clearing context between tasks.
argument-hint: "[optional notes]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Write a checkpoint for this session, then tell the user it is safe to `/clear` (cheapest) or `/compact`.

1. Summarize in at most 12 short lines: the goal, decisions made, what is done, what is open, and the exact verification commands. Include the user's notes: `$ARGUMENTS`.
2. Save it by running exactly (replace the text, keep it on one line, no quotes inside):

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" note "${CLAUDE_SESSION_ID}" <your summary as one line; separate items with ' | '>`

3. Reply with one line: where the checkpoint was saved and that it will be re-injected automatically after `/clear` or `/compact`.
