'use strict';
// Claude Code session transcript (JSONL) discovery and streaming aggregation.
//
// Transcripts live at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// (encoded cwd = absolute path with every '/' replaced by '-'). A single
// assistant "turn" (one model call) is usually split across several JSONL
// lines that share the same message.id — one line per content block
// (thinking / text / tool_use) — and every one of those lines repeats the
// SAME message.usage for that call. Aggregation therefore keys turns by
// message.id and must not sum usage per line, only once per unique id.
//
// Everything here streams line-by-line (readline) and never loads a whole
// file into memory, so it stays fast and bounded on very large transcripts.
// Malformed JSON lines and unrecognized record `type`s are skipped, never
// thrown.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const CHARS_PER_TOKEN = 3.8;

function estimateTokens(chars) {
  return Math.round((chars || 0) / CHARS_PER_TOKEN);
}

function encodeProjectDir(cwd) {
  return String(cwd).replace(/\\/g, '/').replace(/\//g, '-');
}

function projectsRoot(env) {
  env = env || process.env;
  return path.join(os.homedir(), '.claude', 'projects');
}

function projectDirFor(cwd, env) {
  return path.join(projectsRoot(env), encodeProjectDir(path.resolve(cwd || process.cwd())));
}

// Lists *.jsonl transcripts directly inside a project dir (recursive also
// walks into subagents/ where Task/Agent sub-sessions are recorded).
function listProjectTranscripts(cwd, opts) {
  opts = opts || {};
  const dir = projectDirFor(cwd, opts.env);
  const out = [];
  const walk = (d, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (opts.recursive) walk(full, depth + 1);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch (_) { /* ignore */ }
      out.push({ file: full, mtimeMs, depth });
    }
  };
  walk(dir, 0);
  return out;
}

// Resolution order: $CLAUDE_TRANSCRIPT_PATH > --session (path or bare id) >
// most recently modified top-level transcript for the project dir.
function resolveTranscriptPath(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  if (env.CLAUDE_TRANSCRIPT_PATH) {
    return { path: env.CLAUDE_TRANSCRIPT_PATH, source: 'CLAUDE_TRANSCRIPT_PATH' };
  }
  const cwd = opts.cwd || process.cwd();
  if (opts.session) {
    if (fs.existsSync(opts.session)) return { path: opts.session, source: '--session (path)' };
    const dir = projectDirFor(cwd, env);
    const candidate = opts.session.endsWith('.jsonl') ? opts.session : `${opts.session}.jsonl`;
    const direct = path.join(dir, candidate);
    if (fs.existsSync(direct)) return { path: direct, source: '--session (id)' };
    const sub = path.join(dir, 'subagents', candidate);
    if (fs.existsSync(sub)) return { path: sub, source: '--session (subagent id)' };
    return { path: null, source: null, error: `no transcript found for session "${opts.session}"` };
  }
  const files = listProjectTranscripts(cwd, { env });
  if (!files.length) return { path: null, source: null, error: `no transcripts found under ${projectDirFor(cwd, env)}` };
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { path: files[0].file, source: 'latest' };
}

// --- content shape helpers --------------------------------------------------

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v) || '';
  } catch (_) {
    return '';
  }
}

// tool_result.content (and similar) can be a plain string or an array of
// blocks ({type:"text", text}, {type:"tool_reference", ...}, images, ...).
// We only ever need an approximate character count, so unknown block shapes
// fall back to their JSON length.
function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          return safeJsonStringify(part);
        }
        return '';
      })
      .join('');
  }
  return safeJsonStringify(content);
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function labelForTool(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash':
      return truncate(input.command || '', 80);
    case 'Read':
      return input.file_path || '';
    case 'Grep':
      return input.pattern || '';
    case 'Glob':
      return input.pattern || '';
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query || '';
    case 'Task':
    case 'Agent':
      return input.description || input.subagent_type || '';
    default:
      return truncate(safeJsonStringify(input), 80);
  }
}

// --- streaming aggregation --------------------------------------------------

// Streams `filePath` once and returns the raw per-turn / per-event data that
// buildReport() (and doctor's lighter usage scan) reduce further. Malformed
// lines are skipped; unknown record `type`s are ignored without error.
//
// opts.trackTools (default true): when false, skips tool_use/tool_result
// bookkeeping (and char totals) for a cheaper pass — used when only
// tokens/cost/cache-ratio are needed (doctor.js scanning many files).
async function summarizeTranscript(filePath, opts) {
  opts = opts || {};
  const trackTools = opts.trackTools !== false;

  const turnsById = new Map();
  const turnOrder = [];
  const toolUseIndex = new Map(); // tool_use_id -> {name, input, turnIndex}
  const toolUseEvents = []; // {turnIndex, id, name, input}
  const toolResultEvents = []; // {turnIndex, toolUseId, name, label, chars}
  let pendingUserTextChars = 0;
  let sessionId = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let malformedLines = 0;
  let totalLines = 0;

  function getTurn(id, ts) {
    if (turnsById.has(id)) return turnsById.get(id);
    const turn = {
      id,
      index: turnOrder.length,
      model: null,
      timestamp: ts || null,
      usage: null,
      textChars: 0,
      thinkingChars: 0,
      toolUseInputChars: 0,
      precedingUserTextChars: pendingUserTextChars,
      toolUses: [],
    };
    pendingUserTextChars = 0;
    turnsById.set(id, turn);
    turnOrder.push(id);
    return turn;
  }

  let fallbackTurnSeq = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    if (!rawLine || !rawLine.trim()) continue;
    totalLines++;
    let rec;
    try {
      rec = JSON.parse(rawLine);
    } catch (_) {
      malformedLines++;
      continue;
    }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.sessionId && !sessionId) sessionId = rec.sessionId;
    if (rec.timestamp) {
      if (!firstTimestamp) firstTimestamp = rec.timestamp;
      lastTimestamp = rec.timestamp;
    }

    if (rec.type === 'assistant') {
      const msg = rec.message || {};
      const id = msg.id || `__no-id-${rec.uuid || fallbackTurnSeq++}`;
      const turn = getTurn(id, rec.timestamp);
      if (msg.model) turn.model = msg.model;
      if (msg.usage) turn.usage = msg.usage;
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          turn.textChars += block.text.length;
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          turn.thinkingChars += block.thinking.length;
        } else if (block.type === 'tool_use') {
          const inputStr = safeJsonStringify(block.input);
          turn.toolUseInputChars += inputStr.length;
          turn.toolUses.push({ id: block.id, name: block.name, input: block.input });
          if (block.id) toolUseIndex.set(block.id, { name: block.name, input: block.input, turnIndex: turn.index });
          if (trackTools) {
            toolUseEvents.push({ turnIndex: turn.index, id: block.id, name: block.name, input: block.input });
          }
        }
      }
    } else if (rec.type === 'user') {
      const msg = rec.message || {};
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_result') {
            if (!trackTools) continue;
            const text = contentToText(block.content);
            const chars = text.length;
            const info = toolUseIndex.get(block.tool_use_id) || {};
            toolResultEvents.push({
              turnIndex: info.turnIndex,
              toolUseId: block.tool_use_id || null,
              name: info.name || 'unknown',
              label: labelForTool(info.name, info.input),
              chars,
              isError: !!block.is_error,
            });
          } else if (block.type === 'text' && typeof block.text === 'string') {
            pendingUserTextChars += block.text.length;
          }
        }
      } else if (typeof content === 'string') {
        pendingUserTextChars += content.length;
      }
    }
    // every other record `type` (system, queue-operation, attachment,
    // atis-latch, last-prompt, ...) is intentionally ignored.
  }

  return {
    file: filePath,
    sessionId,
    firstTimestamp,
    lastTimestamp,
    turns: turnOrder.map((id) => turnsById.get(id)),
    toolUseEvents,
    toolResultEvents,
    trailingUserTextChars: pendingUserTextChars,
    malformedLines,
    totalLines,
  };
}

// --- report building (pure, sync — no I/O) ----------------------------------

const pricing = require('./pricing');

function emptyUsageAcc() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ephemeral_1h_input_tokens: 0,
    turns: 0,
  };
}

// Builds the full derived report from summarizeTranscript()'s raw data.
// opts.lastN restricts every metric to the last N turns (and the tool
// events/user text that fall within that window).
function buildReport(data, opts) {
  opts = opts || {};
  const lastN = Number.isFinite(opts.lastN) && opts.lastN > 0 ? Math.floor(opts.lastN) : null;
  const allTurns = data.turns || [];
  const turns = lastN && allTurns.length > lastN ? allTurns.slice(allTurns.length - lastN) : allTurns;
  const windowStart = turns.length ? turns[0].index : null;
  const inWindow = (turnIndex) => {
    if (windowStart === null) return true;
    if (turnIndex === null || turnIndex === undefined) return false;
    return turnIndex >= windowStart;
  };
  const windowIncludesEnd = !lastN || turns.length === allTurns.length || (turns.length && allTurns.length && turns[turns.length - 1].index === allTurns[allTurns.length - 1].index);

  const totals = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const byModel = new Map();
  const promptSizes = [];
  let contextSizeEnd = 0;
  let assistantTextChars = 0;
  let thinkingChars = 0;
  let toolUseInputChars = 0;
  let userTextChars = 0;

  for (const t of turns) {
    const u = t.usage || {};
    const input = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
    const cacheCreate = typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
    const cacheRead = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
    const output = typeof u.output_tokens === 'number' ? u.output_tokens : 0;

    totals.input_tokens += input;
    totals.cache_creation_input_tokens += cacheCreate;
    totals.cache_read_input_tokens += cacheRead;
    totals.output_tokens += output;

    const ctxSize = input + cacheCreate + cacheRead;
    if (ctxSize > contextSizeEnd) contextSizeEnd = ctxSize;
    promptSizes.push({ index: t.index, size: ctxSize, model: t.model });

    const modelKey = t.model || 'unknown';
    if (!byModel.has(modelKey)) byModel.set(modelKey, emptyUsageAcc());
    const acc = byModel.get(modelKey);
    acc.input_tokens += input;
    acc.output_tokens += output;
    acc.cache_read_input_tokens += cacheRead;
    acc.cache_creation_input_tokens += cacheCreate;
    acc.turns += 1;
    const cc = u.cache_creation || {};
    if (typeof cc.ephemeral_1h_input_tokens === 'number') acc.ephemeral_1h_input_tokens += cc.ephemeral_1h_input_tokens;

    assistantTextChars += t.textChars || 0;
    thinkingChars += t.thinkingChars || 0;
    toolUseInputChars += t.toolUseInputChars || 0;
    userTextChars += t.precedingUserTextChars || 0;
  }
  if (windowIncludesEnd) userTextChars += data.trailingUserTextChars || 0;

  const costByModel = {};
  let costTotal = 0;
  let hasUnknownModelCost = false;
  for (const [model, acc] of byModel.entries()) {
    const usage = {
      input_tokens: acc.input_tokens,
      output_tokens: acc.output_tokens,
      cache_read_input_tokens: acc.cache_read_input_tokens,
      cache_creation_input_tokens: acc.cache_creation_input_tokens,
      cache_creation: {
        ephemeral_1h_input_tokens: acc.ephemeral_1h_input_tokens,
        ephemeral_5m_input_tokens: acc.cache_creation_input_tokens - acc.ephemeral_1h_input_tokens,
      },
    };
    const cost = pricing.costFor(model, usage);
    costByModel[model] = { turns: acc.turns, tokens: usage, cost };
    if (cost.totalCost == null) hasUnknownModelCost = true;
    else costTotal += cost.totalCost;
  }

  const cacheDenom = totals.input_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens;
  const cacheHitRatio = cacheDenom > 0 ? totals.cache_read_input_tokens / cacheDenom : null;

  // Tool usage + top results + re-reads, filtered to the turn window.
  const toolUsage = {};
  const ensureTool = (name) => {
    if (!toolUsage[name]) toolUsage[name] = { count: 0, resultChars: 0, resultCount: 0 };
    return toolUsage[name];
  };
  for (const ev of data.toolUseEvents || []) {
    if (!inWindow(ev.turnIndex)) continue;
    ensureTool(ev.name).count += 1;
  }
  const windowedResults = [];
  for (const ev of data.toolResultEvents || []) {
    if (!inWindow(ev.turnIndex)) continue;
    const t = ensureTool(ev.name);
    t.resultChars += ev.chars;
    t.resultCount += 1;
    windowedResults.push(ev);
  }
  const topResults = windowedResults
    .slice()
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 10)
    .map((ev) => ({ ...ev, estTokens: estimateTokens(ev.chars) }));

  const readCounts = new Map();
  const bashCounts = new Map();
  for (const ev of data.toolUseEvents || []) {
    if (!inWindow(ev.turnIndex)) continue;
    if (ev.name === 'Read' && ev.input && typeof ev.input.file_path === 'string') {
      readCounts.set(ev.input.file_path, (readCounts.get(ev.input.file_path) || 0) + 1);
    } else if (ev.name === 'Bash' && ev.input && typeof ev.input.command === 'string') {
      bashCounts.set(ev.input.command, (bashCounts.get(ev.input.command) || 0) + 1);
    }
  }
  const reReadFiles = [...readCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  const reRunBashCommands = [...bashCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);

  const toolResultCharsTotal = Object.values(toolUsage).reduce((s, v) => s + v.resultChars, 0);
  const otherChars = thinkingChars + toolUseInputChars + userTextChars;
  const charTotalsSum = toolResultCharsTotal + assistantTextChars + otherChars;
  const charShare = (n) => (charTotalsSum > 0 ? n / charTotalsSum : null);

  return {
    file: data.file,
    sessionId: data.sessionId,
    firstTimestamp: data.firstTimestamp,
    lastTimestamp: data.lastTimestamp,
    turnCount: turns.length,
    totalTurnCount: allTurns.length,
    windowed: !!lastN,
    lastN,
    totals,
    contextSizeEnd,
    cacheHitRatio,
    costTotal,
    hasUnknownModelCost,
    costByModel,
    promptSizes,
    toolUsage,
    topResults,
    reReadFiles,
    reRunBashCommands,
    charTotals: {
      toolResultChars: toolResultCharsTotal,
      assistantTextChars,
      thinkingChars,
      toolUseInputChars,
      userTextChars,
      otherChars,
      total: charTotalsSum,
      toolResultShare: charShare(toolResultCharsTotal),
      assistantTextShare: charShare(assistantTextChars),
      otherShare: charShare(otherChars),
    },
    malformedLines: data.malformedLines,
    totalLines: data.totalLines,
  };
}

module.exports = {
  CHARS_PER_TOKEN,
  estimateTokens,
  encodeProjectDir,
  projectsRoot,
  projectDirFor,
  listProjectTranscripts,
  resolveTranscriptPath,
  contentToText,
  truncate,
  labelForTool,
  safeJsonStringify,
  summarizeTranscript,
  buildReport,
};
