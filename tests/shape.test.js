'use strict';
const test = require('node:test');
const assert = require('node:assert');
const s = require('../scripts/lib/shape.js');

const CFG = { stripAnsi: true, collapseRepeats: true, testRunners: true, packageManagers: true, jsonMinify: true, maxChars: 8000, headRatio: 0.6 };

test('stripAnsi removes color codes and OSC sequences', () => {
  assert.strictEqual(s.stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07x'), 'red x');
});

test('carriage-return progress keeps the last frame', () => {
  assert.strictEqual(s.collapseCarriageReturns('10%\r50%\r100% done\nnext'), '100% done\nnext');
});

test('progress bars and spinner lines are removed, runs of blank lines kept to two', () => {
  const r = s.cleanup('start\n[=====>     ] 45%\n⠋\n\n\n\nend\n');
  assert.strictEqual(r.text, 'start\n\n\nend\n');
  assert.strictEqual(r.removedProgress, 2);
});

test('cleanup leaves whitespace alone: trailing spaces, two blank lines between defs, diffs byte for byte', () => {
  const py = 'def a():  \n    return 1\n\n\ndef b():\n    return 2\n';
  assert.strictEqual(s.cleanup(py).text, py, 'cat output must still match the file for an Edit');
  const diff = 'diff --git a/x b/x\n@@ -1,4 +1,4 @@\n \n-foo  \n+foo\r\n \n \n \n \n';
  assert.strictEqual(s.cleanup('\x1b[32m' + diff + '\x1b[0m', { kind: 'diff' }).text, diff);
  const t = 'E   - abc \nE   + abc\n\n\n\nFAILED';
  assert.strictEqual(s.cleanup(t, { kind: 'test' }).text, t, 'an assertion diff can hinge on whitespace');
});

test('detectKind: grep, rg and git grep are searches, also after a pipe or &&', () => {
  for (const c of ['grep -rn foo src', 'rg -n TODO', 'git grep -n x', 'cd a && grep -n x f', 'cat f | grep -i warn', 'find . -name "*.py" | xargs grep -n foo']) {
    assert.strictEqual(s.detectKind(c, 'a:1:x'), 'search', c);
  }
  assert.strictEqual(s.detectKind('npm test | grep FAIL', ''), 'test');
  assert.strictEqual(s.detectKind('echo grepping', ''), 'generic');
});

test('mergeSearchHits lists every line number of a repeated hit and keeps the rest as is', () => {
  const text = ['m/a.py:1:from m.fmt import fmt_money', 'm/a.py:5:    return fmt_money(x)', 'm/a.py:9:    return fmt_money(x)', 'm/b.py:5:    return fmt_money(x)', 'm/a.py:13:    return fmt_money(x)'].join('\n');
  const r = s.mergeSearchHits(text);
  assert.strictEqual(r.merged, 2);
  assert.strictEqual(r.text, ['m/a.py:1:from m.fmt import fmt_money', 'm/a.py:5,9,13:    return fmt_money(x)', 'm/b.py:5:    return fmt_money(x)'].join('\n'));
  const single = s.mergeSearchHits('12:foo\n40:foo\n41:bar');
  assert.strictEqual(single.text, '12,40:foo\n41:bar');
  // a log that starts with a time is not grep -n output: nothing is merged
  const times = '12:30:45 ERROR db timeout\n12:31:45 ERROR db timeout\n12:31:45 ERROR db timeout\n13:02:10 WARN slow';
  assert.strictEqual(s.mergeSearchHits(times).merged, 0);
  assert.strictEqual(s.mergeSearchHits('app.log:12:30:45 ERROR x\napp.log:12:31:45 ERROR x').merged, 0);
});

function logLines(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ts = '2026-09-10T02:' + String(Math.floor(i / 60) % 60).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + 'Z';
    out.push((i * 8 + 5) + ':' + ts + ' WARN  orders-api: slow query for order ' + (10065 + i * 104) + ' (' + (i * 56 % 240) + 'ms)');
    if (i === Math.floor(n * 0.6)) {
      out.push((i * 8 + 6) + ':' + ts + ' ERROR orders-api: database connection timed out after 5.02s (configured timeout_seconds=5)');
      out.push((i * 8 + 7) + ':' + ts + ' ERROR orders-api: runbook RB-402: primary DB pool requires timeout_seconds >= 30; current value (5) is far too low');
    }
  }
  return out.join('\n');
}

test('collapseSimilar folds a log to one line per message and keeps the rare ones', () => {
  const r = s.collapseSimilar(logLines(500), 'search');
  assert.ok(r.removed > 450);
  assert.match(r.text, /timeout_seconds >= 30/);
  assert.match(r.text, /timed out after 5\.02s/);
  assert.match(r.text, /\[xend: 498 more lines like this one/);
  const kept = r.text.split('\n');
  assert.match(kept[kept.length - 1], /order 61961/, 'the last of the folded lines is kept');
});

test('collapseSimilar leaves source code and number tables alone', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['scripts/lib/verify.js', 'scripts/lib/shape.js', 'bench/run.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.strictEqual(s.collapseSimilar(src, 'generic').removed, 0, f);
  }
  const data = Array.from({ length: 300 }, (_, i) => i + ',' + (i * 3) + ',' + (i * 7 % 13)).join('\n');
  assert.strictEqual(s.collapseSimilar(data, 'generic').removed, 0, 'rows of numbers are data');
});

test('headTail with rescue keeps the error lines from the omitted middle and says so', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => 'INFO step ' + i + ' ' + 'x'.repeat(20));
  lines[1000] = 'ERROR the one line the model came for';
  const r = s.headTail(lines.join('\n'), 4000, 0.6, 'generic', { rescue: true });
  assert.match(r.text, /ERROR the one line the model came for/);
  assert.strictEqual(r.rescued, 1);
  assert.match(r.text, /the 1 error line among them is kept below/);
  assert.strictEqual(s.headTail(lines.join('\n'), 4000, 0.6, 'generic').rescued, 0, 'no rescue unless asked');
});

test('shapeBashText on a long grep of a log keeps the needle and reports itself lossy', () => {
  const cfg = Object.assign({}, CFG, { maxChars: 12000 });
  const r = s.shapeBashText(logLines(500), 'search', cfg, "grep -n -i -E 'warn|error' logs/app.log");
  assert.match(r.text, /timeout_seconds >= 30/);
  assert.ok(r.after < 2000, 'folded to a few lines: ' + r.after);
  assert.strictEqual(r.lossy, true);
  assert.ok(r.kinds.some((k) => k.startsWith('similar:')));
});

test('shapeBashText on many identical call-site hits merges them losslessly', () => {
  const hits = [];
  for (let f = 0; f < 12; f++) {
    hits.push('moneymod/mod_' + String(f).padStart(2, '0') + '.py:1:from moneymod.fmt import fmt_money');
    for (let l = 5; l < 100; l += 4) hits.push('moneymod/mod_' + String(f).padStart(2, '0') + '.py:' + l + ':    return fmt_money(amount)');
  }
  const cfg = Object.assign({}, CFG, { maxChars: 12000 });
  const r = s.shapeBashText(hits.join('\n'), 'search', cfg, 'grep -rn fmt_money moneymod');
  assert.strictEqual(r.lossy, false);
  assert.deepStrictEqual(r.kinds, ['merged:' + (hits.length - 24)]);
  for (let f = 0; f < 12; f++) assert.match(r.text, new RegExp('mod_' + String(f).padStart(2, '0') + '\\.py:5,9,13,.*,97:    return fmt_money'));
});

test('consecutive identical lines are collapsed with a note', () => {
  const r = s.collapseRepeats('a\nwarn x\nwarn x\nwarn x\nwarn x\nb');
  assert.strictEqual(r.text, 'a\nwarn x\n  (previous line repeated 4 times)\nb');
  assert.strictEqual(r.removed, 3);
  const two = s.collapseRepeats('x\nx\ny');
  assert.strictEqual(two.text, 'x\nx\ny');
});

test('detectKind classifies commands and outputs', () => {
  assert.strictEqual(s.detectKind('python3 -m pytest -q', ''), 'test');
  assert.strictEqual(s.detectKind('npm test', ''), 'test');
  assert.strictEqual(s.detectKind('go test ./...', ''), 'test');
  assert.strictEqual(s.detectKind('npm install', ''), 'pkg');
  assert.strictEqual(s.detectKind('pip install -r requirements.txt', ''), 'pkg');
  assert.strictEqual(s.detectKind('git diff HEAD~1', ''), 'diff');
  assert.strictEqual(s.detectKind('git log --oneline', ''), 'generic');
  assert.strictEqual(s.detectKind('curl x', '{"a": 1, "b": [1,2]}'), 'json');
  assert.strictEqual(s.detectKind('ls', 'files'), 'generic');
  assert.strictEqual(s.detectKind('./run.sh', 'Tests:       3 passed, 3 total\n'), 'test');
});

test('pytest output: passing rows removed, failures and summary kept verbatim', () => {
  const out = [
    '============================= test session starts ==============================',
    'platform linux -- Python 3.11.15, pytest-8.0.0',
    'rootdir: /tmp/x',
    'collected 120 items',
    '',
    'tests/test_a.py ........................................................ [ 50%]',
    'tests/test_b.py ...........................F.....................F....... [100%]',
    '',
    '=================================== FAILURES ===================================',
    '__________________________ test_parse_negative_amount __________________________',
    '',
    '    def test_parse_negative_amount():',
    '>       assert parse("-5") == -5',
    'E       assert 5 == -5',
    '',
    'tests/test_b.py:41: AssertionError',
    '=========================== short test summary info ============================',
    'FAILED tests/test_b.py::test_parse_negative_amount - assert 5 == -5',
    'FAILED tests/test_b.py::test_other - KeyError',
    '========================= 2 failed, 118 passed in 0.42s ========================',
  ].join('\n');
  const r = s.shapeTestOutput(out, 0);
  assert.ok(r.removed >= 2);
  assert.ok(r.text.includes('E       assert 5 == -5'));
  assert.ok(r.text.includes('2 failed, 118 passed'));
  assert.ok(r.text.includes('FAILED tests/test_b.py::test_other - KeyError'));
  assert.ok(!r.text.includes('[ 50%]'));
  assert.ok(!r.text.includes('rootdir:'));
});

test('jest output: PASS/check lines removed, failure block kept', () => {
  const out = 'PASS src/a.test.js\n  ✓ adds (2 ms)\n  ✓ subtracts\nFAIL src/b.test.js\n  ✕ divides (3 ms)\n\n  ● divides\n\n    expect(received).toBe(expected)\n\n    Expected: 2\n    Received: 0\n\nTests:       1 failed, 2 passed, 3 total\n';
  const r = s.shapeTestOutput(out, 0);
  assert.ok(!r.text.includes('✓ adds'));
  assert.ok(!r.text.includes('PASS src/a.test.js'));
  assert.ok(r.text.includes('✕ divides'));
  assert.ok(r.text.includes('Received: 0'));
  assert.ok(r.text.includes('Tests:       1 failed'));
});

test('go test output: RUN/PASS rows removed, FAIL and package lines kept', () => {
  const out = '=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n    b_test.go:12: expected 2 got 3\n--- FAIL: TestB (0.00s)\nFAIL\nFAIL\tpkg/x\t0.012s\nok  \tpkg/y\t0.010s\n';
  const r = s.shapeTestOutput(out, 0);
  assert.ok(!r.text.includes('=== RUN'));
  assert.ok(!r.text.includes('--- PASS'));
  assert.ok(r.text.includes('--- FAIL: TestB'));
  assert.ok(r.text.includes('expected 2 got 3'));
  assert.ok(r.text.includes('ok  \tpkg/y'));
});

test('cargo test output keeps failures and result line', () => {
  const out = 'running 3 tests\ntest a ... ok\ntest b ... ok\ntest c ... FAILED\n\nfailures:\n\n---- c stdout ----\nthread panicked at x\n\ntest result: FAILED. 2 passed; 1 failed\n';
  const r = s.shapeTestOutput(out, 0);
  assert.ok(!r.text.includes('test a ... ok'));
  assert.ok(r.text.includes('test c ... FAILED'));
  assert.ok(r.text.includes('thread panicked'));
  assert.ok(r.text.includes('test result: FAILED'));
});

test('package-manager chatter removed, warnings kept', () => {
  const out = 'Collecting requests\n  Downloading requests-2.31.0-py3-none-any.whl (62 kB)\nRequirement already satisfied: urllib3\nWARNING: pip is being invoked by an old script wrapper\nInstalling collected packages: requests\nSuccessfully installed requests-2.31.0\n';
  const r = s.shapePkgOutput(out);
  assert.ok(r.text.includes('WARNING: pip'));
  assert.ok(r.text.includes('Successfully installed'));
  assert.ok(r.text.includes('Installing collected packages'));
  assert.ok(!r.text.includes('Downloading requests'));
  assert.strictEqual(r.removed, 3);
});

test('json minify only when it saves enough', () => {
  const pretty = JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ id: i, name: 'item ' + i, tags: ['a', 'b'] })) }, null, 2);
  const r = s.jsonMinify(pretty);
  assert.ok(r.changed);
  assert.ok(r.text.length < pretty.length * 0.7);
  assert.strictEqual(s.jsonMinify('{"a":1}').changed, false);
});

test('headTail keeps head and tail within budget and reports omissions', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(20));
  const text = lines.join('\n');
  const r = s.headTail(text, 4000, 0.6, 'generic');
  assert.ok(r.text.length <= 4000 + 200);
  assert.ok(r.text.startsWith('line 0 '));
  assert.ok(r.text.endsWith('line 1999 ' + 'x'.repeat(20)));
  assert.ok(r.text.includes('[xend: '));
  assert.ok(r.omittedLines > 1500);
  const small = s.headTail('short', 4000, 0.6, 'generic');
  assert.strictEqual(small.omittedLines, 0);
});

test('headTail on a diff snaps cuts to file boundaries', () => {
  const files = [];
  for (let f = 0; f < 30; f++) {
    files.push('diff --git a/f' + f + '.js b/f' + f + '.js');
    for (let l = 0; l < 20; l++) files.push((l % 2 ? '+' : '-') + ' change ' + f + ' ' + l + ' ' + 'y'.repeat(30));
  }
  const text = files.join('\n');
  const r = s.headTail(text, 6000, 0.6, 'diff');
  const kept = r.text.split('\n');
  const markerIdx = kept.findIndex((l) => l.startsWith('... [xend:'));
  assert.ok(markerIdx > 0);
  assert.ok(kept[markerIdx + 1].startsWith('diff --git'), 'tail resumes at a file boundary: ' + kept[markerIdx + 1]);
});

test('outline extracts definitions with line numbers for python and js', () => {
  const py = 'import os\n\nclass Foo:\n    def bar(self):\n        pass\n\nasync def baz():\n    pass\n';
  assert.deepStrictEqual(s.outline(py, 'a.py'), ['L3: class Foo:', 'L4: def bar(self):', 'L7: async def baz():']);
  const js = 'const x = 1;\nexport function a() {}\nclass B {\n  method(arg) {\n  }\n}\nconst c = async () => {};\n';
  const o = s.outline(js, 'a.ts');
  assert.ok(o.includes('L2: export function a() {}'));
  assert.ok(o.includes('L3: class B {'));
  assert.ok(o.includes('L4: method(arg) {'));
  assert.ok(o.includes('L7: const c = async () => {};'));
  assert.strictEqual(s.outline('x', 'a.bin'), null);
});

test('shapeBashText end-to-end keeps errors and reports kinds', () => {
  const noisy = '\x1b[32mok\x1b[0m\n' + Array.from({ length: 50 }, () => 'warn: same').join('\n') + '\nError: boom\n';
  const r = s.shapeBashText(noisy, 'generic', CFG);
  assert.ok(r.changed);
  assert.ok(r.text.includes('Error: boom'));
  assert.ok(r.text.includes('repeated 50 times'));
  assert.ok(r.kinds.includes('repeats'));
  const clean = s.shapeBashText('hello\n', 'generic', CFG);
  assert.strictEqual(clean.changed, false);
});

test('node --test: passing tests and their detail blocks drop, a failure keeps its block', () => {
  assert.strictEqual(s.detectKind('node --test tests/', ''), 'test');
  const pass = (n) => '# Subtest: t' + n + '\nok ' + n + ' - t' + n + '\n  ---\n  duration_ms: 1.5\n  type: \'test\'\n  ...';
  const fail = '# Subtest: bad\nnot ok 99 - bad\n  ---\n  duration_ms: 3.1\n  type: \'test\'\n  location: \'/x/t.js:5:1\'\n  error: \'boom\'\n  ...';
  const text = 'TAP version 13\n' + Array.from({ length: 30 }, (_, i) => pass(i + 1)).join('\n') + '\n' + fail + '\n1..31\n# pass 30\n# fail 1\n';
  const r = s.shapeTestOutput(text);
  assert.doesNotMatch(r.text, /ok 1 - t1|# Subtest: t1/);
  assert.match(r.text, /not ok 99 - bad\n  ---\n  location: '\/x\/t\.js:5:1'\n  error: 'boom'\n  \.\.\./);
  assert.match(r.text, /# pass 30\n# fail 1/);
});

test('a line of dashes is content (a YAML separator, a rule), not a spinner frame', () => {
  assert.strictEqual(s.cleanup('---\nkey: 1\n---\nx: 2\n').text, '---\nkey: 1\n---\nx: 2\n');
  assert.strictEqual(s.cleanup('a\n-\n|\n⠋⠙\nb').text, 'a\nb');
});
