'use strict';
// Deterministic verifier for subagent replies (docs/SPEC-architect.md section 7). Every function
// here is pure or does small, bounded, synchronous file I/O (subagent transcripts and cited files
// are small); nothing here calls a model.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const state = require('./state.js');

const KIND_MAP = {
  'xend-scout': 'scout',
  'xend-reader': 'reader',
  'xend-reviewer': 'reviewer',
  'xend-worker-lite': 'worker-lite',
  'xend-worker': 'worker',
};

// Strips a leading "xend:" or any "<plugin>:" namespace prefix, then maps the bare agent name to
// its role. Unknown names (including agents from other plugins) return null.
function agentKind(agentType) {
  if (!agentType) return null;
  const bare = String(agentType).replace(/^[\w-]+:/, '');
  return KIND_MAP[bare] || null;
}

// --- citations ---------------------------------------------------------------

const CITATION_TOKEN_RE = /([A-Za-z0-9_.\/~-]+):(\d+)(?:-(\d+))?/g;

// path:LINE or path:START-END tokens. Paths must carry a "/" or a file extension (so plain prose
// like "Section 7:15" never matches); URLs and single-letter Windows drive prefixes are excluded.
function extractCitations(text) {
  if (!text) return [];
  // Blank out URLs first (same length, so match indices/raw text stay untouched elsewhere) so a
  // path-and-line-looking fragment inside an http(s) URL is never read as a citation.
  const masked = String(text).replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
  const out = [];
  let m;
  CITATION_TOKEN_RE.lastIndex = 0;
  while ((m = CITATION_TOKEN_RE.exec(masked))) {
    const p = m[1];
    if (/^[A-Za-z]$/.test(p)) continue; // bare single letter: almost certainly a drive letter
    const hasSep = p.includes('/');
    const hasExt = /\.[A-Za-z0-9]{1,10}$/.test(p);
    if (!hasSep && !hasExt) continue;
    const start = Number(m[2]);
    const end = m[3] !== undefined ? Number(m[3]) : undefined;
    out.push({ path: p, start, end, raw: m[0] });
  }
  return out;
}

// bullets "- <file>:<line>: <verbatim line>" from a reader reply's Evidence section.
function extractReaderEvidence(text) {
  if (!text) return [];
  const out = [];
  const re = /^-\s*([^\s:]+):(\d+):\s?(.*)$/gm;
  let m;
  while ((m = re.exec(String(text)))) {
    out.push({ path: m[1], line: Number(m[2]), text: m[3] });
  }
  return out;
}

function normalizeWs(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function resolvePath(p, cwd) {
  return path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
}

function countFileLines(content) {
  if (content === '') return 0;
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

// Existence + line-count check for one path/line pair. Never throws.
function checkOne(rawPath, cwd, lastLine) {
  const full = resolvePath(rawPath, cwd);
  let stat;
  try { stat = fs.statSync(full); } catch (_) { return { ok: false, reason: 'file not found: ' + rawPath }; }
  if (!stat.isFile()) return { ok: false, reason: 'file not found: ' + rawPath };
  let content;
  try { content = fs.readFileSync(full, 'utf8'); } catch (_) { return { ok: false, reason: 'file not found: ' + rawPath }; }
  const total = countFileLines(content);
  if (lastLine !== undefined && lastLine !== null && lastLine > total) {
    return { ok: false, reason: 'line ' + lastLine + ' beyond ' + rawPath + ' (' + total + ' lines)' };
  }
  return { ok: true, full, content, total };
}

// Checks every citation (existence + in-range) and, for reader evidence, that its quoted text
// (>= 12 chars, whitespace-normalized) actually appears on the named line.
function checkCitations(citations, cwd, readerEvidence) {
  citations = citations || [];
  readerEvidence = readerEvidence || [];
  const bad = [];
  let checked = 0;

  for (const c of citations) {
    checked++;
    const lastLine = c.end !== undefined && c.end !== null ? c.end : c.start;
    const r = checkOne(c.path, cwd, lastLine);
    if (!r.ok) bad.push({ raw: c.raw, reason: r.reason });
  }

  for (const e of readerEvidence) {
    checked++;
    const raw = e.path + ':' + e.line + ': ' + e.text;
    const r = checkOne(e.path, cwd, e.line);
    if (!r.ok) { bad.push({ raw, reason: r.reason }); continue; }
    const norm = normalizeWs(e.text);
    if (norm.length >= 12) {
      const lines = r.content.split('\n');
      const lineText = normalizeWs(lines[e.line - 1] || '');
      if (!lineText.includes(norm)) {
        bad.push({ raw, reason: 'evidence text not found at ' + e.path + ':' + e.line });
      }
    }
  }

  return { checked, bad };
}

// --- worker replies ------------------------------------------------------------

// Parses the fixed worker reply format (spec section 6): an optional leading `Task: <id>` line,
// then Result / Changed / Verification / Notes. The Verification line splits on the first " -> "
// into command and summary. `task` is null when the line is absent (older replies, or non-plan
// work); it is only read from lines before Result: so nothing later in the reply is mistaken for
// it.
function parseWorkerReply(text) {
  text = String(text || '');
  let result = null, command = null, summary = null, task = null;
  const changed = [];
  let section = null;
  let sawResult = false;
  for (const line of text.split('\n')) {
    if (!sawResult) {
      const taskLine = line.match(/^Task:\s*([\w-]+)/);
      if (taskLine) task = taskLine[1];
    }
    const header = line.match(/^(Result|Changed|Verification|Notes):\s*(.*)$/);
    if (header) {
      section = header[1];
      if (section === 'Result') sawResult = true;
      const rest = header[2];
      if (section === 'Result') {
        const rm = rest.trim().match(/^(PASS|FAIL|BLOCKED)/);
        result = rm ? rm[1] : null;
      } else if (section === 'Verification') {
        const idx = rest.indexOf(' -> ');
        if (idx !== -1) {
          command = rest.slice(0, idx).trim();
          summary = rest.slice(idx + 4).trim();
        } else {
          command = null;
          summary = rest.trim();
        }
      }
      continue;
    }
    if (section === 'Changed') {
      const m = line.match(/^-\s*([^:]+):/);
      if (m) changed.push(m[1].trim());
    }
  }
  return { result, command, summary, changed, task };
}

// --- command safety and execution -----------------------------------------------

const ALLOWLIST_RE = /^(python3?\s+-m\s+(pytest|unittest)|pytest|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+(run\s+)?test|node\s+--test|go\s+test|cargo\s+(test|check)|make\s+(test|check)|bash\s+[\w./-]*test[\w./-]*\.sh|\.\/[\w./-]*test[\w./-]*\.sh|ruff|eslint|tsc|mypy|node\s+[\w./-]+\.test\.js)\b/;
// An import smoke check: `python3 -c "import a.b"` or `python -c 'import a.b, c.d'`, one or more
// dotted module names, nothing else.
const IMPORT_SMOKE_RE = /^import\s+[\w.]+(?:\s*,\s*[\w.]+)*$/;
// Commands run without a shell (see runVerify), so shell syntax would reach a runner as literal
// text and mean something else than it does in bash; a command using any is refused instead. Inside
// '...' everything is literal in bash too; inside "..." bash still expands $, ` and \.
const UNQUOTED_FORBIDDEN_RE = /[;&|<>`$\\%^(){}]/;
const DQUOTED_FORBIDDEN_RE = /[`$\\]/;

// Flags a verify or test command may carry. Anything else makes the command unverifiable rather
// than run: --basetemp, --rootdir, -c, -o, --junitxml, -exec, --script-shell, -r/--require, --fix,
// --outDir can delete, write or load files outside the test run, and --collect-only, --test-only,
// --passWithNoTests, --if-present or make's -i would let a check "pass" without running tests.
const SAFE_FLAGS = new Set([
  // pytest / unittest
  '-q', '-qq', '-v', '-vv', '-vvv', '-x', '-s', '-l', '-k', '-m', '-p', '-W', '-n', '-t', '-b',
  '--tb', '--maxfail', '--lf', '--last-failed', '--ff', '--failed-first', '--nf', '--new-first', '--sw',
  '--stepwise', '--no-header', '--no-summary', '--disable-warnings', '--durations',
  '--durations-min', '--strict-markers', '--strict-config', '--runxfail', '--color', '--capture', '--showlocals',
  '--exitfirst', '--quiet', '--verbose', '--import-mode', '--timeout', '--locals', '--failfast', '--buffer',
  '--no-cov', '--cov',
  // node --test
  '--test', '--test-reporter', '--test-name-pattern', '--test-concurrency', '--test-timeout', '--test-force-exit',
  // npm / pnpm / yarn, and common runner flags passed after `--`
  '--', '--silent', '--runInBand', '--ci', '--bail', '--testNamePattern', '--grep', '-g', '--reporter',
  '--watch', '--watchAll', '--run', // --watch and --watchAll only as =false (see argsSafe)
  // go test
  '-run', '-count', '-race', '-short', '-timeout', '-cover', '-failfast', '-bench', '-tags', '-vet', '-json',
  // cargo
  '--lib', '--bins', '--bin', '--tests', '--examples', '--all', '--workspace', '--package', '--no-fail-fast',
  '--release', '--features', '-F', '--all-features', '--no-default-features', '--all-targets', '--locked',
  '--offline', '--frozen', '--nocapture', '--test-threads', '--exact', '--ignored', '--include-ignored',
  '--show-output', '-j', '--jobs',
  // make
  '-k', '--keep-going',
  // linters and type checkers (never --fix / --write / --outDir)
  '--check', '--diff', '--select', '--ignore', '--extend-select', '--no-cache', '--output-format', '--statistics',
  '--max-warnings', '--ext', '--no-warn-ignored', '--noEmit', '--project', '--pretty', '--skipLibCheck', '--strict',
  '--ignore-missing-imports', '--no-error-summary', '--check-untyped-defs', '--python-version', '--no-incremental',
  '--show-error-codes', '--follow-imports',
]);

// Splits a command into argv the way bash would for the simple commands allowed here: words split
// on whitespace, '...' and "..." quoting, an unquoted # starting a comment. null when it is empty,
// unbalanced, spans lines, or uses shell syntax (UNQUOTED_FORBIDDEN_RE / DQUOTED_FORBIDDEN_RE).
// argv.globs[i] is true when word i holds an unquoted * ? or [ that bash would expand (runVerify
// expands it the same way).
function parseCommand(cmd) {
  if (typeof cmd !== 'string') return null;
  const s = cmd.trim();
  if (!s || /[\n\r\0]/.test(s)) return null;
  const argv = [];
  const globs = [];
  let cur = null, quote = null, glob = false;
  const flush = () => { if (cur !== null) { argv.push(cur); globs.push(glob); } cur = null; glob = false; };
  for (const ch of s) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (quote === '"' && DQUOTED_FORBIDDEN_RE.test(ch)) return null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; if (cur === null) cur = '';
    } else if (/\s/.test(ch)) {
      flush();
    } else if (ch === '#' && cur === null) {
      break;
    } else {
      if (UNQUOTED_FORBIDDEN_RE.test(ch)) return null;
      if (ch === '*' || ch === '?' || ch === '[') glob = true;
      cur = (cur === null ? '' : cur) + ch;
    }
  }
  if (quote) return null;
  flush();
  if (!argv.length) return null;
  argv.globs = globs;
  return argv;
}

// One glob path segment as a regex: * and ? within a name, [...] and [!...] classes.
function segmentRe(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[' && seg.indexOf(']', i + 2) !== -1) {
      const j = seg.indexOf(']', i + 2);
      let cls = seg.slice(i + 1, j).replace(/\\/g, '\\\\');
      if (cls[0] === '!') cls = '^' + cls.slice(1);
      re += '[' + cls + ']';
      i = j;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

const MAX_GLOB_WORDS = 5000;

// Pathname expansion as bash does it by default: the sorted matching paths under cwd, or the word
// itself when nothing matches. Names starting with "." match only a pattern that does too.
function expandGlob(word, cwd) {
  const parts = word.split('/');
  let bases = [''];
  for (let k = 0; k < parts.length && bases.length; k++) {
    const seg = parts[k];
    const next = [];
    for (const b of bases) {
      if (!/[*?[]/.test(seg)) { next.push(b ? b + '/' + seg : seg); continue; }
      let names = [];
      try { names = fs.readdirSync(path.join(cwd, b || '.')); } catch (_) {}
      const re = segmentRe(seg);
      for (const n of names) if (re.test(n) && (!n.startsWith('.') || seg.startsWith('.'))) next.push(b ? b + '/' + n : n);
    }
    bases = next;
  }
  const hits = bases.filter((p) => { try { fs.statSync(path.join(cwd, p)); return true; } catch (_) { return false; } }).sort();
  return hits.length ? hits : [word];
}

// A value that names a file must stay inside the project: relative, no "..", no "~".
function pathSafe(v) {
  const s = String(v);
  if (/^[\\/~]/.test(s) || /^[A-Za-z]:/.test(s)) return false;
  return !/(^|[\\/])\.\.([\\/]|$)/.test(s);
}

// Every word after the runner must be a SAFE_FLAGS flag (value after "=" path-checked), pytest's
// -r<chars> report switch, or a path-safe positional; a positional holding "=" is only accepted as
// a flag's value. Under Python, `-p` loads a plugin module, so there it only takes "no:<plugin>"
// or a glob pattern (unittest's -p); tsc and cargo use -p for a project path or package name.
function argsSafe(argv, runner) {
  const python = /^(pytest|python3?)$/.test(runner || '');
  let prevFlag = null;
  for (const a of argv) {
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (python && /^-r[a-zA-Z]+$/.test(a)) { prevFlag = null; continue; }
      if (python && /^-[qvxslb]{2,}$/.test(a)) { prevFlag = null; continue; } // combined short flags: -xvs
      if ((name === '--watch' || name === '--watchAll') && a !== name + '=false') return false;
      if (python && name.startsWith('-p') && name !== '-p' && !name.startsWith('--')) { if (!/^-pno:[\w.-]+$/.test(a)) return false; prevFlag = null; continue; }
      if (!SAFE_FLAGS.has(name)) return false;
      if (eq !== -1 && !pathSafe(a.slice(eq + 1))) return false;
      prevFlag = eq === -1 ? name : null;
      continue;
    }
    if (python && prevFlag === '-p' && !/^no:[\w.-]+$/.test(a) && !a.includes('*')) return false;
    // make variables (V=1, VERBOSE=1), but none that changes how make runs recipes
    if (runner === 'make' && /^[A-Z][A-Z0-9_]*=[\w.,:+-]*$/.test(a) && !/^(SHELL|\.SHELLFLAGS|MAKE\w*|MFLAGS|GNUMAKEFLAGS)=/.test(a)) { prevFlag = null; continue; }
    if (a.includes('=') && !prevFlag) return false;
    if (!pathSafe(a)) return false;
    prevFlag = null;
  }
  return true;
}

// The program itself: one of the runners by name, or a project-relative ./...test...sh script.
const RUNNER_RE = /^(pytest|python3?|npm|pnpm|yarn|node|go|cargo|make|bash|ruff|eslint|tsc|mypy)$/;
const SCRIPT_RE = /^\.\/[\w./-]*test[\w./-]*\.sh$/;

function commandAllowed(cmd) {
  const argv = parseCommand(cmd);
  if (!argv) return false;
  if (!RUNNER_RE.test(argv[0]) && !(SCRIPT_RE.test(argv[0]) && pathSafe(argv[0].slice(2)))) return false;
  if (/^python3?$/.test(argv[0]) && argv[1] === '-c') return argv.length === 3 && IMPORT_SMOKE_RE.test(argv[2].trim());
  if (!ALLOWLIST_RE.test(argv.join(' '))) return false;
  // runners whose default action writes: ruff only checks (`ruff check`, `ruff format --check`),
  // tsc only type-checks (--noEmit), whatever else the flags say
  if (argv[0] === 'ruff' && argv.length > 1 && argv[1] !== 'check' && !(argv[1] === 'format' && argv.includes('--check'))) return false;
  if (argv[0] === 'tsc' && !argv.includes('--noEmit')) return false;
  // the script or target is exactly `test` (or make's `check`): the allowlist's \b would also let
  // `npm run test-deploy` or `make test install` through, which run other scripts and targets
  if (/^(npm|pnpm|yarn)$/.test(argv[0]) && !(argv[1] === 'test' || (argv[1] === 'run' && argv[2] === 'test'))) return false;
  if (argv[0] === 'make' && (!/^(test|check)$/.test(argv[1]) || argv.slice(2).some((a) => !a.startsWith('-') && !a.includes('=')))) return false;
  if (argv[0] === 'cargo' && !/^(test|check)$/.test(argv[1])) return false;
  if (argv[0] === 'go' && argv[1] !== 'test') return false;
  // the runner words themselves (e.g. "python3 -m pytest", "npm run test") are fixed by the allowlist
  const lead = /^python3?$/.test(argv[0]) && argv[1] === '-m' ? 3 : 1;
  return argsSafe(argv.slice(lead), argv[0]);
}

function capBuffer(buf, max) {
  if (!buf) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  return (b.length > max ? b.slice(0, max) : b).toString('utf8');
}

// Runs a command without a shell (argv from parseCommand, globs expanded as bash would), output
// capped at 64 KB each. notRunnable is set only when xend itself could not start the command
// (refused, a missing program): a command that ran and exited 126 or 127 is an ordinary failure. On Windows, npm, pnpm, yarn and the tools npm installs (tsc, eslint) are
// .cmd shims, which only run through cmd.exe; those get a shell, and only when every word is
// plain. A missing program reports exit 127, as a shell would. Never throws.
function runVerify(cmd, cwd, timeoutMs) {
  const start = Date.now();
  const parsed = parseCommand(cmd);
  if (!parsed) return { exit: 126, notRunnable: true, stdout: '', stderr: 'xend: not a runnable command: ' + String(cmd).slice(0, 200), ms: 0, timedOut: false };
  // Expanded names are file paths, never options: a file called "--basetemp=x" becomes
  // "./--basetemp=x", so a glob cannot smuggle in a flag the allowlist refused. At most
  // MAX_GLOB_WORDS words in all.
  const argv = [];
  for (let i = 0; i < parsed.length; i++) {
    const a = parsed[i];
    let words = [a];
    if (parsed.globs[i] && pathSafe(a)) {
      try { words = expandGlob(a, cwd || process.cwd()).map((w) => (w !== a && w.startsWith('-') ? './' + w : w)); } catch (_) { words = [a]; }
    }
    for (const w of words) argv.push(w);
    if (argv.length > MAX_GLOB_WORDS) {
      return { exit: 126, notRunnable: true, stdout: '', stderr: 'xend: glob expands to more than ' + MAX_GLOB_WORDS + ' words: ' + String(cmd).slice(0, 200), ms: 0, timedOut: false };
    }
  }
  const winShim = process.platform === 'win32' && /^(npm|pnpm|yarn|npx|tsc|eslint)$/i.test(argv[0]);
  if (winShim && !argv.every((a) => /^[\w.:/@,+=*-]+$/.test(a))) {
    return { exit: 126, notRunnable: true, stdout: '', stderr: 'xend: not a runnable command on Windows: ' + String(cmd).slice(0, 200), ms: 0, timedOut: false };
  }
  let res;
  try {
    const opts = { cwd: cwd || process.cwd(), timeout: timeoutMs || 120000, maxBuffer: 16 * 1024 * 1024 };
    res = winShim ? spawnSync(argv.join(' '), Object.assign(opts, { shell: true })) : spawnSync(argv[0], argv.slice(1), opts);
  } catch (e) {
    res = { status: 1, stdout: Buffer.from(''), stderr: Buffer.from(String((e && e.message) || e)), error: e };
  }
  const ms = Date.now() - start;
  if (res.error && res.error.code === 'ENOENT') {
    return { exit: 127, notRunnable: true, stdout: '', stderr: argv[0] + ': command not found', ms, timedOut: false };
  }
  const timedOut = !!(res.error && (res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM'));
  let exit = res.status;
  if (exit === null || exit === undefined) exit = timedOut ? 124 : 1;
  return {
    exit,
    stdout: capBuffer(res.stdout, 65536),
    stderr: capBuffer(res.stderr, 65536),
    ms,
    timedOut,
  };
}

// --- verdicts and block messages ------------------------------------------------

// Priority (a deliberate call, spec section 7 step 6 lists meanings, not order): a malformed
// reply or bad citations make the rest of the reply untrustworthy, so they win over whatever the
// re-run said; otherwise the re-run result (or its absence) decides.
function verdictFor(ctx) {
  ctx = ctx || {};
  const kind = ctx.kind;
  const claimed = ctx.claimed;
  const allowed = ctx.allowed;
  const exit = ctx.exit;
  const bad = ctx.bad;
  const badCount = Array.isArray(bad) ? bad.length : Number(bad || 0);

  if (ctx.malformed) return 'malformed';
  if (badCount > 0) return 'bad-citations';

  const isWorker = kind === 'worker' || kind === 'worker-lite';
  if (!isWorker) return 'pass'; // scout/reader/reviewer: citations checked out clean

  if (claimed === 'PASS') {
    if (!allowed) return 'unverifiable';
    return exit === 0 ? 'pass' : 'mismatch';
  }
  if (claimed === 'FAIL' || claimed === 'BLOCKED') return 'fail';
  return 'unverifiable';
}

function lastLines(text, n) {
  const lines = String(text || '').split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

// Exact reason strings from spec section 7 step 7.
function blockReason(verdict, ctx) {
  ctx = ctx || {};
  if (verdict === 'mismatch') {
    return 'xend re-ran "' + ctx.command + '": exit ' + ctx.exit + '. Last lines:\n' + lastLines(ctx.output, 15) +
      '\nYour Result claimed PASS. Fix it now if you can within scope, then restate your full reply truthfully in the fixed format; otherwise restate with Result: FAIL and say what fails.';
  }
  if (verdict === 'malformed') {
    return 'Your reply must use the fixed format: Result / Changed / Verification (<command> -> <summary>) / Notes. Restate it.';
  }
  if (verdict === 'bad-citations') {
    const list = (ctx.bad || []).map((b) => b.raw).join(', ');
    return 'These citations do not exist or are out of range: ' + list + '. Cite only ranges you actually read; correct or remove them and restate.';
  }
  return null;
}

// --- transcript parsing (agent's own JSONL: same record shape as the main transcript) ------------

function readJsonlSync(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line || line[0] !== '{') continue;
    try { out.push(JSON.parse(line)); } catch (_) { /* skip malformed */ }
  }
  return out;
}

// Every Edit/Write/MultiEdit/NotebookEdit tool_use input's file path, in first-seen order.
function editedPathsFromTranscript(agentTranscriptPath) {
  const out = [];
  const seen = new Set();
  for (const rec of readJsonlSync(agentTranscriptPath)) {
    if (rec.type !== 'assistant' || !rec.message || !Array.isArray(rec.message.content)) continue;
    for (const b of rec.message.content) {
      if (!b || b.type !== 'tool_use' || !b.input) continue;
      if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) continue;
      const f = b.input.file_path || b.input.notebook_path;
      if (f && !seen.has(f)) { seen.add(f); out.push(f); }
    }
  }
  return out;
}

// Text of the first `type: 'user'` record (string content, or joined text blocks).
function firstUserPrompt(agentTranscriptPath) {
  for (const rec of readJsonlSync(agentTranscriptPath)) {
    if (rec.type !== 'user' || !rec.message) continue;
    const content = rec.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    }
    return '';
  }
  return '';
}

// Text of the last assistant text block, used when last_assistant_message is missing from the
// hook input.
function lastAssistantText(agentTranscriptPath) {
  let last = '';
  for (const rec of readJsonlSync(agentTranscriptPath)) {
    if (rec.type !== 'assistant' || !rec.message || !Array.isArray(rec.message.content)) continue;
    const text = rec.message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    if (text) last = text;
  }
  return last;
}

function taskIdFromPrompt(text) {
  const m = String(text || '').match(/\[xend task ([\w-]+)\]/);
  return m ? m[1] : null;
}

function normalizeRel(p, cwd) {
  const abs = path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
  return path.relative(cwd || process.cwd(), abs).split(path.sep).join('/');
}

// Edited paths (relative to cwd) that fall outside task.files ∪ task.testFiles.
function scopeWarnings(edited, task, cwd) {
  if (!task) return [];
  const allowed = new Set([].concat(task.files || [], task.testFiles || []).map((p) => normalizeRel(p, cwd)));
  const warnings = [];
  for (const e of edited || []) {
    const rel = normalizeRel(e, cwd);
    if (!allowed.has(rel)) warnings.push(rel);
  }
  return warnings;
}

// --- plan update (spec section 7 step 9) ----------------------------------------

// Mutates and returns `plan`. `ctx.stopHookActive` distinguishes a subagent's first stop (about
// to be blocked-and-restated) from its final stop; `ctx.blockingDisabled` mirrors the config that
// would have skipped blocking altogether. Attempts increment exactly once per subagent run: on a
// verdict that is never blocked (fail), immediately; on one that blocks once (mismatch,
// malformed), only once the run has actually concluded (second stop, or blocking off).
function applyToPlan(plan, taskId, ctx) {
  ctx = ctx || {};
  if (!plan || !Array.isArray(plan.tasks)) return plan;
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return plan;

  const verdict = ctx.verdict;
  const claimed = ctx.claimed;
  const finalStop = !!ctx.stopHookActive || !!ctx.blockingDisabled;

  if (verdict === 'pass') {
    task.status = 'done';
    task.verified = true;
  } else if (verdict === 'unverifiable' && claimed === 'PASS') {
    task.status = 'done';
    task.verified = false;
  } else if (verdict === 'fail') {
    task.status = 'failed';
    task.attempts = (task.attempts || 0) + 1;
  } else if (verdict === 'mismatch' || verdict === 'malformed') {
    if (finalStop) {
      task.status = 'failed';
      task.attempts = (task.attempts || 0) + 1;
    }
    // else: first stop, about to block -- leave status/attempts untouched.
  }
  // bad-citations and any other verdict: no status/attempts change, only the note below.

  task.lastVerdict = ctx.note || verdict;
  if (Array.isArray(ctx.scope) && ctx.scope.length) {
    const merged = new Set(task.scopeWarnings || []);
    for (const s of ctx.scope) merged.add(s);
    task.scopeWarnings = Array.from(merged);
  }
  return plan;
}

// --- agent-launch registry -------------------------------------------------------
//
// Under --no-session-persistence the subagent's own transcript file (agent_transcript_path) is
// never written to disk, so SubagentStop cannot recover the plan task id from it. PostToolUse(Agent)
// fires at launch, synchronously, with the prompt and the new agentId together (the Agent tool
// itself is async and returns no result there) -- the only point that ever sees both, so
// scripts/agent-launch.js records them here for subagent-stop.js to look up later by agent_id.

const AGENTS_FILE = 'agents.json';
const AGENTS_MAX_ENTRIES = 200;

// entry: { agentId, taskId, subagentType, prompt, toolUseId }
function recordLaunch(dir, entry) {
  entry = entry || {};
  const agentId = entry.agentId;
  if (!agentId) return null;
  const file = path.join(dir, AGENTS_FILE);
  const reg = state.readJson(file, {}) || {};
  reg[agentId] = {
    taskId: entry.taskId || null,
    subagentType: entry.subagentType || null,
    prompt: entry.prompt || '',
    toolUseId: entry.toolUseId || null,
    ts: Date.now(),
  };
  const keys = Object.keys(reg);
  if (keys.length > AGENTS_MAX_ENTRIES) {
    keys.sort((a, b) => (reg[a].ts || 0) - (reg[b].ts || 0));
    for (const k of keys.slice(0, keys.length - AGENTS_MAX_ENTRIES)) delete reg[k];
  }
  state.writeJson(file, reg);
  return reg[agentId];
}

function lookupLaunch(dir, agentId) {
  if (!agentId) return null;
  const reg = state.readJson(path.join(dir, AGENTS_FILE), null);
  if (!reg || typeof reg !== 'object') return null;
  return reg[agentId] || null;
}

module.exports = {
  agentKind,
  extractCitations,
  extractReaderEvidence,
  checkCitations,
  parseWorkerReply,
  parseCommand,
  commandAllowed,
  runVerify,
  verdictFor,
  blockReason,
  editedPathsFromTranscript,
  firstUserPrompt,
  lastAssistantText,
  taskIdFromPrompt,
  scopeWarnings,
  applyToPlan,
  recordLaunch,
  lookupLaunch,
};
