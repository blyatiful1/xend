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

test('progress bars and spinner lines are removed, blank runs collapsed', () => {
  const r = s.cleanup('start\n[=====>     ] 45%\n⠋\n\n\n\nend\n');
  assert.strictEqual(r.text, 'start\n\nend\n');
  assert.strictEqual(r.removedProgress, 2);
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
