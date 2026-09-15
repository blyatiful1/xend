'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const doctor = require('../scripts/doctor.js');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('normalizeParagraph: whitespace/case are collapsed for comparison', () => {
  const a = doctor.normalizeParagraph('Some   Text\nWith    weird\t\tspacing');
  const b = doctor.normalizeParagraph('some text with weird spacing');
  assert.equal(a, b);
});

test('splitParagraphs: splits on blank lines and trims', () => {
  const paras = doctor.splitParagraphs('first paragraph\nstill first\n\nsecond paragraph\n\n\nthird');
  assert.deepEqual(paras, ['first paragraph\nstill first', 'second paragraph', 'third']);
});

test('checkMemoryFiles: flags a near-duplicate paragraph (>=200 chars) repeated across 2+ files', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-dup-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    const longParagraph =
      'This exact same block of guidance is duplicated across two different memory files on ' +
      'purpose so the near-duplicate detector has something long enough (over two hundred ' +
      'characters once normalized) to actually flag in this test case here.';
    assert.ok(longParagraph.length >= 200);

    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# root\n\n${longParagraph}\n`);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), `# nested\n\n${longParagraph.toUpperCase()}\n`);

    const findings = doctor.checkMemoryFiles(dir);
    const dup = findings.find((f) => /near-duplicate/i.test(f.title));
    assert.ok(dup, 'expected a near-duplicate paragraph finding');
    assert.equal(dup.impact, 'medium');
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkMemoryFiles: does NOT flag short repeated text (<200 chars) as a duplicate', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-shortdup-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# root\n\nShort shared line.\n');
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), '# nested\n\nShort shared line.\n');

    const findings = doctor.checkMemoryFiles(dir);
    const dup = findings.find((f) => /near-duplicate/i.test(f.title));
    assert.equal(dup, undefined);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkMemoryFiles: flags a single file over 200 lines', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-long-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    const bigContent = Array.from({ length: 250 }, (_, i) => `- line ${i}`).join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), bigContent);

    const findings = doctor.checkMemoryFiles(dir);
    const oversized = findings.find((f) => /over 200 lines/i.test(f.title));
    assert.ok(oversized);
    assert.equal(oversized.impact, 'medium');
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkMemoryFiles: flags total memory budget over 4000 est tokens', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-budget-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    // ~20000 bytes / 3.8 chars-per-token ≈ 5263 est tokens, over the 4000 budget.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'x'.repeat(20000));

    const findings = doctor.checkMemoryFiles(dir);
    const budget = findings.find((f) => /Total memory is/i.test(f.title));
    assert.ok(budget);
    assert.equal(budget.impact, 'large');
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkMemoryFiles: does NOT flag total budget under 4000 est tokens', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-smallbudget-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'short and fine\n');

    const findings = doctor.checkMemoryFiles(dir);
    const budget = findings.find((f) => /Total memory is/i.test(f.title));
    assert.equal(budget, undefined);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkMemoryFiles: flags dates/"today" only when the file looks auto-generated', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-cachebreak-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# hand-written notes\n\nLast touched 2026-01-01, not auto anything.\n');
    const findingsNormal = doctor.checkMemoryFiles(dir);
    assert.equal(findingsNormal.find((f) => /auto-generated/i.test(f.title)), undefined);

    fs.rmSync(path.join(dir, 'CLAUDE.md'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# generated notes\n\nauto-updated 2026-01-01\nsome other content today\n');
    const findingsGen = doctor.checkMemoryFiles(dir);
    const cacheBreaker = findingsGen.find((f) => /auto-generated/i.test(f.title));
    assert.ok(cacheBreaker);
    assert.equal(cacheBreaker.impact, 'medium');
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkSettings: flags toolSearchEnabled:false as a large finding', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-settings-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ toolSearchEnabled: false }));

    const { findings } = doctor.checkSettings(dir);
    const f = findings.find((x) => /toolSearchEnabled is explicitly false/i.test(x.title));
    assert.ok(f);
    assert.equal(f.impact, 'large');
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkSettings: flags a hook command containing $(date) as a cache-breaker', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-hooks-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo "$(date)"' }] }] } })
    );

    const { findings } = doctor.checkSettings(dir);
    const f = findings.find((x) => /call `date`/i.test(x.title));
    assert.ok(f);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkSettings: flags CLAUDE_CODE_SUBAGENT_MODEL set via settings env', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-subagentmodel-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' } })
    );

    const { findings } = doctor.checkSettings(dir);
    const f = findings.find((x) => /CLAUDE_CODE_SUBAGENT_MODEL overrides/i.test(x.title));
    assert.ok(f);
    assert.equal(f.impact, 'medium');
    assert.match(f.found, /opus/);
    assert.match(f.found, /settings\.json env/);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkSettings: flags CLAUDE_CODE_SUBAGENT_MODEL set via process.env', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-subagentmodel-env-');
  const origHome = os.homedir;
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_CODE_SUBAGENT_MODEL');
  const origEnv = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  try {
    os.homedir = () => home;
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku';

    const { findings } = doctor.checkSettings(dir);
    const f = findings.find((x) => /CLAUDE_CODE_SUBAGENT_MODEL overrides/i.test(x.title));
    assert.ok(f);
    assert.match(f.found, /haiku/);
    assert.match(f.found, /process environment/);
  } finally {
    os.homedir = origHome;
    if (hadEnv) process.env.CLAUDE_CODE_SUBAGENT_MODEL = origEnv;
    else delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkSettings: does NOT flag CLAUDE_CODE_SUBAGENT_MODEL when unset', () => {
  const home = mkTmpDir('xend-doc-home-');
  const dir = mkTmpDir('xend-doc-subagentmodel-unset-');
  const origHome = os.homedir;
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_CODE_SUBAGENT_MODEL');
  const origEnv = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  try {
    os.homedir = () => home;
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;

    const { findings } = doctor.checkSettings(dir);
    const f = findings.find((x) => /CLAUDE_CODE_SUBAGENT_MODEL overrides/i.test(x.title));
    assert.equal(f, undefined);
  } finally {
    os.homedir = origHome;
    if (hadEnv) process.env.CLAUDE_CODE_SUBAGENT_MODEL = origEnv;
    else delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('pluginNames: handles array form and object form (skipping disabled)', () => {
  assert.deepEqual(doctor.pluginNames(['a', 'b']), ['a', 'b']);
  assert.deepEqual(doctor.pluginNames({ a: true, b: false, c: true }), ['a', 'c']);
  assert.deepEqual(doctor.pluginNames(undefined), []);
  assert.deepEqual(doctor.pluginNames(null), []);
});

test('main: always produces a findings list and never throws, even in an empty cwd', async () => {
  const dir = mkTmpDir('xend-doc-empty-');
  try {
    const origArgv = process.argv;
    const origLog = console.log;
    let captured = '';
    console.log = (s) => { captured += s; };
    try {
      process.argv = ['node', 'doctor.js', '--cwd', dir, '--json'];
      await doctor.main();
    } finally {
      console.log = origLog;
      process.argv = origArgv;
    }
    const parsed = JSON.parse(captured);
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length > 0);
    assert.equal(process.exitCode, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  }
});
