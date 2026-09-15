'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('outline: Python file with decorator, function, and class', () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-outline-'));
  const pyFile = path.join(tmpdir, 'test.py');
  fs.writeFileSync(pyFile, 'def alpha():\n    pass\nclass Beta:\n    pass\n');
  const result = spawnSync('node', [path.join(__dirname, '../scripts/xend-cli.js'), 'outline', pyFile], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('L1: def alpha():'), result.stdout);
  assert.ok(result.stdout.includes('L3: class Beta:'), result.stdout);
  assert.ok(result.stdout.includes('(heuristic outline:'), result.stdout);
});

test('outline: unsupported file extension returns proper message and exit code 0', () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-outline-'));
  const xyzFile = path.join(tmpdir, 'test.xyz');
  fs.writeFileSync(xyzFile, 'some content');
  const result = spawnSync('node', [path.join(__dirname, '../scripts/xend-cli.js'), 'outline', xyzFile], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('no outline available for'), result.stdout);
  assert.ok(result.stdout.includes('unsupported extension'), result.stdout);
  assert.ok(result.stdout.includes('Grep for the symbol instead'), result.stdout);
});

test('outline: missing file returns exit code 1', () => {
  const result = spawnSync('node', [path.join(__dirname, '../scripts/xend-cli.js'), 'outline', '/nonexistent/file.py'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 1, result.stderr);
  assert.ok(result.stdout.includes('outline: cannot read'), result.stdout);
});
