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
  /^\s*(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●○◐◑◒◓]+|[|\/\-\\])\s*$/, // a spinner frame; not a `---` rule or YAML separator
  /^\s*⸨+/,
  /^\s*(npm|pnpm|yarn) (http|timing|sill|verb|info)\b/i,
  /^\s*(Receiving objects|Resolving deltas|Compressing objects|Counting objects|Unpacking objects|remote: (Counting|Compressing|Enumerating) objects):\s+\d+%/,
  /^\s*\[\s*\d+\/\d+\]\s+.*\d{1,3}%\s*$/,
  /^\s*\d+(\.\d+)?\s*(k|K|M|G)?i?B\s*\/\s*\d+(\.\d+)?\s*(k|K|M|G)?i?B\b.*$/,
];

function isProgressLine(line) {
  return PROGRESS_RE.some((re) => re.test(line));
}

// Whitespace is left alone: a trailing space or a blank line can be the difference a diff or a
// failed assertion shows, and a model copies `cat` output into Edit's old_string. Only runs of
// more than two empty lines shrink (to two), and never in diffs or test output.
function cleanup(text, opts) {
  opts = opts || {};
  const kind = opts.kind || 'generic';
  let t = String(text);
  if (opts.stripAnsi !== false) t = stripAnsi(t);
  // a diff is kept byte for byte apart from colour: a \r is a CRLF change, a repeated or
  // bar-like line is content
  if (kind === 'diff') return { text: t, removedProgress: 0, removedRepeats: 0 };
  t = collapseCarriageReturns(t);
  const lines = t.split('\n');
  const out = [];
  let removedProgress = 0;
  let blankRun = 0;
  const squeezeBlanks = kind !== 'test';
  for (const line of lines) {
    if (isProgressLine(line)) { removedProgress++; continue; }
    if (line === '') {
      blankRun++;
      if (squeezeBlanks && blankRun > 2) continue;
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
const TEST_CMD_RE = /\b(pytest|py\.test|python3?\s+-m\s+(pytest|unittest)|node\s+--test|jest|vitest|mocha|npm\s+(run\s+)?test|yarn\s+(run\s+)?test|pnpm\s+(run\s+)?test|bun\s+test|deno\s+test|go\s+test|cargo\s+(test|nextest)|rspec|phpunit|dotnet\s+test|mvn\s+(test|verify)|gradle(w)?\s+test|ctest|tox|nox|make\s+test|unittest)\b/;
const PKG_CMD_RE = /\b((npm|pnpm|yarn|bun)\s+(i|install|ci|add|update|up|upgrade)\b|pip3?\s+(install|download|wheel)\b|uv\s+(sync|pip\s+install|add)\b|poetry\s+(install|update|add)\b|cargo\s+(build|fetch|install|update)\b|go\s+(get|mod\s+(download|tidy)|build)\b|apt(-get)?\s+(install|update|upgrade)\b|brew\s+(install|update|upgrade)\b|gem\s+install\b|bundle\s+(install|update)\b|composer\s+(install|update|require)\b|conda\s+(install|update)\b)/;
const DIFF_CMD_RE = /\bgit\s+(diff|show|log\s+-p|format-patch)\b|\bdiff\b/;
const LOG_CMD_RE = /\bgit\s+log\b/;
const SEARCH_CMD_RE = /(?:^|[|;&(]\s*|\bxargs\s+(?:-\S+\s+)*)(?:sudo\s+)?(?:\S*\/)?(?:grep|egrep|fgrep|zgrep|rg|ag|ack|git\s+grep)\b/;

const TEST_OUT_RE = [
  /^=+ .*(passed|failed|error|skipped).* =+$/m,   // pytest summary
  /^Tests:\s+\d+/m,                               // jest/vitest
  /^(ok|FAIL)\s+\S+\s+[\d.]+s/m,                   // go test
  /^test result: (ok|FAILED)\./m,                 // cargo
  /^Ran \d+ tests? in [\d.]+s/m,                  // unittest
  /^\s*\d+ (passing|failing|pending)\b/m,         // mocha
  /^(PASS|FAIL) [^\n]*\.(test|spec)\.[jt]sx?/m,   // jest file lines
  /^# (pass|fail) \d+$/m,                        // node --test (TAP)
];

function detectKind(command, text) {
  const cmd = String(command || '');
  if (DIFF_CMD_RE.test(cmd) && !LOG_CMD_RE.test(cmd)) return 'diff';
  if (TEST_CMD_RE.test(cmd) || TEST_OUT_RE.some((re) => re.test(text))) return 'test';
  if (PKG_CMD_RE.test(cmd)) return 'pkg';
  if (SEARCH_CMD_RE.test(cmd)) return 'search';
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
  /^\s*ok \d+ - /,                                              // TAP, node --test
  /^\s*# Subtest: /, /^\s*duration_ms: [\d.]+$/, /^\s*type: '(test|suite)'$/, // node --test per-test detail
  /^\s*(platform|rootdir|configfile|plugins|cachedir|testpaths):/, // pytest header rows
  /^\s*✓\s|^\s*✓/,
];

function shapeTestOutput(text, minLines) {
  const lines = text.split('\n');
  if (lines.length < (minLines == null ? 60 : minLines)) return { text, removed: 0 };
  const out = [];
  let removed = 0;
  let passBlock = false; // node --test: the YAML detail block after a passing `ok N -` line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (passBlock) { removed++; if (/^\s*\.\.\.$/.test(line)) passBlock = false; continue; }
    if (/^\s*ok \d+ - /.test(line) && /^\s*---$/.test(lines[i + 1] || '')) passBlock = true;
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

// Lines kept even from the middle of a long output: the error the model came for is often there
// (a log's one ERROR among thousands of routine lines).
const ERROR_LINE_RE = /\b(error|errors|fatal|panic|panicked|exception|traceback|failed|failure|critical|denied|refused|timed out)\b/i;

function headTail(text, maxChars, headRatio, kind, opts) {
  const t = String(text);
  if (t.length <= maxChars) return { text: t, omittedLines: 0, omittedChars: 0, rescued: 0, errorsDropped: 0 };
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
  if (tailStart <= headEnd) return { text: t, omittedLines: 0, omittedChars: 0, rescued: 0, errorsDropped: 0 };
  const cut = lines.slice(headEnd, tailStart);
  const rescued = [];
  let errorsDropped = 0;
  if (opts && opts.rescue) {
    let budget = Math.floor(maxChars * 0.25);
    for (const l of cut) {
      if (!ERROR_LINE_RE.test(l)) continue;
      if (rescued.length < 60 && l.length + 1 <= budget) { rescued.push(l); budget -= l.length + 1; } else errorsDropped++;
    }
  }
  const omitted = cut.length - rescued.length;
  const omittedChars = cut.reduce((a, l) => a + l.length + 1, 0) - rescued.reduce((a, l) => a + l.length + 1, 0);
  let marker = '... [xend: ' + omitted + ' lines, ' + omittedChars + ' chars omitted here';
  if (rescued.length) marker += errorsDropped ? '; ' + rescued.length + ' of the ' + (rescued.length + errorsDropped) + ' error lines among them are kept below' : '; the ' + rescued.length + ' error line' + (rescued.length === 1 ? '' : 's') + ' among them ' + (rescued.length === 1 ? 'is' : 'are') + ' kept below';
  marker += '; full output in the file named below] ...';
  const middle = rescued.length ? [marker].concat(rescued, ['... [xend: end of the omitted part] ...']) : [marker];
  const kept = lines.slice(0, headEnd).concat(middle, lines.slice(tailStart));
  return { text: kept.join('\n'), omittedLines: omitted, omittedChars, rescued: rescued.length, errorsDropped };
}

// ---------- over the size limit: fold repetition before cutting ----------
// grep/rg hits whose text repeats within one file (the same call, the same log message) go on one
// line that lists every line number, `path:12,40,77:text`. Nothing is lost. Only output that is
// plainly `grep -n` is touched: a path (or nothing) before the number, and line numbers rising
// within each file, so a log line that starts with a time (`12:30:45 ERROR`) is never read as one.
const HIT_RE = /^([^\s:]*[./][^\s:]*:)?(\d+):(.*)$/;

function mergeSearchHits(text) {
  const lines = String(text).split('\n');
  const groups = new Map();
  const lastNum = new Map();
  let hits = 0, nonEmpty = 0, rising = true;
  const parsed = lines.map((l, i) => {
    if (l.trim() !== '') nonEmpty++;
    const m = HIT_RE.exec(l);
    if (!m) return null;
    hits++;
    const prefix = m[1] || '';
    const n = Number(m[2]);
    if (lastNum.has(prefix) && n <= lastNum.get(prefix)) rising = false;
    lastNum.set(prefix, n);
    const key = prefix + '\0' + m[3];
    let g = groups.get(key);
    if (!g) { g = { first: i, nums: [] }; groups.set(key, g); }
    g.nums.push(m[2]);
    return { key, prefix, text: m[3] };
  });
  if (!rising || hits < nonEmpty * 0.8) return { text: String(text), merged: 0 };
  let merged = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const p = parsed[i];
    const g = p && groups.get(p.key);
    if (!g || g.nums.length < 2) { out.push(lines[i]); continue; }
    if (g.first !== i) { merged++; continue; }
    out.push(p.prefix + g.nums.join(',') + ':' + p.text);
  }
  return { text: out.join('\n'), merged };
}

// A long log is mostly a few messages with different numbers in them. Keep the first and the last
// line of each such message with a count of the ones between, rather than cutting the middle
// blindly; used only when it folds away a large part of the output (a log, not source code).
const SIMILAR_MIN = 5;
const REPEAT_NOTE_RE = /^\s*\(previous line repeated \d+ times\)$/;
const PATH_PREFIX_RE = /^([^\s:]+\.[A-Za-z0-9_]{1,10}|[^\s:]*\/[^\s:]*):/;

function maskNumbers(s) {
  return s.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/gi, '#').replace(/\d+/g, '#');
}

function collapseSimilar(text, kind) {
  const lines = String(text).split('\n');
  const keys = lines.map((l) => {
    if (l.trim() === '' || REPEAT_NOTE_RE.test(l) || l.indexOf('[xend') !== -1) return null;
    let path = '', rest = l;
    if (kind === 'search') {
      const m = PATH_PREFIX_RE.exec(l); // hits in different files never fold together
      if (m) { path = m[1]; rest = l.slice(m[0].length); }
    }
    const masked = maskNumbers(rest);
    if (masked.replace(/[^A-Za-z]/g, '').length < 10) return null; // rows of numbers are data
    return path + '\0' + masked;
  });
  const groups = new Map();
  keys.forEach((k, i) => {
    if (k === null) return;
    const g = groups.get(k);
    if (g) { g.count++; g.last = i; } else groups.set(k, { first: i, last: i, count: 1 });
  });
  let removed = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const g = keys[i] === null ? null : groups.get(keys[i]);
    if (!g || g.count < SIMILAR_MIN || i === g.last) { out.push(lines[i]); continue; }
    if (i === g.first) {
      out.push(lines[i]);
      out.push('  [xend: ' + (g.count - 2) + ' more lines like this one, differing only in numbers or ids, omitted; the last of them is kept below]');
      continue;
    }
    removed++;
  }
  if (removed < lines.length * 0.3) return { text: String(text), removed: 0 };
  return { text: out.join('\n'), removed };
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
  const c = cleanup(t, { stripAnsi: !keepAnsi, collapseRepeats: cfg.collapseRepeats, kind });
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
  // Over the size limit, only generic output, searches and JSON are reduced. Diffs, test runs and
  // installs keep their middle: cutting it is where a condenser hides the hunk or the failure the
  // model needs (see docs/RESEARCH.md). Lossless folding comes first, then folding of similar
  // lines, and only then a head+tail cut that still keeps the error lines from the middle.
  const overBudget = () => cfg.headTail !== false && cfg.maxChars && t.length > cfg.maxChars;
  if (overBudget() && (kind === 'generic' || kind === 'search' || kind === 'json')) {
    if (kind === 'search') {
      const m = mergeSearchHits(t);
      if (m.merged) { kinds.push('merged:' + m.merged); t = m.text; }
    }
    if (overBudget() && kind !== 'json') {
      const r = collapseSimilar(t, kind);
      if (r.removed) { kinds.push('similar:' + r.removed); t = r.text; }
    }
    if (overBudget()) {
      const r = headTail(t, cfg.maxChars, cfg.headRatio, 'generic', { rescue: true });
      if (r.omittedLines) {
        kinds.push('headtail:' + r.omittedLines);
        if (r.rescued) kinds.push('rescued:' + r.rescued);
        if (r.errorsDropped) kinds.push('errors-dropped:' + r.errorsDropped);
        t = r.text;
      }
    }
  }
  // Only removing lines from a known drop list (progress, repeats, pass lines, install chatter,
  // JSON whitespace, merged duplicate hits) leaves the output complete; folding or cutting does not.
  const lossy = kinds.some((k) => /^(similar|headtail):/.test(k));
  return { text: t, kinds, before, after: t.length, changed: t !== text, lossy };
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
    else if (k.startsWith('rescued:')) parts.push(k.slice(8) + ' error lines from the omitted part kept');
    else if (k.startsWith('errors-dropped:')) parts.push(k.slice(15) + ' further error lines omitted');
    else if (k.startsWith('merged:')) parts.push(k.slice(7) + ' hits with the same text in the same file merged onto one line as path:line,line,...:text');
    else if (k.startsWith('similar:')) parts.push(k.slice(8) + ' lines that differ from a kept line only in numbers or ids omitted (first and last of each kept, with a count)');
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
  mergeSearchHits, collapseSimilar, shapeBashText, describe, countLines,
};
