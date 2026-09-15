# Security policy

xend runs as Claude Code hooks on your machine. It reads hook input on stdin, reads and
writes files under its own per-session state directory, and (only through `/xend:setup`,
with a backup and a printed diff) edits your Claude Code settings. It makes no network
requests of its own.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository ("Security" tab, "Report a vulnerability"),
or contact the maintainer through the profile linked in `.claude-plugin/plugin.json`.

Include the xend version (`.claude-plugin/plugin.json`), the Claude Code version, the
profile in use, and a minimal reproduction. You should hear back within a week.

## Scope

In scope: anything that lets a tool result or a repository file cause xend's hooks to
alter a `Read` result, drop an error or a diff hunk from what the model sees, write
outside the session state directory or the files `/xend:setup` names, or execute
untrusted content.

Out of scope: the behaviour of the model itself, and of third-party plugins xend
detects or defers to (such as ponytail).
