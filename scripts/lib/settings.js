'use strict';
// Loaders for Claude Code configuration: layered settings.json files, MCP
// server config, and memory (CLAUDE.md) files with one-level @import
// resolution. Pure reads — never writes, never throws out to the caller.

const fs = require('fs');
const path = require('path');
const os = require('os');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// Deep merge used for settings layering: plain objects merge key-by-key,
// arrays concatenate (so e.g. multiple `hooks` layers all fire), everything
// else is a plain override where the later value wins.
function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const result = Object.assign({}, base);
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (isPlainObject(bv) && isPlainObject(ov)) {
      result[key] = deepMerge(bv, ov);
    } else if (Array.isArray(bv) && Array.isArray(ov)) {
      result[key] = bv.concat(ov);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

function userSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}
function projectSettingsPath(cwd) {
  return path.join(cwd, '.claude', 'settings.json');
}
function localSettingsPath(cwd) {
  return path.join(cwd, '.claude', 'settings.local.json');
}

// Reads the three settings layers without merging them, so callers can show
// where each effective value came from.
function loadSettingsLayers(cwd) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const userPath = userSettingsPath();
  const projectPath = projectSettingsPath(resolvedCwd);
  const localPath = localSettingsPath(resolvedCwd);
  const user = readJsonSafe(userPath);
  const project = readJsonSafe(projectPath);
  const local = readJsonSafe(localPath);
  return {
    user: { path: userPath, value: user, found: user !== null },
    project: { path: projectPath, value: project, found: project !== null },
    local: { path: localPath, value: local, found: local !== null },
  };
}

// user < project < local, later overrides earlier (deep-merged).
function effectiveSettings(cwd) {
  const layers = loadSettingsLayers(cwd);
  let merged = {};
  for (const layer of [layers.user, layers.project, layers.local]) {
    if (layer.value) merged = deepMerge(merged, layer.value);
  }
  return { merged, layers };
}

// `effortLevel` is the current key; `effort` is the legacy alias. The newer
// key wins when both are present.
function effectiveEffortLevel(settings) {
  if (!settings) return null;
  if (settings.effortLevel !== undefined) return settings.effortLevel;
  if (settings.effort !== undefined) return settings.effort;
  return null;
}

// Which settings.json file a given key's effective value came from (the
// last layer, in user/project/local order, that defines it).
function sourceOfKey(layers, key) {
  let source = null;
  for (const [name, layer] of [['user', layers.user], ['project', layers.project], ['local', layers.local]]) {
    if (layer.value && Object.prototype.hasOwnProperty.call(layer.value, key)) {
      source = { layer: name, path: layer.path };
    }
  }
  return source;
}

// --- MCP servers -----------------------------------------------------------
//
// Global + per-project servers live in ~/.claude.json; project-local servers
// live in ./.mcp.json.
function loadMcpConfig(cwd) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const globalPath = path.join(os.homedir(), '.claude.json');
  const localPath = path.join(resolvedCwd, '.mcp.json');
  const globalJson = readJsonSafe(globalPath) || {};
  const localJson = readJsonSafe(localPath);

  const userServers = isPlainObject(globalJson.mcpServers) ? globalJson.mcpServers : {};
  let projectServers = {};
  if (isPlainObject(globalJson.projects) && isPlainObject(globalJson.projects[resolvedCwd])) {
    const proj = globalJson.projects[resolvedCwd];
    if (isPlainObject(proj.mcpServers)) projectServers = proj.mcpServers;
  }
  const localServers = localJson && isPlainObject(localJson.mcpServers) ? localJson.mcpServers : {};

  const sources = [
    { source: 'user', label: '~/.claude.json mcpServers', path: globalPath, servers: userServers },
    { source: 'project', label: `~/.claude.json projects["${resolvedCwd}"].mcpServers`, path: globalPath, servers: projectServers },
    { source: 'local', label: '.mcp.json mcpServers', path: localPath, servers: localServers },
  ];

  const byName = new Map(); // name -> [source, ...]
  for (const s of sources) {
    for (const name of Object.keys(s.servers)) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(s.source);
    }
  }

  return { sources, byName, total: byName.size };
}

// --- Memory files (CLAUDE.md et al.) ---------------------------------------

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  const fsRoot = path.parse(dir).root;
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
    } catch (_) { /* ignore */ }
    if (dir === fsRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const IMPORT_LINE_RE = /^@(\S+)/;

// Reads one memory file and resolves its `@path` import lines one level deep
// (an import inside an imported file is not itself followed).
function readMemoryFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
  const lines = content.split(/\r\n|\r|\n/);
  const imports = [];
  const dir = path.dirname(filePath);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const m = IMPORT_LINE_RE.exec(line);
    if (!m) continue;
    const importPath = m[1];
    const resolvedPath = path.resolve(dir, importPath);
    let importedContent = null;
    let exists = false;
    try {
      importedContent = fs.readFileSync(resolvedPath, 'utf8');
      exists = true;
    } catch (_) { /* missing import target is not fatal */ }
    imports.push({ raw: importPath, resolvedPath, exists, content: importedContent });
  }
  return {
    path: filePath,
    content,
    lines: lines.length,
    bytes: Buffer.byteLength(content, 'utf8'),
    imports,
  };
}

function listRuleFiles(cwd) {
  const dir = path.join(cwd, '.claude', 'rules');
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

// Parent directories from just-above-cwd up to (and including) the git root,
// only when cwd is actually nested under that root. If cwd IS the git root,
// or no git root is found, there is nothing above cwd worth walking (avoids
// scanning unrelated system directories like /home or /).
function ancestorMemoryDirs(resolvedCwd, gitRoot) {
  if (!gitRoot) return [];
  const dirs = [];
  let dir = path.dirname(resolvedCwd);
  const withinRoot = (d) => d === gitRoot || d.startsWith(gitRoot + path.sep);
  while (withinRoot(dir)) {
    dirs.push(dir);
    if (dir === gitRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

// Collects every memory file per the ground-truth locations:
//   ~/.claude/CLAUDE.md, ./CLAUDE.md, ./.claude/CLAUDE.md, ./CLAUDE.local.md,
//   ./.claude/rules/*.md, and CLAUDE.md in parent directories up to the git
//   root. Returns { files, gitRoot }.
function collectMemoryFiles(cwd) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const seen = new Set();
  const candidates = [];
  const add = (p) => {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  add(path.join(os.homedir(), '.claude', 'CLAUDE.md'));
  add(path.join(resolvedCwd, 'CLAUDE.md'));
  add(path.join(resolvedCwd, '.claude', 'CLAUDE.md'));
  add(path.join(resolvedCwd, 'CLAUDE.local.md'));
  for (const f of listRuleFiles(resolvedCwd)) add(f);

  const gitRoot = findGitRoot(resolvedCwd);
  for (const dir of ancestorMemoryDirs(resolvedCwd, gitRoot)) {
    add(path.join(dir, 'CLAUDE.md'));
  }

  const files = [];
  for (const filePath of candidates) {
    const f = readMemoryFile(filePath);
    if (f) files.push(f);
  }
  return { files, gitRoot, candidatePaths: candidates };
}

module.exports = {
  isPlainObject,
  readJsonSafe,
  deepMerge,
  userSettingsPath,
  projectSettingsPath,
  localSettingsPath,
  loadSettingsLayers,
  effectiveSettings,
  effectiveEffortLevel,
  sourceOfKey,
  loadMcpConfig,
  findGitRoot,
  ancestorMemoryDirs,
  readMemoryFile,
  listRuleFiles,
  collectMemoryFiles,
};
