"""Regenerates this task (tests, expected values, gen.sh, reference fix) from the running Python's stdlib.

Run with the Python whose results the hidden tests should pin (3.11 for the committed files):
    python3 bench/tasks/project-multifix-vendored/build.py
"""
import os, shutil, sys, json, sysconfig
SRC = sysconfig.get_paths()['stdlib']
T = os.path.dirname(os.path.abspath(__file__))
# (stdlib file, kit module, old, new)
BUGS = [
 ('textwrap.py', 'wrap', "            space_left = width - cur_len\n", "            space_left = width - cur_len - 1\n"),
 ('difflib.py', 'diffs', "    beginning = start + 1     # lines start numbering with one\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n",
                         "    beginning = start\n    length = stop - start\n    if length == 1:\n        return '{}'.format(beginning)\n    if not length:\n        beginning -= 1        # empty ranges begin at line just before the range\n    return '{},{}'.format(beginning, length)\n"),
 ('statistics.py', 'stats', "    if method == 'exclusive':\n        m = ld + 1\n", "    if method == 'exclusive':\n        m = ld\n"),
 ('fractions.py', 'ratio', "            elif floor % 2 == 0:\n", "            elif floor % 2 == 1:\n"),
 ('shlex.py', 'lexer', "        self.escapedquotes = '\"'\n", "        self.escapedquotes = \"'\"\n"),
 ('calendar.py', 'cal', "        day1, ndays = monthrange(year, month)\n        days_before = (day1 - self.firstweekday) % 7\n        yield from repeat(0, days_before)\n",
                        "        day1, ndays = monthrange(year, month)\n        days_before = (self.firstweekday - day1) % 7\n        yield from repeat(0, days_before)\n"),
 ('ipaddress.py', 'netaddr', "                    (last_int - first_int + 1).bit_length() - 1)\n", "                    (last_int - first_int + 1).bit_length())\n"),
 ('configparser.py', 'config', "                        opt = parser.optionxform(path[0])\n                        v = map[opt]\n", "                        opt = path[0]\n                        v = map[opt]\n"),
]
for d in ('fixture', 'hidden', 'reference'):
    if os.path.exists(os.path.join(T, d)): shutil.rmtree(os.path.join(T, d))
for d in ('fixture/kit', 'fixture/tests', 'hidden', 'reference'): os.makedirs(os.path.join(T, d))
open(os.path.join(T, 'fixture/kit/__init__.py'), 'w').write('"""kit: a grab bag of utility modules."""\n')
for f, mod, old, new in BUGS:
    s = open(os.path.join(SRC, f)).read()
    assert s.count(old) == 1, (f, s.count(old))
    open(os.path.join(T, 'fixture/kit', mod + '.py'), 'w').write(s.replace(old, new))
# reference: undo each bug by exact replacement
ref = ['#!/usr/bin/env bash', '# Reference fix for project-multifix-vendored: undoes the one bug planted in each kit module.', 'set -eu', "python3 - <<'PY'", 'import json', 'BUGS = json.loads(r"""' + json.dumps([[m, new, old] for f, m, old, new in BUGS]) + '""")',
       'for mod, bad, good in BUGS:', "    p = 'kit/' + mod + '.py'", '    s = open(p).read()', '    assert s.count(bad) == 1, p', '    open(p, "w").write(s.replace(bad, good))', 'PY', '']
open(os.path.join(T, 'reference/apply.sh'), 'w').write('\n'.join(ref)); os.chmod(os.path.join(T, 'reference/apply.sh'), 0o755)

# ---- tests: expressions over a module alias M; expected values computed from the real stdlib ----
import importlib
STD = {'wrap': 'textwrap', 'diffs': 'difflib', 'stats': 'statistics', 'ratio': 'fractions', 'lexer': 'shlex', 'cal': 'calendar', 'netaddr': 'ipaddress', 'config': 'configparser'}
CFG = "[paths]\nhome = /srv\nlogs = ${Home}/logs\n[app]\nData = ${paths:Home}/data\nname = demo\n"
CASES = {
 'wrap': {'pub': ["M.wrap('the quick brown fox jumps over', width=10)", "M.wrap('abcdefghij', width=4)"],
          'hid': ["M.wrap('supercalifragilistic', width=6)", "M.fill('aaaa bbbb cccccccccc', width=5)", "M.wrap('a b c d e f', width=3)", "M.shorten('Hello  world! How are you?', width=12)", "M.wrap('xxxxxxxxxx yy', width=4, break_long_words=True)", "M.dedent('    a\\n      b\\n')"]},
 'diffs': {'pub': ["round(M.SequenceMatcher(None, 'abcd', 'bcde').ratio(), 6)", "list(M.unified_diff(['a\\n','b\\n','c\\n'], ['a\\n','x\\n','c\\n'], lineterm=''))"],
           'hid': ["list(M.unified_diff(['1\\n','2\\n','3\\n','4\\n','5\\n'], ['1\\n','2\\n','three\\n','4\\n','5\\n'], n=1, lineterm=''))", "list(M.unified_diff(['a\\n'], ['b\\n'], lineterm=''))", "list(M.unified_diff([], ['new\\n'], lineterm=''))", "list(M.context_diff(['a\\n','b\\n'], ['a\\n','c\\n'], lineterm=''))", "M.get_close_matches('appel', ['ape', 'apple', 'peach', 'puppy'])", "list(M.ndiff(['one\\n'], ['ore\\n']))"]},
 'stats': {'pub': ["M.median([1, 3, 5, 7])", "M.quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n=4)"],
           'hid': ["M.quantiles([10, 20, 30, 40, 50], n=10)", "M.quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n=4, method='inclusive')", "M.quantiles([2.5, 3.5], n=2)", "round(M.stdev([2, 4, 4, 4, 5, 5, 7, 9]), 9)", "M.mode([1, 1, 2, 3])", "M.variance([1, 2, 3, 4])"]},
 'ratio': {'pub': ["str(M.Fraction(3, 4) + M.Fraction(1, 4))", "[round(M.Fraction(n, 2)) for n in (1, 3, 5, 7)]"],
           'hid': ["[round(M.Fraction(n, 2)) for n in (-5, -3, -1, 9, 11)]", "round(M.Fraction(7, 3))", "str(round(M.Fraction(25, 100), 1))", "str(M.Fraction('3.1415926535897932').limit_denominator(1000))", "str(M.Fraction(1, 3) * 3)", "M.Fraction(5, 2).__floor__()"]},
 'lexer': {'pub': ["M.split('a b  c')", "M.split('say \"hi \\\\\"there\\\\\"\"')"],
           'hid': ["M.split('\"a\\\\\"b\"')", "M.split(\"'a\\\\b'\")", "M.split('x \"y z\" # c', comments=True)", "M.quote(\"it's\")", "M.join(['a b', 'c'])", "M.split('one\\\\ two three')"]},
 'cal': {'pub': ["M.isleap(2024)", "M.monthcalendar(2024, 2)[0]"],
         'hid': ["M.monthcalendar(2023, 10)", "M.Calendar(firstweekday=6).monthdayscalendar(2024, 9)[0]", "M.monthrange(2024, 2)", "list(M.Calendar().itermonthdays(2025, 6))[:8]", "M.leapdays(1900, 2001)", "M.weekday(2026, 10, 2)"]},
 'netaddr': {'pub': ["str(M.ip_network('10.0.0.0/30').broadcast_address)", "[str(n) for n in M.summarize_address_range(M.IPv4Address('192.0.2.0'), M.IPv4Address('192.0.2.130'))]"],
             'hid': ["[str(n) for n in M.summarize_address_range(M.IPv4Address('10.0.0.1'), M.IPv4Address('10.0.0.6'))]", "[str(n) for n in M.summarize_address_range(M.IPv4Address('10.0.0.0'), M.IPv4Address('10.0.0.255'))]", "[str(n) for n in M.summarize_address_range(M.IPv6Address('2001:db8::'), M.IPv6Address('2001:db8::4'))]", "[str(n) for n in M.collapse_addresses([M.ip_network('10.0.0.0/25'), M.ip_network('10.0.0.128/25')])]", "M.ip_address('192.168.1.1').is_private", "[str(s) for s in M.ip_network('10.0.0.0/24').subnets(prefixlen_diff=2)]"]},
 'config': {'pub': ["_cfg(M, basic=True).get('app', 'name')", "_cfg(M).get('paths', 'logs')"],
            'hid': ["_cfg(M).get('app', 'data')", "_cfg(M).get('app', 'Data')", "sorted(_cfg(M).options('app'))", "_cfg(M, basic=True).get('paths', 'logs')", "_cfg2(M).get('s', 'v')", "_cfg2(M).getboolean('s', 'flag')"]},
}
HELPERS = {'config': (
 "CFG = " + repr(CFG) + "\n\n"
 "def _cfg(M, basic=False):\n"
 "    p = M.ConfigParser(interpolation=None if basic else M.ExtendedInterpolation())\n"
 "    p.read_string(CFG)\n"
 "    return p\n\n"
 "def _cfg2(M):\n"
 "    p = M.ConfigParser()\n"
 "    p.read_string('[s]\\nbase = x\\nv = %(base)s-%%\\nflag = on\\n')\n"
 "    return p\n")}
def expected(mod, expr):
    M = importlib.import_module(STD[mod]); g = {'M': M}
    if mod in HELPERS: exec(HELPERS[mod], g)
    return eval(expr, g)
def write_tests(path, mod, exprs, prefix):
    lines = ['import pytest', 'from kit import %s as M' % mod, '']
    if mod in HELPERS: lines.append(HELPERS[mod])
    for i, e in enumerate(exprs, 1):
        exp = expected(mod, e)
        lines += ['', 'def test_%s_%s_%d():' % (prefix, mod, i), '    assert %s == %r' % (e, exp), '']
    open(path, 'w').write('\n'.join(lines))
n_hidden = 0
for mod, c in CASES.items():
    write_tests(os.path.join(T, 'fixture/tests/test_%s.py' % mod), mod, c['pub'], 'public')
    write_tests(os.path.join(T, 'hidden/test_%s_hidden.py' % mod), mod, c['pub'] + c['hid'], 'hidden')
    n_hidden += len(c['pub']) + len(c['hid'])
print('hidden tests:', n_hidden)
open(os.path.join(T, 'fixture/README.md'), 'w').write('# kit\n\nA grab bag of utility modules used across our services: text wrapping (`kit.wrap`), diffs (`kit.diffs`),\nstatistics (`kit.stats`), exact fractions (`kit.ratio`), shell-style lexing (`kit.lexer`), calendars\n(`kit.cal`), IP address handling (`kit.netaddr`) and INI configuration (`kit.config`).\n\nRun the tests with `python3 -m pytest -q tests`.\n')
tsh = open(os.path.join(T, '..', 'project-brownfield-softdelete', 'test.sh')).read()
tsh = tsh.replace('TOTAL=56', 'TOTAL=%d' % n_hidden).replace("whatever the agent (or reference/apply.sh) put under ./invsys.", "whatever the agent (or reference/apply.sh) left under ./kit.")
open(os.path.join(T, 'test.sh'), 'w').write(tsh); os.chmod(os.path.join(T, 'test.sh'), 0o755)
json.dump({
 "name": "project-multifix-vendored", "category": "project", "difficulty": 3,
 "prompt": "Several modules in the `kit` package have regressions: `python3 -m pytest -q tests` fails in more than one place. Each failing module has exactly one bug in its source. Find and fix every bug with the smallest correct change to the module's source; do not edit the tests and do not replace a module wholesale. A larger hidden test suite covering every module will be run afterwards.",
 "timeout_s": 2400, "max_turns": 150, "budget_usd": 12, "tools": "Bash,Read,Edit,Write,MultiEdit,Grep,Glob,Agent"
}, open(os.path.join(T, 'task.json'), 'w'), indent=2)

# ---- fixture files over 30KB are not committed: gen.sh copies the host's own stdlib modules and plants the bugs ----
for f, mod, old, new in BUGS: os.remove(os.path.join(T, 'fixture/kit', mod + '.py'))
gen = ['#!/usr/bin/env bash',
       '# Builds kit/ from this machine\'s own Python standard library (PSF License, see THIRD_PARTY_NOTICES.md):',
       '# eight pure-Python modules copied under new names, each with exactly one bug planted. Patch points were',
       '# checked against CPython 3.11, 3.12 and 3.13; a patch that does not apply stops the build.',
       'set -eu', "python3 - <<'PY'", 'import json, os, sysconfig',
       'BUGS = json.loads(r"""' + json.dumps([[f, m, old, new] for f, m, old, new in BUGS]) + '""")',
       "lib = sysconfig.get_paths()['stdlib']",
       'for src, mod, old, new in BUGS:',
       '    s = open(os.path.join(lib, src), encoding="utf-8").read()',
       '    if s.count(old) != 1:',
       '        raise SystemExit("gen.sh: patch point for %s not found in %s" % (mod, lib))',
       '    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(s.replace(old, new))',
       'PY', '']
open(os.path.join(T, 'fixture/gen.sh'), 'w').write('\n'.join(gen))
print('gen.sh bytes', os.path.getsize(os.path.join(T, 'fixture/gen.sh')))
