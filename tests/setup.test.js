'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SETUP = path.join(__dirname, '..', 'scripts', 'setup.js');

// A sandbox HOME, Claude config dir and XDG dir, plus a stub `claude` on PATH that records how it
// was called, so no test touches the real settings or installs anything.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xend-setup-'));
  const dirs = { home: path.join(root, 'home'), claude: path.join(root, 'claude'), xdg: path.join(root, 'xdg'), bin: path.join(root, 'bin'), cwd: path.join(root, 'proj') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const log = path.join(root, 'claude-calls.log');
  fs.writeFileSync(path.join(dirs.bin, 'claude'), '#!/bin/sh\necho "$@" >> "' + log + '"\n', { mode: 0o755 });
  const run = (args) => spawnSync(process.execPath, [SETUP, ...args], {
    cwd: dirs.cwd, encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: dirs.home, CLAUDE_CONFIG_DIR: dirs.claude, XDG_CONFIG_HOME: dirs.xdg, PATH: dirs.bin + path.delimiter + process.env.PATH }),
  });
  const calls = () => { try { return fs.readFileSync(log, 'utf8'); } catch (_) { return ''; } };
  return { dirs, run, calls, settings: path.join(dirs.claude, 'settings.json') };
}

test('setup: a settings file that does not parse is left untouched and nothing is written', () => {
  const sb = sandbox();
  const original = '{\n  "permissions": { "deny": ["Bash(rm:*)"] },\n  "env": { "DATABASE_URL": "postgres://x" },\n}\n';
  fs.writeFileSync(sb.settings, original);
  const r = sb.run(['aggressive']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /cannot parse .*settings\.json.*nothing was changed/);
  assert.equal(fs.readFileSync(sb.settings, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(sb.dirs.xdg, 'xend', 'config.json')), false, 'the profile is not written either');
});

test('setup: a UTF-8 BOM is not a parse error; the file is backed up before it is changed', () => {
  const sb = sandbox();
  fs.writeFileSync(sb.settings, '﻿{ "permissions": { "deny": ["Bash(rm:*)"] } }');
  const r = sb.run(['aggressive']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const written = JSON.parse(fs.readFileSync(sb.settings, 'utf8'));
  assert.deepEqual(written.permissions, { deny: ['Bash(rm:*)'] });
  assert.ok(written.env.CLAUDE_CODE_EXTRA_BODY);
  const backups = fs.readdirSync(sb.dirs.claude).filter((f) => f.includes('.xend-backup-'));
  assert.equal(backups.length, 1);
});

test('setup: --with-recommended never installs a plugin or sets the cache TTL; --install-ponytail does install', () => {
  const sb = sandbox();
  const r = sb.run(['balanced', '--with-recommended']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sb.calls(), '', 'no claude plugin command may run');
  const written = JSON.parse(fs.readFileSync(sb.settings, 'utf8'));
  assert.equal(written.promptCacheTtl, undefined);
  assert.equal(written.env.MAX_MCP_OUTPUT_TOKENS, '10000');
  const r2 = sb.run(['balanced', '--install-ponytail']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(sb.calls(), /plugin install ponytail@ponytail/);
});

test('setup: no arguments is a dry run of balanced that writes nothing', () => {
  const sb = sandbox();
  const r = sb.run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /dry run of balanced/);
  assert.equal(fs.existsSync(sb.settings), false);
  assert.equal(fs.existsSync(path.join(sb.dirs.xdg, 'xend', 'config.json')), false);
});

test('setup: --undo restores the latest backup, keeps the file it replaces, and a second --undo does not swap back', () => {
  const sb = sandbox();
  fs.writeFileSync(sb.settings, '{ "model": "sonnet" }');
  assert.equal(sb.run(['aggressive']).status, 0);
  const r = sb.run(['--undo']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(sb.settings, 'utf8')), { model: 'sonnet' });
  assert.match(r.stdout, /kept at .*xend-undo-kept-/);
  assert.equal(sb.run(['--undo']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(sb.settings, 'utf8')), { model: 'sonnet' }, 'still the original, not the post-setup file');
});

test('setup: an unparsable settings file stops --compact-instructions too, before anything is written', () => {
  const sb = sandbox();
  fs.writeFileSync(sb.settings, '{ "a": 1, }');
  const r = sb.run(['balanced', '--compact-instructions']);
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(path.join(sb.dirs.claude, 'CLAUDE.md')), false);
  // and when it does write CLAUDE.md, an existing one is backed up first
  fs.writeFileSync(sb.settings, '{}');
  fs.writeFileSync(path.join(sb.dirs.claude, 'CLAUDE.md'), '# mine\n');
  assert.equal(sb.run(['balanced', '--compact-instructions']).status, 0);
  assert.ok(fs.readdirSync(sb.dirs.claude).some((f) => f.startsWith('CLAUDE.md.xend-backup-')));
  assert.match(fs.readFileSync(path.join(sb.dirs.claude, 'CLAUDE.md'), 'utf8'), /^# mine\n[\s\S]*# Compact instructions/);
});
