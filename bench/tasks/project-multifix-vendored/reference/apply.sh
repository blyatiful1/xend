#!/usr/bin/env bash
# Reference fix for project-multifix-vendored: rewrites each kit module from the same stdlib source without the planted bug,
# normalised exactly as gen.sh normalises it, so the only difference from the broken copy is the bug.
set -eu
python3 - <<'PY'
import ast, json, os, sysconfig
MODS = json.loads(r"""[["textwrap.py", "wrap"], ["difflib.py", "diffs"], ["statistics.py", "stats"], ["fractions.py", "ratio"], ["shlex.py", "lexer"], ["calendar.py", "cal"], ["ipaddress.py", "netaddr"], ["configparser.py", "config"]]""")
lib = sysconfig.get_paths()['stdlib']
for src, mod in MODS:
    s = open(os.path.join(lib, src), encoding="utf-8").read()
    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(ast.unparse(ast.parse(s)) + "\n")
PY
