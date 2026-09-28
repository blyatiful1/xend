---
name: plan
description: Show the architect plan status or next tasks, or turn architect mode off/on.
argument-hint: "[status|next|off|on]"
disable-model-invocation: true
allowed-tools: Bash(node *scripts/xend-cli.js*)
---

Architect mode is off unless enabled with `/xend:plan on`, `XEND_ARCHITECT=1` or `.xend.json`.

Requested: `$ARGUMENTS` (empty means `status`; one of `status`, `next`, `off`, `on`).

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" plan "$ARGUMENTS" --from-skill --session "${CLAUDE_SESSION_ID}" --data "${CLAUDE_PLUGIN_DATA}" 2>&1 || true`

Show the output above verbatim, then continue.

If architect mode is on, restate the protocol in one short paragraph: locate with Grep, Glob or the built-in `Explore` agent
and read only the interfaces you must pin; write the plan with `plan set`; run `plan next` for
ready briefs and dispatch each with one `Agent` call (`xend-worker-lite` for lite tasks,
`xend-worker` otherwise, prompt = the brief, independent tasks in one message); trust xend's own
re-run of each verify command over a builder's claim — it is flagged in the reply and in
`plan status`; repeat `plan next` until it reports the plan complete, doing yourself whatever it
lists under "do yourself"; then run the project verify command, dispatch fixes for any failures,
and summarize. Below the size floor (fewer than 3 files, fewer than 8 tool calls), just work
directly.
