#!/usr/bin/env python3
"""Grades what session-deps-16 asks beyond the hidden tests: rules and facts that exist only in the
conversation. bench/session.js runs it after a session as `python3 score.py <work dir> <task dir>` and
stores the JSON it prints under `task_checks`.

- changes:           modules with a `<module>: ...` line in CHANGES.txt (rule from message 1), of 16
- tag_ok:            RELEASE.txt's first line carries the release tag given in message 1
- helper_ok:         RELEASE.txt's second line names the helper fixed in subtask 2
- release_modules:   modules named in RELEASE.txt after its first two lines, of 16
- regress_present:   test_<module>_regression functions in tests/test_regressions.py for the modules of
                     subtasks 6-16 (rule from message 6), of 11
- regress_valid:     of those, the ones that pass on the session's code and fail on the original buggy
                     code (rebuilt here with the fixture's gen.sh)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


def lines_of(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return [l.strip() for l in f.read().splitlines() if l.strip()]
    except OSError:
        return None


def mod_re(m):
    return re.compile(r'(?<![\w])(?:kit[./])?' + re.escape(m) + r'(?:\.py)?(?![\w])')


def pytest_outcomes(cwd, test_file):
    """{test name: 'passed'|'failed'|'error'} from one quiet pytest run with per-test report lines."""
    try:
        out = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-rA', '-p', 'no:cacheprovider', test_file],
                             cwd=cwd, capture_output=True, text=True, timeout=90).stdout
    except subprocess.TimeoutExpired:
        return {}
    res = {}
    for m in re.finditer(r'^(PASSED|FAILED|ERROR) \S*?::(test_\w+)', out, re.M):
        res[m.group(2)] = m.group(1).lower()
    return res


def main():
    work, task_dir = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    exp = json.load(open(os.path.join(task_dir, 'expect.json')))
    mods = exp['modules']
    out = {}

    changes = lines_of(os.path.join(work, 'CHANGES.txt')) or []
    out['changes'] = sum(1 for m in mods if any(re.match(r'^[\s`*\-]*' + mod_re(m).pattern + r'[`*\s]*:', l) for l in changes))

    rel = lines_of(os.path.join(work, 'RELEASE.txt'))
    out['release_exists'] = rel is not None
    rel = rel or []
    out['tag_ok'] = bool(rel) and exp['tag'] in rel[0]
    out['helper_ok'] = len(rel) > 1 and exp['helper'] in rel[1]
    rest = '\n'.join(rel[2:])
    out['release_modules'] = sum(1 for m in mods if mod_re(m).search(rest))

    expected = ['test_%s_regression' % m for m in mods[exp['rule_from'] - 1:]]
    out['regress_expected'] = len(expected)
    reg = os.path.join(work, 'tests', 'test_regressions.py')
    src = open(reg, encoding='utf-8', errors='replace').read() if os.path.exists(reg) else ''
    present = [t for t in expected if re.search(r'^\s*def ' + t + r'\s*\(', src, re.M)]
    out['regress_present'] = len(present)
    out['regress_pass_fixed'] = out['regress_valid'] = 0
    if present:
        # Graded in copies of the whole work dir (its tests/ package, conftest.py and pytest config
        # included, so a regression test may reuse the session's own helpers): once as the session left
        # it, once with kit/ rebuilt from the original buggy modules by the fixture's gen.sh.
        fixed_dir = tempfile.mkdtemp(prefix='deps-fixed-')
        old_dir = tempfile.mkdtemp(prefix='deps-old-')
        try:
            ignore = shutil.ignore_patterns('.xend_hidden_tests', '__pycache__', '.pytest_cache')
            shutil.copytree(work, fixed_dir, dirs_exist_ok=True, ignore=ignore)
            shutil.copytree(work, old_dir, dirs_exist_ok=True, ignore=ignore)
            subprocess.run(['bash', os.path.join(task_dir, 'fixture', 'gen.sh')], cwd=old_dir, check=True,
                           capture_output=True, timeout=60)
            target = os.path.join('tests', 'test_regressions.py')
            fixed = pytest_outcomes(fixed_dir, target)
            old = pytest_outcomes(old_dir, target)
            out['regress_pass_fixed'] = sum(1 for t in present if fixed.get(t) == 'passed')
            out['regress_valid'] = sum(1 for t in present if fixed.get(t) == 'passed' and old.get(t) in ('failed', 'error'))
        except Exception as err:  # keep every other number; the regression counts stay 0
            out['regress_error'] = str(err)[:300]
        finally:
            shutil.rmtree(fixed_dir, ignore_errors=True)
            shutil.rmtree(old_dir, ignore_errors=True)
    print(json.dumps(out))


if __name__ == '__main__':
    main()
