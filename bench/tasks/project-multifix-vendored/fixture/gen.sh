#!/usr/bin/env bash
# Builds kit/ from this machine's own Python standard library (PSF License, see THIRD_PARTY_NOTICES.md):
# eight pure-Python modules copied under new names, each with exactly one bug planted. Patch points were
# checked against CPython 3.11, 3.12 and 3.13; a patch that does not apply stops the build.
set -eu
python3 - <<'PY'
import json, os, sysconfig
BUGS = json.loads(r"""[["textwrap.py", "wrap", "            space_left = width - cur_len\n", "            space_left = width - cur_len - 1\n"], ["difflib.py", "diffs", "    beginning = start + 1     # lines start numbering with one\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n", "    beginning = start\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n"], ["statistics.py", "stats", "    if method == 'exclusive':\n        m = ld + 1\n", "    if method == 'exclusive':\n        m = ld\n"], ["fractions.py", "ratio", "            elif floor % 2 == 0:\n", "            elif floor % 2 == 1:\n"], ["shlex.py", "lexer", "        self.escapedquotes = '\"'\n", "        self.escapedquotes = \"'\"\n"], ["calendar.py", "cal", "        day1, ndays = monthrange(year, month)\n        days_before = (day1 - self.firstweekday) % 7\n        yield from repeat(0, days_before)\n", "        day1, ndays = monthrange(year, month)\n        days_before = (self.firstweekday - day1) % 7\n        yield from repeat(0, days_before)\n"], ["ipaddress.py", "netaddr", "                    (last_int - first_int + 1).bit_length() - 1)\n", "                    (last_int - first_int + 1).bit_length())\n"], ["configparser.py", "config", "                        opt = parser.optionxform(path[0])\n                        v = map[opt]\n", "                        opt = path[0]\n                        v = map[opt]\n"]]""")
lib = sysconfig.get_paths()['stdlib']
for src, mod, old, new in BUGS:
    s = open(os.path.join(lib, src), encoding="utf-8").read()
    if s.count(old) != 1:
        raise SystemExit("gen.sh: patch point for %s not found in %s" % (mod, lib))
    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(s.replace(old, new))
PY
