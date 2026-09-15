---
name: plan
description: Show the architect plan status or next tasks, or turn architect mode off/on.
argument-hint: "[status|next|off|on]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Requested: `$ARGUMENTS` (empty means `status`). It must be one of `status`, `next`, `off`, `on`.

- **status** or **next** (default): run exactly, using the requested value:

  `node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" plan <status|next> --session "${CLAUDE_SESSION_ID}"`

- **off** or **on**: run exactly, using the requested value:

  `node "${CLAUDE_PLUGIN_ROOT}/scripts/xend-cli.js" plan <off|on> --session "${CLAUDE_SESSION_ID}"`

Show that command's output verbatim, then continue.

If architect mode is on, restate the protocol in one short paragraph: locate with `xend-scout`
and read only the interfaces you must pin; write the plan with `plan set`; run `plan next` for
ready briefs and dispatch each with one `Agent` call (`xend-worker-lite` for lite tasks,
`xend-worker` otherwise, prompt = the brief, independent tasks in one message); trust xend's own
re-run of each verify command over a builder's claim — it is flagged in the reply and in
`plan status`; repeat `plan next` until it reports the plan complete, doing yourself whatever it
lists under "do yourself"; then run the project verify command, dispatch fixes for any failures,
and summarize. Below the size floor (fewer than 3 files, fewer than 8 tool calls), just work
directly.
