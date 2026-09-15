# Third-party notices

xend redistributes and adapts third-party material. One section per component.

Other tools xend merely recommends or measures against (rtk, claude-mem, ccusage, and the
caveman output style xend's terse block descends from) are credited in `README.md`; they are
not redistributed and so have no section here.

---

## ponytail

| Field | Value |
|---|---|
| Component | ponytail — "lazy senior dev mode" Claude Code plugin |
| Author | Dietrich Gebert (@DietrichGebert) |
| Source | https://github.com/DietrichGebert/ponytail |
| Version | 4.10.0 (declared in upstream `.claude-plugin/plugin.json`) |
| Commit SHA | `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156` (`chore: release v4.10.0 (#870)`, 2026-09-14) |
| Fetch date | 2026-09-15 |
| SPDX identifier | `MIT` |

The commit SHA was observed in a real clone at vendoring time
(`claude plugin marketplace add DietrichGebert/ponytail`, then `git rev-parse HEAD` in
`~/.claude/plugins/marketplaces/ponytail`). Integrity anchors, the exact command that
reproduces them, and the refresh procedure are in `vendor/ponytail/PROVENANCE.md`.

### License

```
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### (a) Redistributed verbatim

These files are byte-identical to upstream, frontmatter included, and are never edited by
xend:

| Path | Bytes | sha256 |
|---|---|---|
| `vendor/ponytail/SKILL.md` | 6,637 | `1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2` |
| `vendor/ponytail/LICENSE` | 1,071 | `fb1bc6909ac3ef82d5c22106e32ef682b0cff66788fa915fb9b53b15c9d2f3ab` |

`tests/fixtures/ponytail-injected-{lite,full,ultra}.md` are captures of upstream's own
SessionStart hook output at ponytail 4.10.0, kept as fidelity fixtures. They are derived
from the same MIT-licensed source.

When `ponytailText: 'upstream'` is active, xend emits `vendor/ponytail/SKILL.md` (or the
detected live install's copy) through a port of upstream's own
`filterSkillBodyForMode` — **this text is upstream-verbatim (the measured artifact)** —
with at most three ` [xend]` sentences appended to existing lines, and none at all when
`ponytailStrict` is set.

### (b) Adapted derivative text

The following xend-authored strings are condensed from, or reconcile with, ponytail's
ruleset. **This text is xend's adaptation and is untested**: the published JetBrains
measurements describe upstream's ~1,382-token artifact, not these ~240 tokens.

| Where | Symbol |
|---|---|
| `scripts/lib/context.js` | `LEAN` |
| `scripts/lib/context.js` | `LEAN_LEVEL` (`lite` / `full` / `ultra`) |
| `scripts/lib/context.js` | `LEAN_UPSTREAM` (xend original; contains no ponytail text) |
| `scripts/lib/context.js` | `LEAN_BRIDGE` (xend original; contains no ponytail text) |
| `skills/ponytail/SKILL.md` | the `/xend:ponytail` switcher skill (xend-authored; the level descriptions paraphrase upstream's intensity table) |

Itemized adaptations:

1. **Condensed to one paragraph.** ~5,700 bytes of upstream body become an 815-byte `LEAN`
   paragraph: the seven-rung ladder, the root-cause bug-fix rule, the
   no-unrequested-abstraction rules, the output contract and the "when NOT to be lazy" list.
   Persistence, Boundaries, the worked cache example, the hardware-calibration paragraph and
   the intensity-table markup are dropped.
2. **Arrows removed.** Upstream's body contains four `→` characters; xend's terse rules
   forbid arrows in model output, so the adapted text says the same things in words.
3. **Output pattern re-worded** from `[code] → skipped: [X], add when [Y].` to "After the
   code, at most three short lines: what was skipped, when to add it."
4. **Reading subordinated** to xend's own reading-discipline sentence: "Understand first:
   trace the flow under the reading rule above."
5. **Caveman pairing dropped** — xend's terse block already is that style.
6. **Switch command re-pointed** from `/ponytail lite|full|ultra` to `/xend:ponytail`.
7. **Intensity table flattened** into three one-line `LEAN_LEVEL` strings, without the table
   markup or the trailing "Default." clause.
8. **`LEAN_UPSTREAM` and `LEAN_BRIDGE` are xend originals** that reconcile ponytail's output
   with xend's terse and reading rules; they reproduce no ponytail wording.

xend ships **no** `SubagentStart` hook and does not port upstream's.
