# Opt-in extras

Everything a plugin ships in `agents/` or `skills/` is listed to the model in every session,
whether or not it is ever used, and that listing is re-read on every turn. Bench runs r6 and r7b
showed plain xend never spawning `xend-scout`, `xend-reader` or `xend-reviewer` on long tasks,
so they moved here, where Claude Code does not scan them and they cost nothing.

To use one, copy it into your user or project agents directory:

```bash
cp extras/agents/xend-scout.md ~/.claude/agents/      # every project
cp extras/agents/xend-scout.md .claude/agents/        # this project only
```

As user or project agents they gain two things they lacked inside the plugin: `omitClaudeMd`
is honoured (plugin agents ignore it), and the SubagentStop verifier still recognizes them by
name, so their `path:line` citations are checked against the real files as before.

| Agent | Model | Use for |
|---|---|---|
| `xend-scout` | Haiku | read-only locator for bulk exploration; returns `path:line` citations only. Claude Code's built-in `Explore` agent covers most of the same ground. |
| `xend-reader` | Haiku | condenses one large artifact (log, generated file) into a brief with verbatim evidence lines |
| `xend-reviewer` | Sonnet | reviews a substantial diff for defects; findings only |
