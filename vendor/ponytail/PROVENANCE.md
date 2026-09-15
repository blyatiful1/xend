# Provenance — vendor/ponytail

`SKILL.md` and `LICENSE` in this directory are **unmodified** copies of the upstream
ponytail plugin. Nothing in this directory is xend's own text, and nothing here is
edited by xend — not a byte, not the frontmatter, not the four `→` characters in the
body. Adaptations live in `scripts/lib/context.js` and `skills/ponytail/SKILL.md` and
are listed at the end of this file.

## Source

| Field | Value |
|---|---|
| Component | ponytail (Claude Code plugin / skill) |
| Upstream repository | https://github.com/DietrichGebert/ponytail |
| Author | Dietrich Gebert (@DietrichGebert) |
| License | MIT — "Copyright (c) 2026 DietrichGebert" (`LICENSE` in this directory) |
| Version | 4.10.0 |
| Commit SHA | `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156` |
| Commit subject | `chore: release v4.10.0 (#870)` |
| Commit date | 2026-09-14 |
| Fetch date | 2026-09-15 |
| How fetched | `claude plugin marketplace add DietrichGebert/ponytail`, which clones the repo to `~/.claude/plugins/marketplaces/ponytail`; SHA read with `git rev-parse HEAD` in that clone |

The commit SHA above **was actually observed** in a real clone during vendoring (the
`git rev-parse HEAD` command in the table), not taken from a release page or an API
listing.

## Integrity anchors

| Artifact | Bytes | sha256 |
|---|---|---|
| `SKILL.md` (whole file, frontmatter included) | 6,637 | `1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2` |
| `SKILL.md` body after frontmatter is stripped | 5,700 | `4e7382857d47d796bd20454c6d10318293fd3724efef6cc1e90cdf589e765e24` |
| `LICENSE` | 1,071 | `fb1bc6909ac3ef82d5c22106e32ef682b0cff66788fa915fb9b53b15c9d2f3ab` |

The body hash is over the string produced by the exact regex xend's filter uses:

```bash
node -e 'const fs=require("fs"),c=require("crypto");
const b=fs.readFileSync("vendor/ponytail/SKILL.md","utf8").replace(/^---[\s\S]*?---\s*/,"");
console.log(Buffer.byteLength(b), c.createHash("sha256").update(b).digest("hex"));'
```

Both hashes are asserted by `tests/ponytail.test.js`, which reads the expected values **out
of this file**, so a notice that drifts from the artifact fails CI rather than going quiet.

## Refresh procedure

1. `claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail`
2. Copy the new skill over the vendored one:
   `cp ~/.claude/plugins/cache/ponytail/ponytail/<version>/skills/ponytail/SKILL.md vendor/ponytail/SKILL.md`
   (and `LICENSE` from the same tree).
3. Record the new version, commit SHA (`git rev-parse HEAD` in
   `~/.claude/plugins/marketplaces/ponytail`), fetch date and both sha256 values in the
   tables above, and in `THIRD_PARTY_NOTICES.md`.
4. Re-run `node --test tests/ponytail.test.js`. The fidelity fixtures in `tests/fixtures/`
   were captured from ponytail 4.10.0; if upstream changed the ruleset they must be
   re-captured from the new install and the change reviewed, not silently accepted.

## Why this file is not under `skills/`

Claude Code scans only `skills/` for model-invocable skills, so a copy here costs **zero**
tokens of skill-index description. Upstream's own 825-character description would cost about
206 tokens in every session, and JetBrains measured that as an on-demand skill it
**self-activates zero times** — it would pay that rent and do nothing. xend injects the
rules from its SessionStart hook instead, which is the only configuration anyone has
measured. See `docs/RESEARCH.md` §4.

## What xend adapted (derivative text, not in this directory)

The constants `LEAN`, `LEAN_LEVEL`, `LEAN_UPSTREAM` and `LEAN_BRIDGE` in
`scripts/lib/context.js`, and `skills/ponytail/SKILL.md`, are xend's own condensation and
are **untested by anyone** — no study covers them. The adaptations are:

1. **Condensed to one paragraph.** ~5,700 bytes of upstream body become an 815-byte `LEAN`
   paragraph: the seven-rung ladder, the root-cause bug-fix rule, the no-unrequested-
   abstraction rules, the output contract and the "when NOT to be lazy" list. Everything
   else (Persistence, Boundaries, the worked cache example, the hardware-calibration
   paragraph, the intensity table markup) is dropped.
2. **Arrows removed.** Upstream's body contains four `→` characters (ladder rung 2, the
   two-rungs reflex line, the `Pattern:` output line, and the "user insists" line). xend's
   terse rules forbid arrows in model output, so the adapted text states the same things in
   words and never shows an arrow.
3. **Output pattern re-worded.** `[code] → skipped: [X], add when [Y].` becomes
   "After the code, at most three short lines: what was skipped, when to add it."
4. **Reading subordinated.** "Trace the whole thing first — every file the change touches"
   becomes "Understand first: trace the flow under the reading rule above", which points at
   xend's own reading-discipline sentence instead of contradicting it.
5. **Caveman pairing dropped.** Upstream's Boundaries section says "pair with Caveman for
   terse prose". xend's terse block already is that style, so the clause is not reproduced.
6. **Switch command re-pointed.** `/ponytail lite|full|ultra` becomes `/xend:ponytail`,
   which is the command that exists when upstream is not installed.
7. **Intensity table flattened.** The three table cells become three one-line
   `LEAN_LEVEL` strings with the markup and the trailing "Default." clause dropped.
8. **`LEAN_UPSTREAM` and `LEAN_BRIDGE` are xend originals** and contain no ponytail text;
   they reconcile upstream's output with xend's terse rules.

When `ponytailText: 'upstream'` is active, xend emits `SKILL.md` from this directory through
the ported upstream filter instead, with at most three ` [xend]` sentences appended to
existing lines (and none at all under `ponytailStrict`). Nothing is deleted or re-worded on
that path.

Note on the reconciliation tags: "end of line" in the spec means "after the clause the tag reconciles"; the third tag is inserted right after "terse prose)." because that physical line continues into the next sentence.
