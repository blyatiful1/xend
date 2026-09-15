#!/usr/bin/env node
'use strict';
// xend stats — token/cost/shaping report for one Claude Code session transcript.
//
//   node scripts/stats.js [--session <path-or-id>] [--cwd <dir>] [--json] [--last N]

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const transcript = require('./lib/transcript');

// --- CLI args ----------------------------------------------------------------

function parseArgs(argv) {
  const args = { session: null, cwd: null, json: false, last: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') args.session = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--last') args.last = Number(argv[++i]);
    else if (a.startsWith('--session=')) args.session = a.slice('--session='.length);
    else if (a.startsWith('--cwd=')) args.cwd = a.slice('--cwd='.length);
    else if (a.startsWith('--last=')) args.last = Number(a.slice('--last='.length));
  }
  if (!Number.isFinite(args.last) || args.last <= 0) args.last = null;
  return args;
}

// --- formatting helpers -------------------------------------------------------

function fmtInt(n) {
  n = Math.round(n || 0);
  return n.toLocaleString('en-US');
}
function fmtUSD(n) {
  if (n === null || n === undefined) return 'n/a';
  return '$' + n.toFixed(n < 1 ? 4 : 2);
}
function fmtPct(n) {
  if (n === null || n === undefined) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}
function padRight(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function rule(n) {
  return '-'.repeat(n);
}

function table(rows, aligns) {
  // rows: array of arrays of strings; aligns: 'l'|'r' per column.
  const cols = rows[0] ? rows[0].length : 0;
  const widths = new Array(cols).fill(0);
  for (const row of rows) {
    for (let c = 0; c < cols; c++) widths[c] = Math.max(widths[c], String(row[c]).length);
  }
  return rows
    .map((row) =>
      row
        .map((cell, c) => ((aligns && aligns[c] === 'r') ? padLeft(cell, widths[c]) : padRight(cell, widths[c])))
        .join('  ')
        .replace(/\s+$/, '')
    )
    .join('\n');
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█'; // ▁▂▃▄▅▆▇█

function sparkline(values) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARK_CHARS[0].repeat(values.length);
  return values
    .map((v) => {
      const t = (v - min) / (max - min);
      const idx = Math.min(SPARK_CHARS.length - 1, Math.floor(t * SPARK_CHARS.length));
      return SPARK_CHARS[idx];
    })
    .join('');
}

function bucketPromptSizes(promptSizes, bucketCount) {
  if (!promptSizes.length) return [];
  const n = Math.min(bucketCount, promptSizes.length);
  const buckets = [];
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b * promptSizes.length) / n);
    const end = Math.floor(((b + 1) * promptSizes.length) / n);
    const slice = promptSizes.slice(start, end);
    const avg = slice.reduce((s, p) => s + p.size, 0) / slice.length;
    const max = Math.max(...slice.map((p) => p.size));
    buckets.push({
      turnStart: slice[0].index + 1,
      turnEnd: slice[slice.length - 1].index + 1,
      avg,
      max,
    });
  }
  return buckets;
}

// --- shaping log ---------------------------------------------------------------

function shapingLogCandidates(sessionId, env) {
  const candidates = [];
  if (env.XEND_STATE_DIR) {
    candidates.push(path.join(env.XEND_STATE_DIR, 'shaping.jsonl'));
    if (sessionId) candidates.push(path.join(env.XEND_STATE_DIR, sessionId, 'shaping.jsonl'));
  }
  if (env.CLAUDE_PLUGIN_DATA && sessionId) {
    candidates.push(path.join(env.CLAUDE_PLUGIN_DATA, 'sessions', sessionId, 'shaping.jsonl'));
  }
  if (sessionId) {
    candidates.push(path.join(env.TMPDIR || os.tmpdir(), 'xend', sessionId, 'shaping.jsonl'));
  }
  return candidates;
}

function findShapingLog(sessionId, env) {
  for (const candidate of shapingLogCandidates(sessionId, env)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) { /* ignore */ }
  }
  return null;
}

async function summarizeShapingLog(filePath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let events = 0;
  let charsBefore = 0;
  let recoveries = 0;
  let charsAfter = 0;
  const byKind = new Map();
  const byTool = new Map();
  let malformed = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      malformed++;
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.recovery) { recoveries++; continue; }
    events++;
    const before = typeof rec.before === 'number' ? rec.before : 0;
    const after = typeof rec.after === 'number' ? rec.after : 0;
    charsBefore += before;
    charsAfter += after;
    if (rec.tool) byTool.set(rec.tool, (byTool.get(rec.tool) || 0) + 1);
    if (Array.isArray(rec.kinds)) {
      for (const k of rec.kinds) byKind.set(k, (byKind.get(k) || 0) + 1);
    }
  }
  const savedChars = charsBefore - charsAfter;
  return {
    file: filePath,
    events,
    recoveries,
    recoveryRate: events ? recoveries / events : 0,
    charsBefore,
    charsAfter,
    savedChars,
    estTokensSaved: transcript.estimateTokens(savedChars),
    byKind: Object.fromEntries(byKind),
    byTool: Object.fromEntries(byTool),
    malformed,
  };
}

// --- verify (delegation) log -----------------------------------------------------

function verifyLogCandidates(sessionId, env) {
  const candidates = [];
  if (env.XEND_STATE_DIR) {
    candidates.push(path.join(env.XEND_STATE_DIR, 'verify.jsonl'));
    if (sessionId) candidates.push(path.join(env.XEND_STATE_DIR, sessionId, 'verify.jsonl'));
  }
  if (env.CLAUDE_PLUGIN_DATA && sessionId) {
    candidates.push(path.join(env.CLAUDE_PLUGIN_DATA, 'sessions', sessionId, 'verify.jsonl'));
  }
  if (sessionId) {
    candidates.push(path.join(env.TMPDIR || os.tmpdir(), 'xend', sessionId, 'verify.jsonl'));
  }
  return candidates;
}

function findVerifyLog(sessionId, env) {
  for (const candidate of verifyLogCandidates(sessionId, env)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) { /* ignore */ }
  }
  return null;
}

// Summarizes <state>/verify.jsonl, written by scripts/subagent-stop.js (docs/SPEC-architect.md
// section 7 step 10): one record per subagent run with its verdict and citation/scope counts.
async function summarizeVerifyLog(filePath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let runs = 0, pass = 0, mismatch = 0, fail = 0, unverifiable = 0, malformed = 0, badCitations = 0;
  let citationsChecked = 0, citationsBad = 0, scopeWarnings = 0, badLines = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      badLines++;
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    runs++;
    switch (rec.verdict) {
      case 'pass': pass++; break;
      case 'mismatch': mismatch++; break;
      case 'fail': fail++; break;
      case 'unverifiable': unverifiable++; break;
      case 'malformed': malformed++; break;
      case 'bad-citations': badCitations++; break;
      default: break;
    }
    if (typeof rec.checked === 'number') citationsChecked += rec.checked;
    if (typeof rec.bad === 'number') citationsBad += rec.bad;
    if (typeof rec.scope === 'number') scopeWarnings += rec.scope;
  }
  return {
    file: filePath,
    runs,
    pass,
    mismatch,
    fail,
    unverifiable,
    malformed,
    badCitations,
    citationsChecked,
    citationsBad,
    scopeWarnings,
    badLines,
  };
}

// --- report -> text ------------------------------------------------------------

function printText(report, resolved, shaping, delegation) {
  const lines = [];
  lines.push(`xend stats -- ${report.file}  (${resolved.source})`);
  const sess = report.sessionId ? `session ${report.sessionId}` : 'session unknown';
  const span = report.firstTimestamp && report.lastTimestamp ? `  ${report.firstTimestamp} -> ${report.lastTimestamp}` : '';
  lines.push(sess + span);
  if (report.windowed) lines.push(`(showing last ${report.turnCount} of ${report.totalTurnCount} turns)`);
  lines.push('');

  // 1. Totals
  lines.push('1. Totals');
  const totalsRows = [
    ['turns', fmtInt(report.turnCount)],
    ['input tokens', fmtInt(report.totals.input_tokens)],
    ['cache creation tokens', fmtInt(report.totals.cache_creation_input_tokens)],
    ['cache read tokens', fmtInt(report.totals.cache_read_input_tokens)],
    ['output tokens', fmtInt(report.totals.output_tokens)],
    ['context size (end, max)', fmtInt(report.contextSizeEnd) + ' tokens'],
    ['cache hit ratio', fmtPct(report.cacheHitRatio)],
    ['cost (total)', fmtUSD(report.costTotal) + (report.hasUnknownModelCost ? '  (some models unpriced)' : '')],
  ];
  lines.push(table(totalsRows.map((r) => ['  ' + r[0], r[1]]), ['l', 'r']));
  const models = Object.keys(report.costByModel);
  if (models.length) {
    lines.push('  cost by model:');
    const modelRows = models.map((m) => {
      const c = report.costByModel[m];
      return ['    ' + m, fmtUSD(c.cost.totalCost), `(${c.turns} turns, ${fmtInt(c.tokens.input_tokens + c.tokens.cache_creation_input_tokens + c.tokens.cache_read_input_tokens)} in / ${fmtInt(c.tokens.output_tokens)} out)`];
    });
    lines.push(table(modelRows, ['l', 'r', 'l']));
  }
  lines.push('');

  // 2. Context growth
  lines.push('2. Context growth (prompt size per turn)');
  const buckets = bucketPromptSizes(report.promptSizes, 10);
  if (buckets.length) {
    lines.push('  ' + sparkline(buckets.map((b) => b.avg)));
    const bucketRows = buckets.map((b) => [
      `  turns ${b.turnStart}-${b.turnEnd}`,
      fmtInt(b.avg) + ' avg',
      fmtInt(b.max) + ' max',
    ]);
    lines.push(table(bucketRows, ['l', 'r', 'r']));
  } else {
    lines.push('  (no turns)');
  }
  lines.push('');

  // 3. Tool usage
  lines.push('3. Tool usage');
  const toolNames = Object.keys(report.toolUsage).sort((a, b) => report.toolUsage[b].resultChars - report.toolUsage[a].resultChars);
  if (toolNames.length) {
    const toolRows = [['  tool', 'count', 'result chars', 'est tokens']].concat(
      toolNames.map((name) => {
        const t = report.toolUsage[name];
        return ['  ' + name, fmtInt(t.count), fmtInt(t.resultChars), fmtInt(transcript.estimateTokens(t.resultChars))];
      })
    );
    lines.push(table(toolRows, ['l', 'r', 'r', 'r']));
  } else {
    lines.push('  (no tool calls)');
  }
  if (report.topResults.length) {
    lines.push('  top ' + report.topResults.length + ' largest tool results:');
    const topRows = report.topResults.map((r, i) => [
      `   ${i + 1}.`,
      r.name,
      truncateLabel(r.label, 50),
      fmtInt(r.chars) + ' chars',
      fmtInt(r.estTokens) + ' tok',
    ]);
    lines.push(table(topRows, ['r', 'l', 'l', 'r', 'r']));
  }
  lines.push('');

  // 4. Re-reads
  lines.push('4. Re-reads');
  if (report.reReadFiles.length) {
    lines.push('  files read more than once:');
    lines.push(table(report.reReadFiles.map(([f, c]) => ['    ' + f, c + 'x']), ['l', 'r']));
  } else {
    lines.push('  no file was read more than once');
  }
  if (report.reRunBashCommands.length) {
    lines.push('  bash commands run more than once (verbatim):');
    lines.push(table(report.reRunBashCommands.map(([cmd, c]) => ['    ' + truncateLabel(cmd, 70), c + 'x']), ['l', 'r']));
  } else {
    lines.push('  no bash command was run more than once verbatim');
  }
  lines.push('');

  // 5. xend shaping (diagnostic: characters removed from tool results; billed savings are only
  //    what the token and cost meters above show, and what the paired bench measures)
  lines.push('5. xend shaping (diagnostic)');
  if (!shaping) {
    lines.push('  shaping log not found');
  } else {
    lines.push(`  log: ${shaping.file}`);
    lines.push(`  ${fmtInt(shaping.events)} shaped tool result(s)`);
    lines.push(`  chars removed from tool results: ${fmtInt(shaping.savedChars)}  (roughly ${fmtInt(shaping.estTokensSaved)} tokens of context; not a billed-savings figure)`);
    lines.push(`  recoveries (model re-read a persisted original): ${fmtInt(shaping.recoveries)}  rate ${(shaping.recoveryRate * 100).toFixed(1)}%  (above ~5% a transform is hiding something needed)`);
    const kinds = Object.keys(shaping.byKind);
    if (kinds.length) {
      lines.push('  by kind:');
      lines.push(table(kinds.sort((a, b) => shaping.byKind[b] - shaping.byKind[a]).map((k) => ['    ' + k, shaping.byKind[k] + 'x']), ['l', 'r']));
    }
  }
  lines.push('');

  // 6. Where tokens go
  lines.push('6. Where tokens go');
  const ct = report.charTotals;
  if (ct.total > 0) {
    lines.push(
      `  Across this transcript, approximately ${fmtPct(ct.toolResultShare)} of characters seen were tool results` +
        ` (${fmtInt(ct.toolResultChars)} chars), ${fmtPct(ct.assistantTextShare)} were the assistant's own text` +
        ` (${fmtInt(ct.assistantTextChars)} chars), and the remaining ${fmtPct(ct.otherShare)} was everything else` +
        ` (${fmtInt(ct.otherChars)} chars: thinking, tool-call parameters, and user prompts). This is a char-based` +
        ` approximation of context composition, not an exact token accounting of what remains in context after any compaction.`
    );
  } else {
    lines.push('  not enough data to estimate.');
  }
  lines.push('');

  // 7. Delegation (xend architect mode: what the deterministic verifier found, spec section 7)
  if (delegation) {
    lines.push('7. Delegation');
    lines.push(`  log: ${delegation.file}`);
    lines.push(`  subagent runs: ${fmtInt(delegation.runs)}`);
    const rows = [
      ['  verified pass', fmtInt(delegation.pass)],
      ['  mismatches caught', fmtInt(delegation.mismatch)],
      ['  fail (claimed)', fmtInt(delegation.fail)],
      ['  unverifiable', fmtInt(delegation.unverifiable)],
      ['  malformed', fmtInt(delegation.malformed)],
      ['  bad-citation replies', fmtInt(delegation.badCitations)],
      ['  citations checked/bad', `${fmtInt(delegation.citationsChecked)} / ${fmtInt(delegation.citationsBad)}`],
      ['  scope warnings', fmtInt(delegation.scopeWarnings)],
    ];
    lines.push(table(rows, ['l', 'r']));
  }

  console.log(lines.join('\n'));
}

function truncateLabel(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ');
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const resolved = transcript.resolveTranscriptPath({ session: args.session, cwd, env: process.env });

  if (!resolved.path) {
    if (args.json) {
      console.log(JSON.stringify({ error: resolved.error }, null, 2));
    } else {
      console.error('xend stats: ' + resolved.error);
    }
    process.exitCode = 1;
    return;
  }

  let data;
  try {
    data = await transcript.summarizeTranscript(resolved.path, { trackTools: true });
  } catch (err) {
    const msg = `could not read transcript ${resolved.path}: ${(err && err.message) || err}`;
    if (args.json) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error('xend stats: ' + msg);
    process.exitCode = 1;
    return;
  }

  const report = transcript.buildReport(data, { lastN: args.last });
  const sessionId = report.sessionId || path.basename(resolved.path, '.jsonl');
  const shapingPath = findShapingLog(sessionId, process.env);
  const shaping = shapingPath ? await summarizeShapingLog(shapingPath) : null;
  const verifyPath = findVerifyLog(sessionId, process.env);
  const delegation = verifyPath ? await summarizeVerifyLog(verifyPath) : null;

  if (args.json) {
    console.log(JSON.stringify({ transcript: resolved.path, source: resolved.source, ...report, shaping, delegation }, null, 2));
    return;
  }
  printText(report, resolved, shaping, delegation);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('xend stats: ' + ((err && err.stack) || err));
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  fmtInt,
  fmtUSD,
  fmtPct,
  table,
  sparkline,
  bucketPromptSizes,
  shapingLogCandidates,
  findShapingLog,
  summarizeShapingLog,
  verifyLogCandidates,
  findVerifyLog,
  summarizeVerifyLog,
  truncateLabel,
  printText,
  main,
};
