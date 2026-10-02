"""Builds the two multifix bench tasks from the running Python's standard library.

  project-multifix-vendored  8 modules, one prompt: fix every failing module
  session-multifix-16        16 modules, one subtask per message in a single long session

Each module is a pure-Python stdlib module copied under a new name with one bug planted in an
internal helper. gen.sh does the copying at run time (nothing from CPython is committed), plants the
bug in the original source, then normalises the module through ast.unparse so a plain diff against
the installed standard library is no help: the r14 trace showed Sonnet 5.5 diffing every module
against /usr/lib/python3.x and finding all eight bugs in one command.

Run with the Python whose results the hidden tests should pin (3.11 for the committed files):
    python3 bench/build_multifix.py
"""
import os, shutil, sys, json, sysconfig
SRC = sysconfig.get_paths()['stdlib']
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tasks')
# (stdlib file, kit module, old, new)
BUGS8 = [
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
BUGS_MORE = [
 ('urllib/parse.py', 'urls', "    if base_parts[-1] != '':\n", "    if base_parts[-1] == '':\n"),
 ('argparse.py', 'cli', "            if action.option_strings:\n                value = action.const\n            else:\n                value = action.default\n", "            if action.option_strings:\n                value = action.default\n            else:\n                value = action.const\n"),
 ('pprint.py', 'pretty', "    return _safe_key(t[0]), _safe_key(t[1])\n", "    return _safe_key(t[1]), _safe_key(t[0])\n"),
 ('plistlib.py', 'plist', "    order = ('year', 'month', 'day', 'hour', 'minute', 'second')\n", "    order = ('year', 'day', 'month', 'hour', 'minute', 'second')\n"),
 ('fnmatch.py', 'globs', "                    if stuff[0] == '!':\n                        stuff = '^' + stuff[1:]\n", "                    if stuff[0] == '!':\n                        stuff = stuff[1:]\n"),
 ('_pydecimal.py', 'dec', "                (prec == 0 or self._int[prec-1] in '02468'):\n", "                (prec == 0 or self._int[prec-1] in '13579'):\n"),
 ('heapq.py', 'heap', "        _heapify(h)\n        while len(h) > 1:\n            try:\n                while True:\n                    value, order, next = s = h[0]\n", "        _heapify(h)\n        while len(h) > 2:\n            try:\n                while True:\n                    value, order, next = s = h[0]\n"),
 ('graphlib.py', 'graph', "                if successor_info.npredecessors == 0:\n", "                if successor_info.npredecessors == 1:\n"),
]

STD = {'wrap': 'textwrap', 'diffs': 'difflib', 'stats': 'statistics', 'ratio': 'fractions', 'lexer': 'shlex', 'cal': 'calendar',
       'netaddr': 'ipaddress', 'config': 'configparser', 'urls': 'urllib.parse', 'cli': 'argparse', 'pretty': 'pprint',
       'plist': 'plistlib', 'globs': 'fnmatch', 'dec': '_pydecimal', 'heap': 'heapq', 'graph': 'graphlib'}

# ---- tests: expressions over a module alias M; expected values computed from the real stdlib ----
import importlib
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
CASES.update({
 'urls': {'pub': ["M.urlparse('http://x.org:8080/p?q=1#f').port", "M.urljoin('http://a/b/c/d;p?q', 'g')"],
          'hid': ["M.urljoin('http://a/b/c/d;p?q', '../g')", "M.urljoin('http://a/b/c/', 'g')", "M.urljoin('http://a/b/c/d', '?y')", "M.urljoin('http://a/b/c/d', '/g')", "M.urljoin('http://a/b', 'c/./d/../e')", "M.parse_qs('a=1&a=2&b=3')", "M.quote('a b/c')", "M.urlencode({'x': 'y z'})"]},
 'cli': {'pub': ["vars(_p(M).parse_args(['x', '--n', '5']))", "_p(M).parse_args(['--level']).level"],
         'hid': ["_p(M).parse_args([]).pos", "_p(M).parse_args(['--level', 'mid']).level", "_p(M).parse_args([]).level", "_p(M).parse_args(['--n', '7']).n", "_p(M).parse_args(['y', '--level']).pos", "_p(M).format_usage()"]},
 'pretty': {'pub': ["M.pformat([1, 2, 3])", "M.pformat({'b': 1, 'a': 2})"],
            'hid': ["M.pformat({'z': 0, 'y': 1, 'x': 2})", "M.pformat({'a': {'d': 1, 'c': 2}})", "M.pformat({'b': 1, 'a': 2}, sort_dicts=False)", "M.pformat(list(range(30)), width=20)", "M.pformat({3: 'a', 1: 'b', 2: 'c'})", "M.pformat({'k': [1, 2], 'j': 'v'}, width=10)"]},
 'plist': {'pub': ["M.loads(M.dumps({'a': 1, 'b': [True, 'x']}))", "M.loads(M.dumps({'d': datetime.datetime(2024, 3, 7, 1, 2, 3)}))['d']"],
           'hid': ["M.loads(M.dumps({'d': datetime.datetime(1999, 12, 31, 23, 59, 58)}))['d']", "M.loads(M.dumps({'d': datetime.datetime(2024, 1, 2)}))['d']", "M.loads(M.dumps({'d': datetime.datetime(2024, 11, 5, 6)}), fmt=M.FMT_XML)['d']", "M.loads(M.dumps({'d': datetime.datetime(2024, 5, 20, 8, 9, 10)}, fmt=M.FMT_BINARY))['d']", "M.loads(M.dumps({'n': 3, 's': 'x'}))", "M.loads(M.dumps([1.5, b'raw']))"]},
 'globs': {'pub': ["M.fnmatch('a.py', '*.py')", "M.fnmatch('b', '[!a]')"],
           'hid': ["M.fnmatch('a', '[!a]')", "M.filter(['x1', 'y2', 'x3'], '[!y]?')", "M.fnmatchcase('Z', '[!a-z]')", "M.fnmatchcase('q', '[!a-z]')", "M.fnmatch('dir/f.txt', '*.txt')", "M.filter(['a.c', 'b.h', 'c.o'], '*.[ch]')"]},
 'dec': {'pub': ["str(M.Decimal('1.1') + M.Decimal('2.2'))", "str(M.Decimal('2.5').quantize(M.Decimal('1')))"],
         'hid': ["str(M.Decimal('3.5').quantize(M.Decimal('1')))", "str(M.Decimal('0.125').quantize(M.Decimal('0.01')))", "str(M.Decimal('-2.5').quantize(M.Decimal('1')))", "str(round(M.Decimal('4.5')))", "str(M.Decimal('2.675').quantize(M.Decimal('0.01'), rounding=M.ROUND_HALF_UP))", "str(M.Decimal(1) / M.Decimal(7))", "str(M.Decimal('7.45').quantize(M.Decimal('0.1')))"]},
 'heap': {'pub': ["M.nsmallest(2, [5, 1, 4])", "list(M.merge([1, 4, 7], [2, 5, 8], [3, 6, 9]))"],
          'hid': ["list(M.merge([1, 3], [2, 4]))", "list(M.merge([], [1], [0, 2]))", "list(M.merge([5, 3, 1], [4, 2], reverse=True))", "list(M.merge(['bb', 'a'], ['ccc'], key=len))", "list(M.merge([1, 2, 3]))", "M.nlargest(3, [4, 9, 1, 7])"]},
 'graph': {'pub': ["list(M.TopologicalSorter({}).static_order())", "list(M.TopologicalSorter({'b': {'a'}}).static_order())"],
           'hid': ["list(M.TopologicalSorter({'c': {'b'}, 'b': {'a'}}).static_order())", "_batches(M, {'d': {'b', 'c'}, 'b': {'a'}, 'c': {'a'}})", "_batches(M, {'b': {'a'}, 'c': {'a'}, 'e': {'d'}})", "_valid(M, {'d': {'b', 'c'}, 'b': {'a'}, 'c': {'a'}, 'e': {'d', 'a'}})", "_cycle(M, {'a': {'b'}, 'b': {'a'}})", "_batches(M, {'x': set()})"]},
})
HELPERS.update({
 'cli': ("def _p(M):\n"
         "    p = M.ArgumentParser(prog='t')\n"
         "    p.add_argument('--level', nargs='?', const='hi', default='lo')\n"
         "    p.add_argument('pos', nargs='?', const='pc', default='pd')\n"
         "    p.add_argument('--n', type=int, default=3)\n"
         "    return p\n"),
 'plist': "import datetime\n",
 'graph': ("def _batches(M, g):\n"
           "    ts = M.TopologicalSorter(g)\n"
           "    ts.prepare()\n"
           "    out = []\n"
           "    while ts.is_active():\n"
           "        ready = sorted(ts.get_ready())\n"
           "        if not ready:\n"
           "            break\n"
           "        out.append(ready)\n"
           "        ts.done(*ready)\n"
           "    return out\n\n"
           "def _valid(M, g):\n"
           "    order = list(M.TopologicalSorter(g).static_order())\n"
           "    nodes = set(g) | set().union(*g.values())\n"
           "    pos = {n: i for i, n in enumerate(order)}\n"
           "    return sorted(order) == sorted(nodes) and all(pos[p] < pos[n] for n in g for p in g[n])\n\n"
           "def _cycle(M, g):\n"
           "    try:\n"
           "        list(M.TopologicalSorter(g).static_order())\n"
           "    except M.CycleError:\n"
           "        return 'cycle'\n"
           "    return 'no cycle'\n"),
})

def expected(mod, expr):
    M = importlib.import_module(STD[mod]); g = {'M': M}
    if mod in HELPERS: exec(HELPERS[mod], g)
    return eval(expr, g)

def write_tests(path, mod, exprs, prefix):
    lines = ['import pytest', 'from kit import %s as M' % mod, '']
    if mod in HELPERS: lines.append(HELPERS[mod])
    for i, e in enumerate(exprs, 1):
        lines += ['', 'def test_%s_%s_%d():' % (prefix, mod, i), '    assert %s == %r' % (e, expected(mod, e)), '']
    open(path, 'w').write('\n'.join(lines))

NO_REFERENCE = ('These modules have no reference copy: find each bug from the failing tests and the code, and do not diff '
                'against, copy from or import the standard library or any installed package to locate or replace it.')
# Each subtask also asks for a read-through of the rest of the module, as a real "fix it and check for the same mistake
# elsewhere" request would: without it Sonnet 5.5 greps to the bug and reads a few dozen lines, and sixteen subtasks add
# ~60k tokens to a session, far short of what makes a real long session compact.
SUBTASK = ('Subtask {k} of {n}: `python3 -m pytest -q tests/test_{mod}.py` fails. Find and fix the bug in `kit/{mod}.py` with '
           'the smallest correct change to its source; do not edit the tests. Then read through the rest of `kit/{mod}.py` '
           'and check whether the same kind of mistake appears anywhere else in it; fix any you find, and say in one or two '
           'lines what you checked. ' + NO_REFERENCE)

def gen_script(bugs):
    return '\n'.join([
        '#!/usr/bin/env bash',
        "# Builds kit/ from this machine's own Python standard library (PSF License, see THIRD_PARTY_NOTICES.md):",
        '# pure-Python modules copied under new names, one bug planted in each, then normalised through ast.unparse',
        '# so that diffing against the installed standard library does not locate the bug. Patch points were checked',
        '# against CPython 3.11, 3.12 and 3.13; a patch that does not apply stops the build. Generated by',
        '# bench/build_multifix.py.',
        'set -eu', "python3 - <<'PY'", 'import ast, json, os, sysconfig',
        'BUGS = json.loads(r"""' + json.dumps([[f, m, old, new] for f, m, old, new in bugs]) + '""")',
        "lib = sysconfig.get_paths()['stdlib']",
        'for src, mod, old, new in BUGS:',
        '    s = open(os.path.join(lib, src), encoding="utf-8").read()',
        '    if s.count(old) != 1:',
        '        raise SystemExit("gen.sh: patch point for %s not found in %s" % (mod, lib))',
        '    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(ast.unparse(ast.parse(s.replace(old, new))) + "\\n")',
        'PY', ''])

def reference_script(name, bugs):
    return '\n'.join([
        '#!/usr/bin/env bash',
        '# Reference fix for %s: rewrites each kit module from the same stdlib source without the planted bug,' % name,
        '# normalised exactly as gen.sh normalises it, so the only difference from the broken copy is the bug.',
        'set -eu', "python3 - <<'PY'", 'import ast, json, os, sysconfig',
        'MODS = json.loads(r"""' + json.dumps([[f, m] for f, m, old, new in bugs]) + '""")',
        "lib = sysconfig.get_paths()['stdlib']",
        'for src, mod in MODS:',
        '    s = open(os.path.join(lib, src), encoding="utf-8").read()',
        '    open(os.path.join("kit", mod + ".py"), "w", encoding="utf-8").write(ast.unparse(ast.parse(s)) + "\\n")',
        'PY', ''])

def build(name, bugs, prompt, session=None):
    T = os.path.join(ROOT, name)
    for d in ('fixture', 'hidden', 'reference'):
        if os.path.exists(os.path.join(T, d)): shutil.rmtree(os.path.join(T, d))
    for d in ('fixture/kit', 'fixture/tests', 'hidden', 'reference'): os.makedirs(os.path.join(T, d))
    open(os.path.join(T, 'fixture/kit/__init__.py'), 'w').write('"""kit: a grab bag of utility modules."""\n')
    lib = SRC
    for f, mod, old, new in bugs:
        assert open(os.path.join(lib, f)).read().count(old) == 1, (f, mod)
    n_hidden = 0
    for f, mod, old, new in bugs:
        c = CASES[mod]
        write_tests(os.path.join(T, 'fixture/tests/test_%s.py' % mod), mod, c['pub'], 'public')
        write_tests(os.path.join(T, 'hidden/test_%s_hidden.py' % mod), mod, c['pub'] + c['hid'], 'hidden')
        n_hidden += len(c['pub']) + len(c['hid'])
    mods = ', '.join('`kit.%s`' % m for f, m, o, n in bugs)
    open(os.path.join(T, 'fixture/README.md'), 'w').write('# kit\n\nA grab bag of utility modules used across our services: %s.\n\nRun the tests with `python3 -m pytest -q tests`.\n' % mods)
    for fn, text in (('fixture/gen.sh', gen_script(bugs)), ('reference/apply.sh', reference_script(name, bugs))):
        open(os.path.join(T, fn), 'w').write(text); os.chmod(os.path.join(T, fn), 0o755)
    tsh = open(os.path.join(ROOT, 'project-brownfield-softdelete', 'test.sh')).read()
    tsh = tsh.replace('TOTAL=56', 'TOTAL=%d' % n_hidden).replace("whatever the agent (or reference/apply.sh) put under ./invsys.", "whatever the agent (or reference/apply.sh) left under ./kit.")
    open(os.path.join(T, 'test.sh'), 'w').write(tsh); os.chmod(os.path.join(T, 'test.sh'), 0o755)
    task = {"name": name, "category": "session" if session else "project", "difficulty": 3, "prompt": prompt,
            "timeout_s": 5400 if session else 2400, "max_turns": 400 if session else 150, "budget_usd": 30 if session else 12,
            "tools": "Bash,Read,Edit,Write,MultiEdit,Grep,Glob,Agent"}
    if session: task["session"] = session
    json.dump(task, open(os.path.join(T, 'task.json'), 'w'), indent=2); open(os.path.join(T, 'task.json'), 'a').write('\n')
    print(name, 'modules', len(bugs), 'hidden tests', n_hidden)

build('project-multifix-vendored', BUGS8,
      'Several modules in the `kit` package have regressions: `python3 -m pytest -q tests` fails in more than one place. '
      'Each failing module has exactly one bug in its source. Find and fix every bug with the smallest correct change to the '
      "module's source; do not edit the tests and do not replace a module wholesale. " + NO_REFERENCE +
      ' A larger hidden test suite covering every module will be run afterwards.')

# Interleave large and small modules so context grows unevenly, as it does in a real session.
ORDER16 = ['wrap', 'dec', 'diffs', 'urls', 'stats', 'cli', 'ratio', 'pretty', 'lexer', 'plist', 'cal', 'globs', 'netaddr', 'heap', 'config', 'graph']
BY_MOD = {b[1]: b for b in BUGS8 + BUGS_MORE}
B16 = [BY_MOD[m] for m in ORDER16]
build('session-multifix-16', B16,
      'Sixteen modules in the `kit` package have regressions; `python3 -m pytest -q tests` fails in each of them. Each has '
      "exactly one bug in its source. Fix every bug with the smallest correct change to the module's source; do not edit the "
      'tests. ' + NO_REFERENCE,
      session=[SUBTASK.format(k=i + 1, n=len(B16), mod=b[1]) for i, b in enumerate(B16)])
