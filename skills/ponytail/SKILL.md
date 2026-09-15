---
name: ponytail
description: Set the xend lean (ponytail) level for this session: lite, full, ultra, off, or rules.
argument-hint: "[lite|full|ultra|off|rules|status]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Requested: `$ARGUMENTS` (empty means show the current level).

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" ponytail "${CLAUDE_SESSION_ID}" "${ARGUMENTS:-status}" 2>&1 || true`

Apply the output above for the rest of the session, starting with your next reply.

- **off**: no lean rules.
- **lite**: build what was asked, then name the lazier alternative in one line; user picks.
- **full**: ladder enforced; stdlib and native before new code; shortest diff, shortest explanation.
- **ultra**: deletion before addition; ship the one-liner and challenge the rest of the requirement
  in the same reply.
- **rules**: read `vendor/ponytail/SKILL.md` for the full upstream ruleset. The rules are already
  active in this session — read it for reference and do **not** restate it in your reply.
- **status**: report which source owns the ruleset and which text is active.

Never simplify away input validation at trust boundaries, error handling that prevents data loss,
security measures, accessibility basics, or anything the user explicitly asked for.

If the output says the ponytail plugin owns this session, tell the user to run `/ponytail <level>`
instead — xend cannot change the upstream plugin's level — and do not claim the level changed.

xend reads the upstream plugin's level once, at session start: if the user runs `/ponytail` mid
session, xend's header line stays stale until the next session start.

Confirm the new level in one short line, then continue.
