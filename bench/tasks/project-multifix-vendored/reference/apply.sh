#!/usr/bin/env bash
# Reference fix for project-multifix-vendored: undoes the one bug planted in each kit module.
set -eu
python3 - <<'PY'
import json
BUGS = json.loads(r"""[["wrap", "            space_left = width - cur_len - 1\n", "            space_left = width - cur_len\n"], ["diffs", "    beginning = start\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n", "    beginning = start + 1     # lines start numbering with one\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n"], ["stats", "    if method == 'exclusive':\n        m = ld\n", "    if method == 'exclusive':\n        m = ld + 1\n"], ["ratio", "            elif floor % 2 == 1:\n", "            elif floor % 2 == 0:\n"], ["lexer", "        self.escapedquotes = \"'\"\n", "        self.escapedquotes = '\"'\n"], ["cal", "        day1, ndays = monthrange(year, month)\n        days_before = (self.firstweekday - day1) % 7\n        yield from repeat(0, days_before)\n", "        day1, ndays = monthrange(year, month)\n        days_before = (day1 - self.firstweekday) % 7\n        yield from repeat(0, days_before)\n"], ["netaddr", "                    (last_int - first_int + 1).bit_length())\n", "                    (last_int - first_int + 1).bit_length() - 1)\n"], ["config", "                        opt = path[0]\n                        v = map[opt]\n", "                        opt = parser.optionxform(path[0])\n                        v = map[opt]\n"]]""")
for mod, bad, good in BUGS:
    p = 'kit/' + mod + '.py'
    s = open(p).read()
    assert s.count(bad) == 1, p
    open(p, "w").write(s.replace(bad, good))
PY
