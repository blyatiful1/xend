#!/usr/bin/env bash
# Reference fix for session-deps-16: rewrites each kit module from the same stdlib source without the planted bug,
# normalised exactly as gen.sh normalises it, so the only difference from the broken copy is the bug.
set -eu
python3 - <<'PY'
import ast, json, os, sysconfig
MODS = json.loads(r"""[["textwrap.py", "wrap"], ["_pydecimal.py", "dec"], ["difflib.py", "diffs"], ["urllib/parse.py", "urls"], ["statistics.py", "stats"], ["argparse.py", "cli"], ["fractions.py", "ratio"], ["pprint.py", "pretty"], ["shlex.py", "lexer"], ["plistlib.py", "plist"], ["calendar.py", "cal"], ["fnmatch.py", "globs"], ["ipaddress.py", "netaddr"], ["heapq.py", "heap"], ["configparser.py", "config"], ["graphlib.py", "graph"]]""")
lib = sysconfig.get_paths()['stdlib']
for src, mod in MODS:
    s = open(os.path.join(lib, src), encoding="utf-8").read()
    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(ast.unparse(ast.parse(s)) + "\n")
PY
