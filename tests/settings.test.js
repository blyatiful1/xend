'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsLib = require('../scripts/lib/settings');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('deepMerge: later scalar overrides earlier, objects merge key-by-key, arrays concatenate', () => {
  const base = { a: 1, env: { X: '1', Y: '2' }, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ command: 'one' }] }] } };
  const over = { a: 2, env: { Y: '20', Z: '3' }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'two' }] }] } };
  const merged = settingsLib.deepMerge(base, over);
  assert.equal(merged.a, 2);
  assert.deepEqual(merged.env, { X: '1', Y: '20', Z: '3' });
  assert.equal(merged.hooks.PreToolUse.length, 2);
});

test('effectiveSettings: user < project < local precedence', () => {
  const dir = mkTmpDir('xend-settings-');
  const home = mkTmpDir('xend-home-');
  const origHome = os.homedir;
  try {
    // Fake HOME via env override path helpers accept only cwd, so monkeypatch os.homedir.
    os.homedir = () => home;
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'from-user', effortLevel: 'high', bashOutputMaxChars: 30000 }));

    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ model: 'from-project', bashOutputMaxChars: 15000 }));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ model: 'from-local' }));

    const { merged, layers } = settingsLib.effectiveSettings(dir);
    assert.equal(merged.model, 'from-local'); // local wins
    assert.equal(merged.effortLevel, 'high'); // only user set it
    assert.equal(merged.bashOutputMaxChars, 15000); // project overrides user, local doesn't set it
    assert.equal(layers.user.found, true);
    assert.equal(layers.project.found, true);
    assert.equal(layers.local.found, true);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('effectiveSettings: missing files are handled gracefully (found:false, no throw)', () => {
  const dir = mkTmpDir('xend-settings-missing-');
  try {
    const { merged, layers } = settingsLib.effectiveSettings(dir);
    assert.deepEqual(merged, {});
    assert.equal(layers.user.found, false);
    assert.equal(layers.project.found, false);
    assert.equal(layers.local.found, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('effectiveSettings: malformed JSON is skipped, not thrown', () => {
  const dir = mkTmpDir('xend-settings-bad-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not valid json');
    const { merged, layers } = settingsLib.effectiveSettings(dir);
    assert.equal(layers.project.found, false);
    assert.deepEqual(merged, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('effectiveEffortLevel: effortLevel key wins over legacy effort alias', () => {
  assert.equal(settingsLib.effectiveEffortLevel({ effortLevel: 'medium', effort: 'high' }), 'medium');
  assert.equal(settingsLib.effectiveEffortLevel({ effort: 'high' }), 'high');
  assert.equal(settingsLib.effectiveEffortLevel({}), null);
  assert.equal(settingsLib.effectiveEffortLevel(null), null);
});

test('collectMemoryFiles: gathers CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, and rules/*.md', () => {
  const home = mkTmpDir('xend-home-');
  const dir = mkTmpDir('xend-memory-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'root memory\n');
    fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), 'dot-claude memory\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.local.md'), 'local memory\n');
    fs.writeFileSync(path.join(dir, '.claude', 'rules', 'a.md'), 'rule a\n');
    fs.writeFileSync(path.join(dir, '.claude', 'rules', 'b.md'), 'rule b\n');
    fs.writeFileSync(path.join(dir, '.claude', 'rules', 'ignore.txt'), 'not markdown\n');

    const { files } = settingsLib.collectMemoryFiles(dir);
    const names = files.map((f) => path.relative(dir, f.path)).sort();
    assert.deepEqual(names, [
      'CLAUDE.local.md',
      'CLAUDE.md',
      path.join('.claude', 'CLAUDE.md'),
      path.join('.claude', 'rules', 'a.md'),
      path.join('.claude', 'rules', 'b.md'),
    ].sort());
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('collectMemoryFiles: resolves one level of @import, does not recurse into the import', () => {
  const home = mkTmpDir('xend-home-');
  const dir = mkTmpDir('xend-memory-import-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    fs.writeFileSync(path.join(dir, 'shared.md'), '@nested.md\nshared content\n');
    fs.writeFileSync(path.join(dir, 'nested.md'), 'nested content, should not be followed further\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'main memory\n@shared.md\n');

    const { files } = settingsLib.collectMemoryFiles(dir);
    const root = files.find((f) => f.path === path.resolve(dir, 'CLAUDE.md'));
    assert.ok(root);
    assert.equal(root.imports.length, 1);
    assert.equal(root.imports[0].raw, 'shared.md');
    assert.equal(root.imports[0].exists, true);
    assert.match(root.imports[0].content, /shared content/);
    // one-level only: the returned import content is not itself expanded further
    assert.doesNotMatch(root.imports[0].content, /should not be followed further/);
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('loadMcpConfig: merges user (~/.claude.json), project (~/.claude.json projects[cwd]), and local (.mcp.json)', () => {
  const home = mkTmpDir('xend-home-');
  const dir = mkTmpDir('xend-mcp-');
  const origHome = os.homedir;
  try {
    os.homedir = () => home;
    const resolvedDir = fs.realpathSync(dir);
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { userServer: {} },
        projects: { [resolvedDir]: { mcpServers: { projectServer: {} } } },
      })
    );
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { localServer: {} } }));

    const mcp = settingsLib.loadMcpConfig(dir);
    assert.equal(mcp.total, 3);
    assert.ok(mcp.byName.has('userServer'));
    assert.ok(mcp.byName.has('projectServer'));
    assert.ok(mcp.byName.has('localServer'));
  } finally {
    os.homedir = origHome;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('findGitRoot: finds the nearest ancestor with a .git dir, null if none', () => {
  const dir = mkTmpDir('xend-git-');
  try {
    fs.mkdirSync(path.join(dir, '.git'));
    fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
    assert.equal(settingsLib.findGitRoot(path.join(dir, 'sub', 'deeper')), fs.realpathSync(dir));

    const noGit = mkTmpDir('xend-nogit-');
    try {
      // extremely unlikely any tmp ancestor has .git; just assert it doesn't throw
      const result = settingsLib.findGitRoot(noGit);
      assert.ok(result === null || typeof result === 'string');
    } finally {
      fs.rmSync(noGit, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
