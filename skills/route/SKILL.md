---
name: route
description: When to hand work to xend subagents (Haiku scout/reader, Sonnet worker/reviewer) and how to verify their output.
---

Delegate when the work clears the floor: five or more tool calls, or output long enough that you
would otherwise have to read it in full yourself. Below that floor, just work directly — a
subagent's cold prefix costs more than the task saves.

Tiers, cheapest first:

- **xend-scout** (Haiku, low): read-only locator; returns citations only, no edits.
- **xend-reader** (Haiku, low): condenses one large artifact into a brief with verbatim evidence.
- **xend-worker-lite** (Haiku, low): one mechanical, fully specified change, 1-3 files.
- **xend-worker** (Sonnet, medium): one fully specified task; no redesign, no out-of-scope files.
- **xend-reviewer** (Sonnet, medium): reviews a diff for defects; edits nothing.

Verify or escalate: never act on a subagent's claim alone. Check its citations against the real
files and its `Verification: <cmd> -> <result>` line against what the command actually printed;
if either is wrong, send it back once with what mismatched, or retry at the next tier up.

Architect mode (when enabled, see the session block) turns bigger work into a protocol: write a
plan with `plan set`, dispatch `plan next`'s ready tasks to workers, repeat until done. xend
re-runs every builder's own verify command after it replies and flags a mismatch directly in the
builder's reply and in `plan status`, so read those, not just the claim.
