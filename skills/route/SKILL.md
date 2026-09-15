---
name: route
description: Decide which xend subagent (Haiku scout/reader, Sonnet worker/reviewer) or the main model should do a piece of work, with the verify-or-escalate rule that keeps quality flat. Use when a task has separable exploration, reading, or well-specified implementation parts.
---

# Routing work to cheaper models without losing quality

Cheaper models are safe to use when their output is **verified before it is trusted**. Route by the shape of the work, not by how easy it looks.

| Work | Route to | Accept only after |
|---|---|---|
| Locate code: "where is X handled", "which files touch Y" | `xend-scout` (Haiku, read-only) | You Read the cited lines and they match |
| Condense a large artifact: long log, test output, big config, unfamiliar module | `xend-reader` (Haiku) | The brief quotes the key lines verbatim; spot-check one |
| Implement a change that is fully specified (files, behavior, test command) | `xend-worker` (Sonnet) | Its tests pass in your run, and you read the diff |
| Review a diff for defects | `xend-reviewer` (Sonnet) | You confirm each finding in the code |
| Ambiguous requirements, cross-cutting design, security-sensitive logic, anything you cannot verify cheaply | main model (you) | n/a |

Rules:
0. Every subagent pays a cold prompt prefix (tens of thousands of tokens) before it does anything. Delegate only when the work is bulky: about five or more tool calls, or tens of thousands of tokens of output you would otherwise read. From an Opus or Fable main session, a Haiku or Sonnet subagent nearly always pays off above that floor; a same-tier subagent (Sonnet from Sonnet) pays off only well above it.
1. Give a subagent the exact goal, the file paths, and the verification command. Vague delegation costs more than doing it yourself.
2. One escalation tier on failure: scout finds nothing → search yourself; worker fails tests once → fix it yourself rather than re-delegating.
3. Never switch the main session's model: caches are model-scoped and a switch invalidates them.
4. Subagents start with a fresh context; do not delegate work that needs the conversation history.
5. Parallelize independent delegations in one turn.

Delegation pays only when there is bulk to hand off (many files to scan, long output to read, several independent implementations). A single dependent chain of edits is cheaper on the main model.
