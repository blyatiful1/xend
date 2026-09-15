# xend research: where Claude Code tokens go, and what removes them without hurting quality

This document is the evidence base behind xend. Every hypothesis states its mechanism, what xend
does about it, the expected saving, the expected quality effect, an evidence grade, and how it is
validated. Grades: **A** independent paired benchmark or deterministic pricing; **B** first-party or
vendor measurement; **C** mechanistic argument only. Numbers measured in this repository's own
environment are marked *(measured here)*.

## 0. Summary

1. In agentic coding, reading dominates writing. Roughly three quarters of the context window is
   tool results the model reads; with caching each of those bytes is billed once at the write rate
   and then at a tenth per turn, so it costs about a tenth of its face value per remaining turn and,
   less visibly, brings compaction and context rot closer. Output-style tricks are real but small
   (8.5% of output tokens, a few percent of cost); input-side work and turn counts are where the
   money is.
2. The largest input cost is structural: a fixed prefix (system prompt, tool schemas, memory files)
   resent on every turn. *(measured here)*: 32,062 tokens per request in a connector-heavy
   environment. Prompt caching reprices it to roughly a tenth; anything that breaks the cache costs
   ten times more than it looks.
3. Lossy filtering of what the model reads backfires. The one independent benchmark of a
   command-rewriting filter (rtk) found +7.6% cost and +13.8% turns: the model re-ran commands to
   see what was hidden. Condensation has to keep every signal line and name a recovery path.
4. Masking *old* tool results beats summarizing them: 52% cheaper and +2.6 points solve rate on
   SWE-bench Verified in JetBrains' study. Anthropic's server-side context editing implements
   age-based masking and reports +29% task performance on long-horizon work. It can be turned on
   inside Claude Code *(measured here)*, at the price of re-caching the remaining context on each
   pass. Shaping a result at the moment it is produced is a different operation and is held to a
   stricter rule: remove only what carries no decision-relevant information.
7. The turn tax governs every transform. At Sonnet prices, shaping one oversized result is worth
   about $0.05 over a session; one extra assistant turn costs about $0.03. A transform that causes
   one extra turn per two uses is net negative, which is how rtk lost money while removing bytes.
5. Cheaper models are safe exactly when their output is verified before it is trusted. Anthropic's
   own numbers: an orchestrator with cheap workers wins only when there is bulk to hand off; a
   single dependent chain is cheaper on one model.
6. A 3% quality bound cannot be certified by a small one-shot suite. xend ships a paired benchmark
   that reports its own minimum detectable effect and accumulates evidence across runs.

## 1. Where the tokens go

| Observation | Number | Source |
|---|---|---|
| Fixed prefix per request (system prompt + tool schemas + memory), typical connector-heavy setup | 32,062 tokens, 26,685 served from cache on a warm run | *(measured here)*, `claude -p --output-format json` |
| Share of context spent reading code vs editing in a SWE agent (context composition, not billed share) | 76.1% reading, 11.8% editing | Mini-SWE-Agent profiling via [Towards Data Science](https://towardsdatascience.com/agentic-ai-how-to-save-on-tokens/) |
| Tool schemas in one real subagent request | 219k of 267k characters | caveman `subagent-tax` report, [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) |
| What dominates agentic output tokens | "code, diffs, tool invocations, and exact error strings"; narration is a small remainder | [JetBrains A/B, 86 tasks](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/) |
| Cost growth with turn count | each turn resends the whole conversation; cost grows roughly with the square of turns without caching | Anthropic cost guidance (claude-api skill, `cost-optimization.md`) |
| Enterprise spend | ~$13 per developer per active day, $150-250 per month | [code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs) |

Implication: the order of levers is (1) keep the cache warm, (2) shrink what is read, (3) shorten
sessions and their context, (4) route bulky work to cheaper contexts, (5) only then shorten prose.

## 2. External evidence

| Study | Design | Result | Grade |
|---|---|---|---|
| JetBrains, caveman skill | SkillsBench, 86 tasks, paired, Claude Sonnet 5 at low effort, 3 runs, auto-graded 0-1 | -8.5% output tokens (advertised 65%); score 0.326 vs 0.311; sign test p = 0.82: no detectable quality change | A |
| JetBrains, rtk | same harness, 425 billed trials | +7.6% cost at low effort (p = 0.004), +13.8% turns; break-even at high effort; hook touched ~20% of tool-result characters because Claude Code already truncates large output | A |
| JetBrains, ponytail skill | 80 paired tasks, claude-sonnet-5 at medium effort, 251 trials / $246.09 | cost -10.3% (p = 0.004, "the first tool in this series that clearly saved money"); code -15.4% (p = 0.088, "the softest of our headline numbers"; advertised -54%); time -11%; quality 65 identical / 9 slightly worse / 6 better | A for cost, C for the code figure |
| Adobe Research, CAVEWOMAN ([arXiv 2606.24083](https://arxiv.org/abs/2606.24083)) | 8 models, 5 datasets, 5 compression levels | output-side compression cuts realized cost 1.4-2.4x (up to 3x); compressing the *input* prompt raises net cost ~1.15x (up to 2.7x) and lowers accuracy: models answer longer and worse | A |
| JetBrains Research, The Complexity Trap ([arXiv 2508.21433](https://arxiv.org/abs/2508.21433)) | SWE-bench Verified, 5 model configurations | observation masking (placeholders for old tool results) halves cost and matches or beats LLM summarization; +2.6% solve rate at 52% lower cost on one model; summarization extended trajectories 13-15% | A |
| Anthropic, context editing + memory tool ([docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)) | long-horizon agentic evaluation | +29% task performance with context editing, +39% with the memory tool added (a quality figure, not a cost figure; each clearing pass re-caches the remaining context) | B |
| Chroma, Context Rot ([report](https://www.trychroma.com/research/context-rot)) | 18 models | reliability degrades with input length well before the window is full | A |
| Lost in the Middle ([arXiv 2307.03172](https://arxiv.org/abs/2307.03172)) | position-controlled retrieval | information in the middle of long contexts is used worse | A |
| cAST, AST-aware chunking | code retrieval + SWE-bench | 1.6-3.9x fewer tokens and +2.67 Pass@1 | A |
| aider repo map ([post](https://aider.chat/2023/10/22/repomap.html)) | tree-sitter + PageRank map capped at ~1k tokens | higher edit accuracy than naive whole-file inclusion | B |
| Anthropic effort sweeps (claude-api skill, `cost-optimization.md`) | coding and research benchmarks | long-horizon coding: about -2 points at `medium` for half the cost, -8 at `low` for a quarter; research: `medium` matches default at 70-85% of cost; re-running failures at higher effort gives the same pass rate at about half the cost | B |
| Anthropic prompt caching ([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)) | pricing | cache reads 0.1x input price (0.025x on Claude Fable 5.1), writes 1.25x (5 min) or 2x (1 h); agent-loop cost cut by 2.5-3.7x at 81-90% hit rates | A |
| FrugalGPT ([arXiv 2305.05176](https://arxiv.org/abs/2305.05176)), RouteLLM ([arXiv 2406.18665](https://arxiv.org/abs/2406.18665)) | cascades and routers | up to 98% cost reduction at matched accuracy; routing keeps ~95% of quality, i.e. up to 5 points loss in some regimes; calibration is the failure mode | A/B |
| caveman proxy benchmark | 54 runs, 6 reading-heavy cases, exact oracle | -33.2% input tokens overall; one case +9.9% (no transform applied, overhead only); 18/18 answers correct | B |
| context-guard (archived) | maintainer's own A/B | "general token or cost savings were not established"; project discontinued | B (honest negative) |
| SWE-Pruner ([arXiv 2601.16746](https://www.arxiv.org/pdf/2601.16746)) | goal-conditioned pruning with a 0.6B skimmer | 23-54% token reduction on SWE-bench-style tasks with minimal impact | B |

## 3. Hypotheses

Each entry: **mechanism** → **xend implementation** → expected saving → expected quality effect → grade → validation → status.

**H1. Cache stability is the first lever.** Any byte that changes early in the prefix re-bills everything after it at full price. → xend injects one stable block at SessionStart (no timestamps, no per-turn injection), never switches the main model, and `/xend:doctor` flags hooks that inject dynamic text on every prompt and settings that change effort mid-session. → Saving: avoids paying up to 10x on the prefix; on a 32k prefix one avoided miss is worth ~29k tokens. → Quality: none. → Grade A (pricing is contractual). → Validation: `/xend:stats` cache hit ratio; bench records uncached input per task. → Status: shipped in all profiles.

**H2. Recoverable shaping of tool results at creation time.** Remove escape codes, progress bars, repeated lines, known passing-test rows and install chatter; cut very long *generic* output (never diffs or test runs) to head and tail; keep every error, failure, diff, and summary line; persist the original and name it in a marker when at least 2,000 characters were removed. → xend PostToolUse hook with `updatedToolOutput` *(verified here: Claude Code 2.1.272 replaces the result the model sees)*; nothing is shaped inside subagents. → Saving: bounded by Claude Code's own 30,000-character cap (the hook can only remove what native truncation left) and by the turn tax; *(measured here)* a 3,000-line `cat` went from 25,892 to 8,416 characters. → Quality: neutral when the marker is self-explanatory and nothing decision-relevant is removed; the rtk result shows the failure mode otherwise (re-runs, more turns). → Grade C for the transforms themselves, with an A-grade negative result shaping the design. → Validation: bench reading and adversarial tasks, turn deltas, and the recovery rate (how often the model reads a persisted original back). → Status: noise-only in `lite`, structured in `balanced`; head/tail applies to generic output only.

**H3. Identical repeats of a command are cheap to shorten.** A command re-run with byte-identical output carries one bit of information: unchanged. → Per-session registry keyed by command; a repeat of at least 2,000 characters within 12 tool calls keeps its first 10 lines plus a marker that says the rest is identical to the earlier call and that other state may still have changed; the registry resets on compact and clear. `Read` results are never shortened this way: a Read is the model's working copy and its next Edit must match the file on disk. → Saving: small; depends on re-run habits (`/xend:stats` reports re-runs). → Quality: neutral. → Grade C. → Validation: bench; stats. → Status: `lite` and `balanced`; off in `aggressive`, where server-side clearing could remove the referenced result.

**H4. Server-side context editing (observation masking) for long sessions.** Anthropic's `clear_tool_uses` strategy clears old tool results after the cache lookup and before token counting. → `CLAUDE_CODE_EXTRA_BODY` carries the `context_management` body into every request *(verified here: the API reported `cleared_tool_uses: 3, cleared_input_tokens: 11,558` in a five-turn run)*. Defaults: trigger 110k input tokens, keep the 12 most recent tool uses (a file read the model still needs is the main risk of clearing too eagerly), clear at least 40k per pass, so passes are rare and large. → Saving: large on long sessions (masking halved cost in the JetBrains study), but each pass re-caches the remaining context: clearing 40k out of 110k re-writes ~70k at 1.25x to save 40k at 0.1x per later turn, a break-even of roughly 20 further turns. Sessions that end soon after a pass pay a penalty. The trigger is absolute, so on a 1M-context session it fires early. → Quality: neutral to positive (+2.6 points and +29% in the cited studies) provided cleared results are recoverable by re-reading files. → Grade A for masking, B for the Claude Code packaging. → Validation: long-session bench comparing cost and pass rate with and without, logging `applied_edits` next to cache-creation tokens. → Status: `aggressive` only, experimental; depends on an undocumented environment variable and on organization policy allowing experimental betas.

**H5. Terse output style.** Drop articles, filler, hedging, narration, restated diffs and closing summaries; keep code, identifiers, errors, numbers and negations exact; write normal prose for anything persisted outside chat and for safety warnings. → Rules injected once per session (caveman-compatible levels `lite`, `full`, `ultra`; `/xend:terse` switches). → Saving: 8-10% of output tokens in agentic coding (JetBrains), up to 50% in chat-style Q&A (caveman's own eval vs a plain "be concise" control). → Quality: no detectable change (p = 0.82, n = 82). → Grade A. → Validation: bench Q&A tasks; output-token delta. → Status: `lite` level in `lite`, `full` in `balanced` and `aggressive`.

**H6. Delegate bulky, verifiable work to cheaper models.** A Haiku scout that returns citations, a Haiku reader that condenses an artifact, a Sonnet worker for fully specified changes. → `agents/*.md` with `model:`/`effort:` frontmatter; `/xend:route` states the contract: accept only after verification, escalate one tier on failure, never switch the main model. → Saving: cost rather than tokens; the parent context absorbs a few hundred tokens instead of tens of thousands (Anthropic: a subagent doing 10k tokens of work that returns 500 saves 9.5k). → Quality: neutral when verified; the documented risk is confident wrong citations from small models, which verification catches. → Grade B. → Validation: bench navigation tasks; per-model usage in results. → Status: shipped; the model decides when to use them.

**H7. Reading discipline and structure-first reading.** Locate before reading, read by range, never re-read unchanged files, verify edits with a diff. Structure-aware retrieval improves quality while cutting tokens (cAST, repo map). → Session rules; `xend-scout`; in `aggressive`, a PreToolUse hook turns an unranged Read of a file with 800+ lines into a ranged read of 250 lines with truthful `numLines`/`totalLines`, so the model continues by range. An earlier design that replaced the file content with a synthesized outline was dropped: a heuristic outline can miss a definition and read as "this symbol does not exist". → Saving: *(measured here)* the reading-discipline block alone took the log-needle task from 8 turns and 455k tokens to 4 turns and 206k; potentially the largest behavioral lever given the reading share. → Quality: positive in the retrieval literature; the range limiter risks one extra turn when the model needed a later part of the file. → Grade A for the principle, C for the specific transform. → Validation: bench big-file task; turn deltas. → Status: rules in all profiles; range limiter in `aggressive`. Structure-aware retrieval (enclosing-function expansion of grep hits, a repo map) is the next lever to build.

**H8. Test-runner and package-manager noise.** Passing-test rows and dependency-resolution chatter carry no decision-relevant information; failures, tracebacks, warnings, skipped rows, the model's own debug prints and summary lines do. → Line classifiers that only drop known noise patterns (a drop-list, never "keep only known signal", which would drop the unknown), applied only to outputs of 60+ lines because default runner modes have little to remove. Anthropic's costs page ships the same idea as a grep filter. → Saving: proportional to suite size in verbose modes. → Quality: neutral by construction for known runners; the adversarial print-debugging task checks that debug output survives. → Grade B for the idea, C for the classifiers. → Validation: unit tests on pytest, jest, go test, cargo, unittest, mocha samples; bench test-triage and print-debugging tasks. → Status: `balanced`.

**H9. MCP schemas and outputs.** Tool schemas sit at position zero of the prefix; MCP results default to a 25,000-token cap. → Claude Code's native tool search already defers schemas (~95% reduction per Anthropic's docs); xend's doctor flags servers, `ENABLE_TOOL_SEARCH=false`, and unset `MAX_MCP_OUTPUT_TOKENS`; `/xend:setup --with-recommended` sets the cap to 10,000; MCP text results are shaped like Bash output. → Saving: large where many servers are configured. → Quality: neutral. → Grade B. → Status: shipped as audit plus setting.

**H10. Memory-file hygiene.** CLAUDE.md files load every session; Anthropic's guidance is under 200 lines per file, with workflow detail moved to on-demand skills. Compressing them into telegraphic prose is a different matter: CAVEWOMAN shows compressed *instructions* make models answer longer and worse, so xend audits size and duplication but does not rewrite prose. → doctor reports lines, estimated tokens, duplicates and cache-breaking dynamic lines. → Saving: proportional to bloat. → Quality: neutral (structural only). → Grade B. → Status: shipped as audit.

**H11. Effort belongs to the task, not the profile.** Effort is the largest single quality-cost trade-off Anthropic measured; lower effort is safe for research-style and short tasks, costly for long-horizon coding. → xend never sets `effortLevel` globally; agents run at `low`/`medium`; the docs describe the cheap-first cascade (run at lower effort, re-run failures at the default) for workloads with a test signal. → Saving: up to half the cost per task on suitable workloads. → Quality: -2 to -8 points if applied blindly, neutral when gated by a checker. → Grade B. → Status: guidance and subagent defaults only.

**H12. Checkpoint, then clear.** `/clear` is free; compaction reads the whole conversation once and cold-starts the cache, and the summary drops details the next turns need. → PreCompact hook writes a checkpoint (edited files, verification commands, recent requests) from the transcript; `/xend:checkpoint` adds decisions and open items; SessionStart on compact or clear re-injects it. → Saving: enables cheap resets between tasks; avoids re-discovery turns after compaction. → Quality: positive on continuity. → Grade C. → Status: shipped.

**H13. One-hour cache TTL for interactive sessions.** A pause longer than five minutes misses the 5-minute cache and re-writes the whole prefix at 1.25x; the 1-hour TTL writes at 2x and pays for itself on the first prevented miss. Subscription plans already use 1 h within included usage. → `promptCacheTtl: "1h"` via `/xend:setup --with-recommended`. → Grade A for the arithmetic, B for the pause-frequency assumption. → Status: opt-in setting.

**H14. Native Bash output cap.** Claude Code's `bashOutputMaxChars` (default 30,000, persisted to a file beyond that) is the right place for the hard cap; xend shapes below it. → 8,000 in `balanced` via setup. → Grade C. → Status: opt-in setting.

**H15. The condensed-output contract prevents the rtk failure mode.** The model must know that a condensed result is complete, where the original is, and that re-running will not show more. *(observed here)*: a marker-only rewrite without explanation made Haiku spend its reply complaining about hooks. → Stable paragraph in the session block plus a self-explanatory marker on every shaped result. → Grade A for the failure, C for the remedy. → Validation: turn deltas in the bench must not rise. → Status: shipped.

**H16. Plugin overhead must be smaller than its savings, and on micro-tasks it is not.** Skill descriptions, agent descriptions and the session block are prefix cost paid once per session (cache write at 1.25x) and then re-read every turn (0.1x). *(measured here, run r2: 21 tasks x 2 trials, 4.5 turns on average)*: uncached input +12.7%, total tokens +6.4%, cost +9.0% (95% CI +6.1% to +11.9%) with the original ~1,250-token prefix, while quality rose 4.8 points and output tokens fell 3.2%. The shaping layer had nothing to condense on 20 of the 21 tasks. The prefix was then cut to ~765 tokens; run r3 measured cost +3.5% (interval including zero) with output tokens -8.6%. The conclusion stands regardless of the trim: on five-turn tasks a plugin cannot save money, because the only costs in play are the fixed prefix and a few hundred output tokens; xend's savings come from long sessions, reading-heavy work, and the native levers the bench does not exercise. → Grade A (own paired measurement). → Validation: bench by turn count; a long-session suite is the missing evidence.

**H17. Subagents without memory files and at low effort.** `omitClaudeMd: true` and `effort: low` on scout and reader remove the memory prefix and the reasoning budget from cheap, mechanical work. → Grade C. → Status: shipped. **Correction** *(verified here, Claude Code 2.1.272)*: plugin agents do not honour `omitClaudeMd` at all, so this claim was wrong for `xend-scout` and `xend-reader` as shipped; see H23.

**H18. Statistical gating is the only honest guarantee, and it must cover cost.** A paired design with bootstrap intervals, a sign test and a stated minimum detectable effect; promotion only when three gates pass at once: the one-sided 95% lower bound of the pass-rate delta is above -3 points, the upper bound of the cost change is below zero, and the upper bound of the turn delta is at most +0.25. Tokens and cost come from `modelUsage` and `total_cost_usd` (subagents included), never from the main-loop `usage` field, which excludes subagent work and would flatter delegation. Evidence merges across runs. → `bench/`. → Grade A for the mathematics. → Status: shipped; see section 6 for what the current suite can and cannot detect.

**H19. A lazy-solution ruleset injected at SessionStart lowers cost without lowering quality.**
Mechanism: a fixed ladder (YAGNI → already here → stdlib → native → installed dep → one line →
minimum new code) plus a root-cause bug-fix rule shortens the *solution*, not the reading, so the
model writes less code and takes fewer turns. → xend injects the rules from its existing
SessionStart hook and **defers to the upstream ponytail plugin whenever one is actually injecting**,
so exactly one copy reaches the model. → Saving: -10.3% cost (p = 0.004) on JetBrains' 80 paired
tasks with the ~1,382-token upstream-verbatim text. → Quality: no significant difference (65/9/6). →
**Grade B**: one independent paired study; the cost result is solid, the code result is not
(p = 0.088) and the vendor advertised -54% against a measured -15.4%. → Counter-evidence: xend's own
H16 finding that a fixed prefix is not amortized on five-turn tasks (~0.8% cost per 100 tokens), so
the upstream text's +1,412 tokens would need to return >11.5% gross on xend's own suite. xend's
default on `lite` and `balanced` is therefore a **240-token adaptation that nobody has measured**;
this text is xend's adaptation and is untested. It needs only ~2.4% gross to break even, but its
effect size is unknown and could be zero. → Validation: the paired A/B in §12 of `SPEC-ponytail.md`
(`pony-off` vs `pony-adapted` is the decision comparison; `pony-upstream` and `pony-strict` price
the verbatim text and xend's three `[xend]` reconciliation tags). → Status: **gated on that bench**,
which has not been run: the pre-registered promotion rule is PROMOTE only when the one-sided 95%
bounds satisfy Δcost ≤ +3.0%, Δpass ≥ -3.0 pp and Δturns ≤ +0.25; anything else demotes the feature
to opt-in on `lite` and `balanced`, and a pass-rate or turn regression turns it off everywhere.
Outcome of that gate (runs r4 and r5): the adapted text stays on in every profile (within noise of
no ponytail); the upstream-verbatim text failed the cost threshold (+16.7%) and is opt-in everywhere,
because the JetBrains number was measured on a different, longer task distribution.

**H20. Plan-then-build keeps reading out of the expensive model's context.** Mechanism: a model
that never reads file bodies cannot re-bill them every later turn; cheap subagents read and write
in disposable contexts discarded after their task, and the strong model integrates from short
reports instead of the files themselves. → xend implementation: architect mode (L7) — a plan file
and CLI (`xend-cli.js plan`), an architect paragraph in the session block, `xend-worker`/
`xend-worker-lite` dispatch through the `Agent` tool, a `SubagentStop` verifier (H21), and a
`PreToolUse` gate that makes the floor mechanical (H22). → Saving: **qualitative only** — no number
is claimed here. The mechanism targets the single largest cost driver this document has found
(section 1: reading is ~76% of context), at the price of a plan write, one cold builder prefix per
task, and the architect paragraph itself (measured here at ~313 tokens, see `docs/ARCHITECTURE.md`
L7). → Quality risk: a cheap builder can misjudge scope or misreport success; H21 is the mitigation,
not a guarantee. → **Grade C until the project bench runs.** → Validation: `bench/tasks/project-*`,
comparing `arch-<model>:xend:<model>:architect` against `solo-<model>:baseline:<model>`
(`bench/README.md`). → Status: **shipped in `balanced` and `aggressive`, gated on that bench's
outcome** — the same three-gate promotion rule as every other profile default (section 6/`H18`); a
regression on quality, cost or turns demotes it to opt-in.

**H21. Deterministic verification of cheap-model output.** Mechanism: a smaller model's claim of
success is not evidence of success. FrugalGPT and RouteLLM's own numbers show routing keeps ~95% of
quality on average, and name calibration — a small model confidently wrong — as the failure mode a
cascade cannot catch by asking the same model again; Anthropic's guidance is to verify a subagent's
output before trusting it. → xend implementation: `scripts/subagent-stop.js` re-runs the builder's
own stated verify command (checked against a fixed allowlist, never run otherwise) instead of
reading its claim, checks every `path:line` citation against the real files, and blocks a
mismatched or malformed reply exactly once so the subagent restates truthfully. → Saving: none
claimed; this is a trust mechanism, not a token-saving one, and costs one command re-run per worker
task. → Quality: positive when it fires (a false PASS is caught before the architect trusts it),
neutral otherwise. → **Grade B for the principle** (FrugalGPT/RouteLLM, Anthropic's verify-before-
trust guidance), **C for this specific mechanism** (allowlist coverage, citation regex), which is
unmeasured on its own. → Validation: `tests/verify.test.js` for the mechanism; the project bench's
mismatch/unverifiable counts (`verify.jsonl`, surfaced by `scripts/stats.js`) for how often it
actually catches something. → Status: shipped in `balanced` and `aggressive` (`architect.verify:
true`).

**H22. A behavioural rule needs a mechanical floor, not a suggestion.** Mechanism: an instruction
competes with the model's own strong prior toward "just do the work," and a named escape hatch is
an instruction the model can, and will, read as permission. → *(verified here)*: with the architect
paragraph in context but no gate, a headless Sonnet session given a three-module package to
implement did the whole task itself — 10 turns, no plan, zero subagents, $0.28; a first gate that
refused the third direct edit once and named `plan off` as the way out was used exactly that way —
11 turns, one denial, $0.18, then finished directly. → xend implementation:
`scripts/pre-edit-gate.js`, a `PreToolUse` deny with no advertised exit, bounded to
`architect.gateMaxDenials` denials per session. → Saving: none directly; this is what makes
architect mode run at all, so any benefit is inherited from H20. → Quality risk: none to the edited
code (it only delays a direct edit until a plan exists); the cost is turn tax, bounded by
`gateMaxDenials`. → **Grade A for the negative finding** (two independent, verified runs showing an
advisory rule and a soft gate failing the same way), **C for the gate's own numbers** (`minFiles`,
`gateMaxDenials`), which are a judgement call, not a measurement. → Validation: `tests/gate.test.js`;
indirectly, the project bench, since architect mode cannot run without the gate holding. → Status:
shipped in `balanced` and `aggressive` (`architect.gate: true`).

**H23. Subagent prefix diet through `tools:` allowlists.** Mechanism: every tool schema in a
request's prefix costs tokens whether or not the agent ever calls it (section 1: 219k of 267k
characters in one subagent request were tool schemas); an agent that declares only the tools it
uses skips every other tool's schema. → xend implementation: every shipped agent (`xend-scout`,
`xend-reader`, `xend-worker`, `xend-worker-lite`, `xend-reviewer`) declares `tools:` explicitly in
its frontmatter. → Saving: proportional to how many tools and MCP servers the host session has
configured; not separately measured for xend's own agents. → Quality: neutral (agents never needed
the omitted tools). → **Grade C.** → Validation: none beyond the frontmatter itself; a bench arm
comparing a `tools:`-restricted agent against an unrestricted one is not built. → Status: shipped.
**Note on H17**: `omitClaudeMd: true` was also shipped on `xend-scout` and `xend-reader` to remove
the memory-file prefix, but *(verified here, Claude Code 2.1.272)* plugin agents do not honour
`omitClaudeMd`, `hooks`, `mcpServers` or `permissionMode` at all — the field is inert for a
plugin-installed agent and is kept in the agent files only as a hint for a user- or project-level
copy. `tools:` is the only prefix lever that actually reaches a plugin subagent.

## 4. Rejected or deferred

| Idea | Why not (evidence) |
|---|---|
| Summarize tool output with a small model | Masking matched or beat it and was cheaper; summaries hid stopping signals and lengthened trajectories 13-15% (Complexity Trap). xend's transforms never call a model. |
| Symbol and abbreviation "compression" (`cfg`, `impl`, arrows) | Tokenizers split invented abbreviations into as many tokens as the word; arrows are their own token. Zero saving, real ambiguity (caveman's own finding). Ponytail's own `Pattern:` line *instructs* emitting an arrow; xend neutralises it rather than deleting it — the adapted text says "what was skipped, when to add it" in words, and the upstream-verbatim path appends an `[xend]` sentence to the same line. The vendored ruleset retains **four** arrow characters by design (fidelity beats tidiness); if arrows ever show up in model prose, all four get replaced with words and every "byte-identical" claim in the docs and tests is downgraded in the same change. |
| Compress the user's prompt or CLAUDE.md into telegraphic prose | CAVEWOMAN: input compression raises net cost ~1.15x and lowers accuracy. xend never rewrites prompts and audits memory files structurally only. |
| Rewrite commands before execution (rtk-style) | Independent benchmark: +7.6% cost, +13.8% turns. The model cannot recover what it never received. xend shapes results after execution and keeps the original. |
| Block large Reads with a PreToolUse deny | Forces an extra turn on every legitimately large read; no rigorous before/after exists. xend's `aggressive` profile turns such reads into honest ranged reads instead. |
| Replace a large Read result with a synthesized outline | A heuristic outline misses definitions (decorated methods, re-exports, `const f = () =>`) and the model reads a missing symbol as absent; it also makes the Read shape incoherent. Removed after review. |
| The caveman skill, vendored verbatim | xend's terse block **already is that style** (it descends from caveman and is credited as such), so a second copy is pure prefix tax; ponytail's own Boundaries section names caveman as its prose partner, and that role is already filled. Deliberately not vendored. |
| ponytail as an on-demand skill | JetBrains: "it will self-activate zero times." An on-demand copy costs ~206 tokens of skill-index description in every session and does nothing. The verbatim file is vendored under `vendor/ponytail/`, which Claude Code does not scan, so it costs zero tokens. |
| Injecting the upstream-verbatim ponytail text by default on every profile | 1,382 tokens per session against xend's own measured ~0.8% cost per 100 tokens of prefix on five-turn tasks: ~+11.5% predicted, more than the whole effect JetBrains measured. Available behind `ponytailText: 'upstream'` (opt-in in every profile after bench r5 measured +16.7%) and benchable. |
| Porting ponytail's `SubagentStart` hook | It would add ~1,382 tokens to every `xend-scout` and `xend-reader` call — Haiku subagents whose entire purpose is to be cheap — and would extend beyond what JetBrains measured, which was main-session injection only. |
| Minify JSON in tool output | Unmeasured token effect (pretty JSON tokenizes cheaply) and a real correctness risk: an `Edit` after `cat file.json` must match the pretty-printed file on disk. Removed from all profiles. |
| Shorten repeated `Read` results | A Read is the model's working copy; hiding it invites an `Edit` from memory. Dedupe is Bash-only. |
| Cut the middle of diffs or multi-failure test runs | The middle hunk or the middle failure is exactly what a reviewer or a fixer needs. Head/tail applies to generic output only. |
| Lower effort or switch to a cheaper model globally | Effort is the quality lever (-2 to -8 points on long-horizon coding); a model switch mid-session invalidates the cache. Per-task decisions only. |
| Route the main session through a third-party proxy or off-Anthropic backends | Breaks native prompt caching and changes the model; outside the quality bound by construction. |
| Semantic response caching | Chat-style evidence only; stale-reuse risk on near-duplicate coding requests. |
| Automatic `/compact` at low thresholds | Compaction is a paid summarization pass plus a cold cache; Anthropic recommends clearing rarely and in large batches. xend prefers checkpoint + `/clear` and, in `aggressive`, infrequent server-side clearing. |
| A `SubagentStop` verdict delivered via `hookSpecificOutput.additionalContext` | Reaches the parent, but *(verified here)* the subagent itself keeps replying to it — nine extra stops observed before a cap. `decision: block` with a reason makes it restate once cleanly instead; xend uses only `decision: block`. |
| A verifier living in `PostToolUse(Agent)` | The `Agent` tool is asynchronous in this build *(verified here, Claude Code 2.1.272)*: `PostToolUse(Agent)` fires at launch with `tool_response.status: "async_launched"` and no result to check. `SubagentStop` is the only hook that ever sees the subagent's final reply, so the verifier lives there instead. |
| A soft `PreToolUse` gate that names its own escape hatch (`plan off`) | *(verified here)*: the model used exactly the exit it was told about and finished the task directly (11 turns, one denial, $0.18) instead of planning. See H22. The shipped gate never advertises a way to disable itself. |

## 5. What xend adds that did not exist as a package

1. Tool-result shaping through the native `updatedToolOutput` hook: in-process, deterministic, lossless-recoverable, no proxy or daemon, with a marker contract designed against the rtk failure mode.
2. A per-session dedupe registry for byte-identical repeats that resets on compaction.
3. Server-side context editing switched on inside Claude Code through `CLAUDE_CODE_EXTRA_BODY`, with conservative batch parameters.
4. A lightweight checkpoint written before compaction and re-injected after compaction or `/clear`, without a database or background worker.
5. A static audit of prefix composition (memory files, settings, MCP servers, per-turn hooks, cache hit ratio) with ranked, specific fixes.
6. Honest range limiting for unranged reads of very large files (aggressive), through a PreToolUse `updatedInput`.
7. A verify-or-escalate delegation contract for cheap-model subagents, shipped as agents plus a routing skill.
8. A paired benchmark that reports its minimum detectable effect and merges evidence across runs, with a three-part promotion gate (quality, cost, turns) instead of a marketing percentage, and adversarial tasks built to catch the ways a condenser fails.
9. Mechanical verification of subagent citations and worker claims in a `SubagentStop` hook: every `path:line` a subagent cites is checked against the real files and, for `xend-reader`, against the quoted text on that line; a worker's claimed test pass is re-run against an allowlisted command rather than trusted; a mismatch or bad citation is sent back once for restatement (`scripts/subagent-stop.js`, H21).

Ideas from the adversarial review that are not built yet, in order of expected value: an audit line for each MCP server's schema cost; LSP (code-intelligence) plugin suggestions per repository language; structure-aware retrieval (expand a grep hit to its enclosing function; a token-budgeted repo map); a bench arm against Claude Code's built-in Concise output style; graded scoring and a position-swapped LLM judge for commit messages and docs, which the pass/fail bench cannot see.

## 6. Measuring quality: the 3% question

For a binary pass/fail outcome at a 70% baseline pass rate, detecting a 3-point drop at 80% power and one-sided alpha 0.05 needs roughly:

| Design | Paired task-runs needed |
|---|---|
| independent arms (wrong design) | ~3,000 per arm |
| paired, between-arm correlation 0.8, one trial per task | ~600 |
| paired, 150 tasks x 5 trials | ~750 total runs |
| paired, 50 tasks x 5 trials | detects ~5 points, not 3 |
| paired, 16 tasks x 1 trial (the shipped suite, one run) | detects ~12-20 points |

Token savings are continuous and large, so the same runs measure them tightly. This asymmetry is
why xend reports a minimum detectable effect next to every pass-rate delta and merges every run
under `bench/results/`: the bound is reached by accumulation, not by a single run. Graded scoring
(partial credit per test case) and LLM-judge pairwise comparison with position swapping would raise
power per run and are the next step for the suite.

## 7. Verified in this environment (Claude Code 2.1.272)

- Hook input and output shapes for Bash, Read, Grep (content and files modes), Glob; the exact fields are in `scripts/post-tool-use.js`.
- PostToolUse `updatedToolOutput` replaces what the model sees; PreToolUse `updatedInput` rewrites tool input.
- `CLAUDE_CODE_EXTRA_BODY` with `context_management` produces `applied_edits` in API responses (`cleared_tool_uses` 2 then 3; `cleared_input_tokens` 6,093 then 11,558).
- Fixed prefix 32,062 tokens per request in this environment; `--strict-mcp-config` did not remove host-provided connectors.
- Plugin validation passes (`claude plugin validate . --strict`); `claude -p --plugin-dir` loads hooks and shaping runs in a live session.
- Run r1 (16 tasks, Claude Sonnet 5, low effort, one trial per arm, pre-review defaults): pass rate 93.8% in both arms; output tokens -9.0%; turns 4.8 to 4.6; cost $0.106 to $0.103 per task; the log-needle task 8 to 4 turns and 455k to 206k tokens; short five-turn tasks +2% for the plugin's prefix.
- Run r2 (21 tasks including 5 adversarial, two trials per arm, revised defaults): pass rate 90.5% to 95.2% (no task worse, two better; sign test p = 0.50); output tokens -3.2%; turns 4.5 to 4.6; total tokens +6.4%; cost +9.0% (95% CI +6.1% to +11.9%); minimum detectable pass-rate drop 8.2 points; gate: quality PASS, cost FAIL, turns INCONCLUSIVE. Shaping fired on one task (the 270-hit grep refactor). The plugin's own prefix explains the cost: uncached input +12.7%.
- Run r3 (same suite, one trial, prefix trimmed by ~40%, the shipped configuration): pass rate 95.2% to 90.5%, the difference being one adversarial task (`adv-middle-of-output`) that passed 1 of 3 times in each arm across r2 and r3; output tokens -8.6%; turns 4.8 to 4.5; total tokens +0.8%; uncached input +8.4%; cost +3.5% (95% CI -1.2% to +7.9%); gate: quality INCONCLUSIVE (MDE 11.8 points at n=21 x 1), cost INCONCLUSIVE, turns PASS. Merged r2 + r3 (63 paired runs, mixed configurations): pass +1.6 points (95% CI 0 to +4.8), output -5.5%, turns unchanged, cost +6.9%. Conclusion: on five-turn tasks the shipped plugin is cost-neutral to slightly negative and quality-neutral; its savings have to be shown on long and reading-heavy sessions, which this suite does not contain yet.
- Run r4 (same suite, one trial, ponytail `full` with xend's adapted text, the shipped `balanced` default): pass rate 90.5% in both arms (the same two tasks fail on both sides); output tokens -4.9%; turns 4.3 to 4.5; total tokens +6.8%; cost +3.9% (95% CI -4.5% to +10.0%); gate INCONCLUSIVE on cost and turns. Against r3 (xend without ponytail: cost +3.5%) the adapted ruleset is indistinguishable on these micro-tasks, which write very little code to begin with; the JetBrains effect was measured on larger SkillsBench tasks. Run r5 (same suite, one trial, ponytail `full` with the upstream-verbatim text): pass rate 95.2% to 90.5% (the flaky adversarial task); output tokens +8.6%; turns 4.5 to 5.0; uncached input +20.9%; cost +16.7% (95% CI +10.6% to +24.0%); gate FAIL on cost. The three xend arms line up with prefix size: no ponytail $0.106, adapted $0.112, upstream $0.117 per task. Conclusion: ponytail's measured saving does not transfer to five-turn micro-tasks; the shipped default is the small adapted text in every profile and the upstream text is opt-in for long, code-heavy sessions, where the JetBrains result was obtained.
- A benchmark bug worth recording: the runner passed a relative state directory, so hooks wrote their logs under the fixture copy and the "shaping activity" column read zero for every task. Every number above was still produced by real runs; the log was simply lost. Fixed by resolving the directory to an absolute path.
- The `Agent` tool is asynchronous: `PostToolUse(Agent)` fires at launch with `tool_response.status = "async_launched"` and no result — a verifier cannot live there. `SubagentStop` input carries `agent_id`, `agent_type` (namespaced, e.g. `xend:xend-scout`), `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`. With `--no-session-persistence` (the bench setting) the subagent transcript file named by `agent_transcript_path` does not exist at stop time; `last_assistant_message` is still delivered.
- `SubagentStop` returning `{"decision":"block","reason":"..."}` makes the subagent continue with the reason as input and restate once cleanly, triggering `SubagentStop` again with `stop_hook_active: true`. Returning `hookSpecificOutput.additionalContext` instead reaches the parent as a system reminder but also makes the subagent keep replying to it — nine extra stops observed until a cap. xend uses only `decision: block` for verdicts.
- Plugin agents do not honour `omitClaudeMd`, `hooks`, `mcpServers` or `permissionMode`; `tools:` allowlists do work and are the only prefix lever available to a plugin subagent (corrects H17; see H23).
- Model aliases `haiku`, `sonnet`, `opus`, `fable` all resolve in headless mode.
- Smoke test 1 (architect paragraph in the session block, no gate; a headless Sonnet session given a three-module package to implement): the model did the task itself — 10 turns, no plan, zero subagents, $0.28. The rule was read and ignored.
- Smoke test 2 (a first, soft gate that refused the third direct edit once and named `plan off` as the way out): the model ran `plan off` and finished directly — 11 turns, one denial, $0.18. This is why the shipped gate (`docs/SPEC-architect.md` section 13, H22) never advertises an exit.
- The session block measured with `node scripts/xend-cli.js context | wc -c` at `balanced`: 2,869 B / ~755 tokens with architect mode on (the default), 1,680 B / ~442 tokens with `XEND_ARCHITECT=0` — the architect paragraph costs about 1,189 B / ~313 tokens (see `docs/ARCHITECTURE.md`).

## 8. Sources

- JetBrains: https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/ (caveman; rtk in part 2 of the same series)
- JetBrains Research, The Complexity Trap: https://arxiv.org/abs/2508.21433 and https://blog.jetbrains.com/research/2025/12/efficient-context-management/
- Adobe Research, CAVEWOMAN: https://arxiv.org/abs/2606.24083
- Anthropic context editing: https://platform.claude.com/docs/en/build-with-claude/context-editing ; memory tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching ; Claude Code caching: https://code.claude.com/docs/en/prompt-caching
- Anthropic, effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code costs: https://code.claude.com/docs/en/costs ; context window: https://code.claude.com/docs/en/context-window ; hooks: https://code.claude.com/docs/en/hooks
- Chroma, Context Rot: https://www.trychroma.com/research/context-rot
- Lost in the Middle: https://arxiv.org/abs/2307.03172
- aider repo map: https://aider.chat/2023/10/22/repomap.html
- FrugalGPT: https://arxiv.org/abs/2305.05176 ; RouteLLM: https://arxiv.org/abs/2406.18665
- SWE-Pruner: https://www.arxiv.org/pdf/2601.16746
- OpenHands condensers: https://docs.openhands.dev/sdk/arch/condenser
- Mini-SWE-Agent token profile: https://towardsdatascience.com/agentic-ai-how-to-save-on-tokens/
- caveman: https://github.com/JuliusBrussee/caveman ; rtk: https://github.com/rtk-ai/rtk ; context-guard: https://github.com/ictechgy/context-guard ; ccusage: https://github.com/ccusage/ccusage
