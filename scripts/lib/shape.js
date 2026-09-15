'use strict';
// Deterministic, lossless-recoverable shaping of tool results.
// Design rules (see docs/ARCHITECTURE.md):
//  - never call a model; masking and trimming only
//  - never drop lines that look like errors, failures, diffs, or stack traces
//  - report what was removed so the caller can append a recovery marker
const path = require('path');

// ---------- basic cleanup ----------
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]/g;
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '').replace(CTRL_RE, '');
}

function collapseCarriageReturns(s) {
  if (s.indexOf('\r') === -1) return s;
  return s.split('\n').map((line) => {
    if (line.indexOf('\r') === -1) return line;
    const parts = line.split('\r').filter((p) => p.length > 0);
    return parts.length ? parts[parts.length - 1] : '';
  }).join('\n');
}

const PROGRESS_RE = [
  /^\s*[\[\(\|]?\s*[=#\-\.>─━█▓▒░]{3,}[=#\-\.>─━█▓▒░ ]*[\]\)\|]?\s*\d{1,3}(\.\d+)?%/,
  /^\s*\d{1,3}(\.\d+)?%\s*[\|\[\(█▓▒░]/,
  /^[\s⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|\/\-\\●○◐◑◒◓]+$/,
  /^\s*⸨+/,
  /^\s*(npm|pnpm|yarn) (http|timing|sill|verb|info)\b/i,
  /^\s*(Receiving objects|Resolving deltas|Compressing objects|Counting objects|Unpacking objects|remote: (Counting|Compressing|Enumerating) objects):\s+\d+%/,
  /^\s*\[\s*\d+\/\d+\]\s+.*\d{1,3}%\s*$/,
  /^\s*\d+(\.\d+)?\s*(k|K|M|G)?i?B\s*\/\s*\d+(\.\d+)?\s*(k|K|M|G)?i?B\b.*$/,
];

function isProgressLine(line) {
  return PROGRESS_RE.some((re) => re.test(line));
}

function cleanup(text, opts) {
  opts = opts || {};
  let t = String(text);
  if (opts.stripAnsi !== false) t = stripAnsi(t);
  t = collapseCarriageReturns(t);
  const lines = t.split('\n');
  const out = [];
  let removedProgress = 0;
  let blankRun = 0;
  for (let raw of lines) {
    const line = raw.replace(/[ \t]+$/, '');
    if (isProgressLine(line)) { removedProgress++; continue; }
    if (line.trim() === '') {
      blankRun++;
      if (blankRun > 1) continue;
    } else blankRun = 0;
    out.push(line);
  }
  let result = out.join('\n');
  let removedRepeats = 0;
  if (opts.collapseRepeats !== false) {
    const r = collapseRepeats(result);
    result = r.text; removedRepeats = r.removed;
  }
  return { text: result, removedProgress, removedRepeats };
}

// consecutive identical lines (>=4) -> one line + an explicit count
function collapseRepeats(text) {
  const lines = text.split('\n');
  const out = [];
  let removed = 0;
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    let j = i + 1;
    while (j < lines.length && lines[j] === cur && cur.trim() !== '') j++;
    const run = j - i;
    if (run >= 4) {
      out.push(cur);
      out.push('  (previous line repeated ' + run + ' times)');
      removed += run - 1;
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return { text: out.join('\n'), removed };
}

// ---------- kind detection ----------
const TEST_CMD_RE = /\b(pytest|py\.test|python3?\s+-m\s+(pytest|unittest)|jest|vitest|mocha|npm\s+(run\s+)?test|yarn\s+(run\s+)?test|pnpm\s+(run\s+)?test|bun\s+test|deno\s+test|go\s+test|cargo\s+(test|nextest)|rspec|phpunit|dotnet\s+test|mvn\s+(test|verify)|gradle(w)?\s+test|ctest|tox|nox|make\s+test|unittest)\b/;
const PKG_CMD_RE = /\b((npm|pnpm|yarn|bun)\s+(i|install|ci|add|update|up|upgrade)\b|pip3?\s+(install|download|wheel)\b|uv\s+(sync|pip\s+install|add)\b|poetry\s+(install|update|add)\b|cargo\s+(build|fetch|install|update)\b|go\s+(get|mod\s+(download|tidy)|build)\b|apt(-get)?\s+(install|update|upgrade)\b|brew\s+(install|update|upgrade)\b|gem\s+install\b|bundle\s+(install|update)\b|composer\s+(install|update|require)\b|conda\s+(install|update)\b)/;
const DIFF_CMD_RE = /\bgit\s+(diff|show|log\s+-p|format-patch)\b|\bdiff\b/;
const LOG_CMD_RE = /\bgit\s+log\b/;

const TEST_OUT_RE = [
  /^=+ .*(passed|failed|error|skipped).* =+$/m,   // pytest summary
  /^Tests:\s+\d+/m,                               // jest/vitest
  /^(ok|FAIL)\s+\S+\s+[\d.]+s/m,                   // go test
  /^test result: (ok|FAILED)\./m,                 // cargo
  /^Ran \d+ tests? in [\d.]+s/m,                  // unittest
  /^\s*\d+ (passing|failing|pending)\b/m,         // mocha
  /^(PASS|FAIL) [^\n]*\.(test|spec)\.[jt]sx?/m,   // jest file lines
];

function detectKind(command, text) {
  const cmd = String(command || '');
  if (DIFF_CMD_RE.test(cmd) && !LOG_CMD_RE.test(cmd)) return 'diff';
  if (TEST_CMD_RE.test(cmd) || TEST_OUT_RE.some((re) => re.test(text))) return 'test';
  if (PKG_CMD_RE.test(cmd)) return 'pkg';
  const trimmed = String(text || '').trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && looksLikeJson(trimmed)) return 'json';
  if (/^diff --git |^--- a\/|^\+\+\+ b\//m.test(text)) return 'diff';
  return 'generic';
}

function looksLikeJson(t) {
  if (t.length > 2000000) return false;
  try { JSON.parse(t); return true; } catch (_) { return false; }
}

// ---------- test-runner shaping: drop only lines known to be pass/progress noise ----------
const TEST_NOISE_RE = [
  /^\s*(PASS|✓|√|✔|✅)\s/,                                  // jest/vitest/mocha pass lines
  /^\s*--- PASS: /, /^\s*=== (RUN|PAUSE|CONT)\s/,               // go
  /^\s*test \S+ \.\.\. ok$/, /^\s*test \S+ \.\.\. ignored$/,    // cargo
  /^\S+(\.py|_test\.go|\.rb|\.ts|\.js|\.tsx|\.jsx) [.FEsxX]+\s*(\[\s*\d+%\])?$/, // pytest file progress rows
  /^\s*[.]{4,}\s*(\[\s*\d+%\])?$/,                             // dot rows
  /^.*\bPASSED\b\s*(\[\s*\d+%\])?$/,                            // pytest -v passed rows
  /^\s*\d+\)\s.*\bok\b$/,                                       // tap ok lines
  /^ok \d+ - /,                                                 // TAP
  /^\s*(platform|rootdir|configfile|plugins|cachedir|testpaths):/, // pytest header rows
  /^\s*✓\s|^\s*✓/,
];

function shapeTestOutput(text, minLines) {
  const lines = text.split('\n');
  if (lines.length < (minLines == null ? 60 : minLines)) return { text, removed: 0 };
  const out = [];
  let removed = 0;
  for (const line of lines) {
    if (TEST_NOISE_RE.some((re) => re.test(line))) { removed++; continue; }
    out.push(line);
  }
  // Keep at least the summary: if we removed everything meaningful, fall back.
  if (out.join('').trim().length === 0) return { text, removed: 0 };
  return { text: out.join('\n'), removed };
}

// ---------- package-manager shaping ----------
const PKG_NOISE_RE = [
  /^\s*(Collecting|Downloading|Using cached|Requirement already satisfied|Obtaining|Preparing metadata|Building wheel|Created wheel|Stored in directory|Running setup\.py|Attempting uninstall|Uninstalling|Found existing installation)\b/,
  /^\s*(Compiling|Checking|Downloaded|Updating crates\.io index|Locking|Adding|Fresh|Blocking waiting)\b/,
  /^\s*(Get:\d+|Hit:\d+|Ign:\d+|Reading package lists|Building dependency tree|Reading state information|Selecting previously unselected|Preparing to unpack|Unpacking|Setting up|Processing triggers)\b/,
  /^\s*(Fetching|Resolving|Linking|Progress:|Packages:|Downloading packages|resolving|fetching|linking)\b/,
  /^\s*(==> (Downloading|Fetching|Pouring|Installing dependencies)|######)/,
  /^\s*(go: downloading|go: finding|go: extracting)\b/,
  /^\s*(Installing|Fetching gem metadata|Resolving dependencies|Bundle complete|Using)\b.*$/,
];

const PKG_KEEP_RE = /\b(warn|warning|error|err!|deprecated|vulnerab|peer dep|conflict|failed|not found|ENOENT|EACCES|Installing collected|Successfully|added \d+ packages?|removed \d+ packages?|changed \d+ packages?|up to date|audited|Bundle complete|Done in)\b/i;

function shapePkgOutput(text) {
  const lines = text.split('\n');
  const out = [];
  let removed = 0;
  for (const line of lines) {
    if (PKG_KEEP_RE.test(line)) { out.push(line); continue; }
    if (PKG_NOISE_RE.some((re) => re.test(line))) { removed++; continue; }
    out.push(line);
  }
  if (removed > 0) out.push('  (' + removed + ' download/resolve progress lines removed)');
  return { text: out.join('\n'), removed };
}

// ---------- JSON ----------
function jsonMinify(text) {
  const t = String(text).trim();
  if (t.length < 500) return { text, changed: false };
  try {
    const mini = JSON.stringify(JSON.parse(t));
    if (mini.length <= t.length * 0.85) return { text: mini, changed: true };
  } catch (_) {}
  return { text, changed: false };
}

// ---------- head/tail with boundary snapping ----------
const BOUNDARY_RE = {
  diff: /^diff --git |^@@ |^Only in |^Index: /,
  test: /^_{3,} .* _{3,}$|^={3,} |^--- FAIL: |^● |^FAIL |^\d+\) /,
  generic: /^\s*$|^[=\-#*]{3,}\s*$|^\S.*:$/,
};

function snapBack(lines, idx, re, maxBack) {
  for (let k = idx; k > Math.max(0, idx - maxBack); k--) {
    if (re.test(lines[k])) return k;
  }
  return idx;
}
function snapForward(lines, idx, re, maxFwd) {
  for (let k = idx; k < Math.min(lines.length, idx + maxFwd); k++) {
    if (re.test(lines[k])) return k;
  }
  return idx;
}

function headTail(text, maxChars, headRatio, kind) {
  const t = String(text);
  if (t.length <= maxChars) return { text: t, omittedLines: 0, omittedChars: 0 };
  const lines = t.split('\n');
  const total = lines.length;
  const re = BOUNDARY_RE[kind] || BOUNDARY_RE.generic;
  const headBudget = Math.floor(maxChars * (headRatio == null ? 0.6 : headRatio));
  const tailBudget = maxChars - headBudget;
  let headEnd = 0, used = 0;
  while (headEnd < total && used + lines[headEnd].length + 1 <= headBudget) { used += lines[headEnd].length + 1; headEnd++; }
  let tailStart = total, tused = 0;
  while (tailStart > headEnd && tused + lines[tailStart - 1].length + 1 <= tailBudget) { tused += lines[tailStart - 1].length + 1; tailStart--; }
  headEnd = snapBack(lines, headEnd, re, 25);
  tailStart = snapForward(lines, tailStart, re, 25);
  if (headEnd < 1) headEnd = Math.min(1, total);
  if (tailStart <= headEnd) return { text: t, omittedLines: 0, omittedChars: 0 };
  const omitted = lines.slice(headEnd, tailStart);
  const omittedChars = omitted.reduce((a, l) => a + l.length + 1, 0);
  const marker = '... [xend: ' + omitted.length + ' lines, ' + omittedChars + ' chars omitted here; full output in the file named below] ...';
  const kept = lines.slice(0, headEnd).concat([marker], lines.slice(tailStart));
  return { text: kept.join('\n'), omittedLines: omitted.length, omittedChars };
}

// ---------- outline for very large files ----------
const OUTLINE_RES = {
  py: /^\s*(async\s+def|def|class)\s+\w+/,
  js: /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s*\*?\s*\w+|class\s+\w+|(const|let|var)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)\s*=>|function\b|\w+\s*=>)|(interface|type|enum)\s+\w+)|^\s{2,6}(static\s+|async\s+|get\s+|set\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  go: /^(func|type)\s+/,
  rs: /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type)\s+/,
  jvm: /^\s*(public|private|protected|internal|static|final|abstract|override|open|data|sealed|\s)*\s*(class|interface|enum|record|struct|object|fun|def)\s+\w+|^\s+(public|private|protected|internal|static|final|override|async|virtual|\s)+[\w<>\[\],.\s?]+\s+\w+\s*\([^;]*$/,
  rb: /^\s*(def|class|module)\s+/,
  php: /^\s*(abstract\s+|final\s+)?(class|interface|trait|enum)\s+\w+|^\s*(public|private|protected|static|\s)*function\s+\w+/,
  c: /^[A-Za-z_][\w\s\*&<>:,]*\s+\**[A-Za-z_]\w*\s*\([^;]*\)\s*(\{|$)|^(struct|class|enum|union|namespace)\s+\w+/,
  sh: /^\s*(function\s+\w+|\w+\s*\(\))\s*\{?/,
  md: /^#{1,6}\s+/,
  yaml: /^[A-Za-z_][\w.-]*:/,
};
const EXT_MAP = {
  '.py': 'py', '.pyi': 'py',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.vue': 'js', '.svelte': 'js',
  '.go': 'go', '.rs': 'rs',
  '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm', '.scala': 'jvm', '.cs': 'jvm', '.swift': 'jvm',
  '.rb': 'rb', '.php': 'php',
  '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.hpp': 'c', '.hh': 'c', '.m': 'c', '.mm': 'c',
  '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh',
  '.md': 'md', '.markdown': 'md', '.rst': 'md',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'yaml', '.ini': 'yaml', '.cfg': 'yaml',
};

function outline(content, filePath, maxEntries) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  const lang = EXT_MAP[ext];
  if (!lang) return null;
  const re = OUTLINE_RES[lang];
  const lines = String(content).split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      entries.push('L' + (i + 1) + ': ' + lines[i].trim().slice(0, 120));
      if (entries.length >= (maxEntries || 300)) { entries.push('... (outline truncated)'); break; }
    }
  }
  return entries.length ? entries : null;
}

// ---------- top-level shapers ----------
const TERMINAL_FACING_RE = /\b(ansi|escape|tty|snapshot|colou?r|chalk|ora|blessed|ink|rich)\b/i;

function shapeBashText(text, kind, cfg, command) {
  const before = text.length;
  const kinds = [];
  let removedNoise = 0;
  let t = text;
  const keepAnsi = cfg.stripAnsi === false || TERMINAL_FACING_RE.test(String(command || ''));
  const c = cleanup(t, { stripAnsi: !keepAnsi, collapseRepeats: cfg.collapseRepeats });
  if (c.text !== t) {
    if (c.removedProgress) { kinds.push('progress'); removedNoise += c.removedProgress; }
    if (c.removedRepeats) { kinds.push('repeats'); removedNoise += c.removedRepeats; }
    if (c.text.length !== t.length && !c.removedProgress && !c.removedRepeats) kinds.push('cleanup');
    t = c.text;
  }
  if (kind === 'test' && cfg.testRunners) {
    const r = shapeTestOutput(t, cfg.testMinLines);
    if (r.removed) { kinds.push('test:' + r.removed); t = r.text; }
  } else if (kind === 'pkg' && cfg.packageManagers) {
    const r = shapePkgOutput(t);
    if (r.removed) { kinds.push('pkg:' + r.removed); t = r.text; }
  } else if (kind === 'json' && cfg.jsonMinify) {
    const r = jsonMinify(t);
    if (r.changed) { kinds.push('json'); t = r.text; }
  }
  // Head+tail only for generic output. Diffs, test runs and installs keep their middle: cutting it
  // is where a condenser hides the hunk or the failure the model needs (see docs/RESEARCH.md).
  if (cfg.headTail !== false && cfg.maxChars && t.length > cfg.maxChars && (kind === 'generic' || kind === 'json')) {
    const r = headTail(t, cfg.maxChars, cfg.headRatio, 'generic');
    if (r.omittedLines) { kinds.push('headtail:' + r.omittedLines); t = r.text; }
  }
  return { text: t, kinds, before, after: t.length, changed: t !== text };
}

function describe(kinds, beforeLines, afterLines) {
  const parts = [];
  for (const k of kinds) {
    if (k === 'progress') parts.push('progress/spinner lines removed');
    else if (k === 'repeats') parts.push('repeated lines collapsed');
    else if (k === 'cleanup') parts.push('escape codes removed');
    else if (k.startsWith('test:')) parts.push(k.slice(5) + ' passing/progress test lines removed (failures and summary kept)');
    else if (k.startsWith('pkg:')) parts.push('install chatter removed (warnings/errors kept)');
    else if (k === 'json') parts.push('JSON whitespace removed');
    else if (k.startsWith('headtail:')) parts.push(k.slice(9) + ' middle lines omitted (head and tail kept)');
    else if (k === 'dedupe') parts.push('identical to an earlier result');
    else if (k === 'outline') parts.push('outline shown instead of full content');
    else if (k.startsWith('grep:')) parts.push(k.slice(5) + ' grep lines omitted');
    else if (k.startsWith('list:')) parts.push(k.slice(5) + ' list entries omitted');
    else parts.push(k);
  }
  return beforeLines + ' -> ' + afterLines + ' lines: ' + parts.join('; ');
}

function countLines(s) { return s.length ? s.split('\n').length : 0; }

module.exports = {
  stripAnsi, collapseCarriageReturns, cleanup, collapseRepeats, isProgressLine,
  detectKind, shapeTestOutput, shapePkgOutput, jsonMinify, headTail, outline,
  shapeBashText, describe, countLines,
};
