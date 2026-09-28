# Security policy

xend runs as Claude Code hooks on your machine. It reads hook input on stdin, reads and
writes files under its own per-session state directory (created `0700`, files `0600`), and
(only through `/xend:setup`, with a backup and a printed diff) edits your Claude Code settings.
It makes no network requests of its own.

Two hooks run commands, and a hook cannot show a permission prompt:

- the auto-test (`scripts/record-edit.js`, balanced and aggressive profiles) runs the project's
  test command after an `Edit`, which executes the repository's own code (`package.json`
  scripts, `conftest.py`, test files);
- the SubagentStop verifier (`scripts/subagent-stop.js`) re-runs the verify command an xend
  builder or a plan task names.

Both run a command only when Claude Code itself would run it without asking: an allow rule in
your settings matches it, the session is in `bypassPermissions` mode, or you set
`"trustTestCommands": true` in `~/.config/xend/config.json` (or `XEND_TRUST_TESTS=1`). A deny or
ask rule always wins. Allow rules count only from managed settings, your user settings and the
project root's `.claude/` (only managed ones under `allowManagedPermissionRulesOnly`); a
`.claude/settings.json` in a subdirectory adds deny and ask rules only. The trust setting and the
auto-test's settings are resolved when the hook runs, never read from the session's cached
config (which lives in a directory the model may be able to write).

Known limits: a hook cannot see permission rules given on the command line (`--disallowedTools`,
`--settings`), by MDM or registry policy, or by server-managed settings, so it cannot honour
them. If you rely on those to forbid a test command, leave `trustTestCommands` off and do not run
in `bypassPermissions` mode. Commands must also pass a fixed allowlist of test runners and flags, run
without a shell, and may not name absolute, `~` or `..` paths. A repository's own `.xend.json`
cannot enable the auto-test, choose its command or trust it.

`/xend:setup` runs `claude plugin marketplace add` and `claude plugin install` for the
third-party ponytail plugin only when you pass `--install-ponytail`.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a vulnerability"),
or contact the maintainer through the profile linked in `.claude-plugin/plugin.json`.

Include the xend version (`version` in `.claude-plugin/plugin.json`), the Claude Code version
(`claude --version`), the profile in use (`/xend:profile`), and a minimal reproduction. You should hear back within a week.

## Scope

In scope: anything that lets a tool result or a repository file cause xend's hooks to
alter a `Read` result, drop an error or a diff hunk from what the model sees, write
outside the session state directory or the files `/xend:setup` names, run a command that
Claude Code would have asked about, or execute untrusted content.

Out of scope: the behaviour of the model itself, and of third-party plugins xend
detects or defers to (such as ponytail).
