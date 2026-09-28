# Contributing to xend

Thanks for taking a look. xend is small on purpose: Node.js 18+ is the only runtime
dependency, and there is no build step.

## Before you open a pull request

Run the same three checks CI runs:

```bash
npm test                          # unit tests (node --test)
bash bench/selftest.sh            # every bench task fails before its fix and passes after
claude plugin validate . --strict # plugin and marketplace manifests
```

`bench/selftest.sh` needs `python3` and `pytest` on the PATH.

## What a change needs

- **A version bump** in `.claude-plugin/plugin.json` and `package.json`, plus a `CHANGELOG.md`
  entry, for any change to `scripts/`, `hooks/`, `agents/` or `skills/`: Claude Code updates an
  installed plugin only when the version changes.

- **Shaping transforms** (`scripts/lib/shape.js`) must stay deterministic string work and
  recoverable. Errors, failures, diffs, stack traces and summary lines are never dropped;
  anything condensed carries a `[xend]` line saying what was removed. Add a unit test in
  `tests/shape.test.js` and, if the transform can hide information a model needs, an
  adversarial bench task under `bench/tasks/adv-*` that fails when it does.
- **Profile changes** (`scripts/lib/config.js`, `docs/PROFILES.md`) that alter what is
  injected or shaped by default should come with a paired bench run
  (`node bench/run.js`) and its `runs.jsonl` committed under `bench/results/<run>/`, plus
  a sentence in `docs/RESEARCH.md` §7 recording the numbers honestly, including the ones
  that went the wrong way.
- **Vendored ponytail text** (`vendor/ponytail/`) is byte-for-byte upstream. Refresh it
  with the procedure in `vendor/ponytail/PROVENANCE.md` and update both hash tables;
  `tests/ponytail.test.js` will fail otherwise.
- New skills, agents or hooks add to every session's fixed prefix. Say in the PR what they
  cost in tokens and why that rent is worth paying. Measure it rather than estimate it: the
  warm-up line of `node bench/run.js` prints each arm's first-request cache write, and the
  difference between a baseline and an xend arm is exactly what the plugin adds per session
  (this text tokenizes at roughly 2.7 characters per token, not 4). Anything useful only to some
  users belongs in `extras/`, which Claude Code does not scan.
- **Agent reply formats** (the `Result: / Changed: / Verification: / Notes:` block in
  `xend-worker`/`xend-worker-lite`, the citation and evidence lines in `extras/agents/`
  `xend-scout`/`xend-reader`/`xend-reviewer`) are contracts parsed by `scripts/lib/verify.js`, not just
  prose: changing the wording, field order or line format needs a matching change in
  `verify.js` and in `tests/verify.test.js`, or `scripts/subagent-stop.js` silently stops
  verifying what the agent claims. New hooks must never call a model and must never run a
  command that is not checked against an explicit allowlist first (see
  `scripts/lib/verify.js`'s `commandAllowed`), must run it without a shell (`runVerify`), and
  must run it only when `scripts/lib/permissions.js`'s `check` says Claude Code would run it
  without asking; this holds for every hook, not only `SubagentStop` (the auto-test in
  `scripts/lib/autotest.js` goes through the same checks).

## Reporting bugs

Open an issue with the profile in use (`/xend:profile`), the Claude Code version
(`claude --version`), and, for a shaping bug, the `[xend]` marker line and the original
tool output it replaced (the marker names the saved file when one exists).

## License

By contributing you agree that your contributions are licensed under the MIT License in
`LICENSE`.
