#!/usr/bin/env node
'use strict';
// xend doctor — static, offline audit of what is costing this project tokens.
//
//   node scripts/doctor.js [--cwd <dir>] [--json]
//
// Always exits 0: this is a report, not a gate.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const settingsLib = require('./lib/settings');
const transcript = require('./lib/transcript');
const pricing = require('./lib/pricing');

const CHARS_PER_TOKEN = transcript.CHARS_PER_TOKEN;
const IMPACT_RANK = { large: 0, medium: 1, small: 2 };

function estTokens(bytesOrChars) {
  return Math.round((bytesOrChars || 0) / CHARS_PER_TOKEN);
}

function finding(impact, category, title, found, why, fix, data) {
  return { impact, category, title, found, why, fix, data: data || null };
}

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function fmtInt(n) {
  return Math.round(n || 0).toLocaleString('en-US');
}

// --- CLI args ----------------------------------------------------------------

function parseArgs(argv) {
  const args = { cwd: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--cwd=')) args.cwd = a.slice('--cwd='.length);
  }
  return args;
}

// --- 1. Memory files -----------------------------------------------------------

function normalizeParagraph(p) {
  return p.replace(/\s+/g, ' ').trim().toLowerCase();
}

function splitParagraphs(content) {
  return content
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const DATE_LIKE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{2}:\d{2}(:\d{2})?\b|\btoday\b|\byesterday\b/i;
const AUTO_GENERATED_RE = /generated|auto-updated/i;

function checkMemoryFiles(cwd) {
  const findings = [];
  const { files, gitRoot } = settingsLib.collectMemoryFiles(cwd);

  if (!files.length) {
    findings.push(
      finding(
        'small',
        'memory',
        'No memory files found',
        `checked ~/.claude/CLAUDE.md, ./CLAUDE.md, ./.claude/CLAUDE.md, ./CLAUDE.local.md, ./.claude/rules/*.md` +
          (gitRoot ? `, and parent CLAUDE.md up to git root ${gitRoot}` : ' (no git root found, so no parent-directory walk)'),
        'n/a',
        'n/a'
      )
    );
    return findings;
  }

  const perFile = files.map((f) => ({ path: f.path, lines: f.lines, bytes: f.bytes, tokens: estTokens(f.bytes) }));
  const totalTokens = perFile.reduce((s, f) => s + f.tokens, 0);

  findings.push(
    finding(
      'small',
      'memory',
      `${files.length} memory file(s), ~${fmtInt(totalTokens)} est tokens total`,
      perFile.map((f) => `${f.path} (${fmtInt(f.lines)} lines, ${fmtInt(f.bytes)} bytes, ~${fmtInt(f.tokens)} tok)`).join('; '),
      'Every memory file is injected at session start and re-injected on /clear and compaction, so it is paid for on every turn.',
      'n/a (see specific findings below for what to trim)',
      { files: perFile }
    )
  );

  // Single file > 200 lines (Anthropic guidance).
  const oversized = perFile.filter((f) => f.lines > 200);
  if (oversized.length) {
    findings.push(
      finding(
        'medium',
        'memory',
        `${oversized.length} memory file(s) over 200 lines`,
        oversized.map((f) => `${f.path}: ${fmtInt(f.lines)} lines (~${fmtInt(f.tokens)} tok)`).join('; '),
        'Long memory files are read in full on every session start; Anthropic guidance caps CLAUDE.md at ~200 lines so the model can actually hold and use the whole thing.',
        `Split each oversized file: keep the ~200 most load-bearing lines in place, move the rest to a doc the model reads on demand (e.g. via a @path import next to the section that needs it, or a docs/ file linked from a short pointer line).`,
        { files: oversized }
      )
    );
  }

  // Total memory budget > 4000 est tokens.
  if (totalTokens > 4000) {
    findings.push(
      finding(
        'large',
        'memory',
        `Total memory is ~${fmtInt(totalTokens)} est tokens (over the 4,000 budget)`,
        `${files.length} file(s) summing to ${fmtInt(perFile.reduce((s, f) => s + f.bytes, 0))} bytes`,
        'This entire block is loaded before the first turn of every session and again after every /clear and every compaction, so it is a fixed per-session tax, not a one-time cost.',
        'Trim to the essentials Claude actually needs unprompted (conventions, gotchas, where things live); move reference material (API docs, long style guides, historical context) into files loaded on demand, or behind an @import used only where relevant.',
        { totalTokens }
      )
    );
  }

  // Near-duplicate paragraphs across 2+ files.
  const byNorm = new Map(); // normalized -> [{file, snippet, chars}]
  for (const f of files) {
    for (const p of splitParagraphs(f.content)) {
      if (p.length < 200) continue;
      const norm = normalizeParagraph(p);
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm).push({ file: f.path, snippet: truncate(p, 90), chars: p.length });
    }
  }
  const dupGroups = [...byNorm.entries()].filter(([, occ]) => new Set(occ.map((o) => o.file)).size >= 2);
  if (dupGroups.length) {
    let wastedChars = 0;
    const details = dupGroups.map(([, occ]) => {
      wastedChars += occ[0].chars * (occ.length - 1);
      return `"${occ[0].snippet}" in ${occ.map((o) => o.file).join(', ')}`;
    });
    findings.push(
      finding(
        'medium',
        'memory',
        `${dupGroups.length} near-duplicate paragraph(s) repeated across memory files`,
        details.join(' | '),
        'The same guidance loaded from two files is paid for twice on every session start, and duplicated instructions are also a common source of the model following the stale copy.',
        'Keep one canonical copy and reference it with an @path import from the other file(s) instead of repeating the text.',
        { wastedTokens: estTokens(wastedChars) }
      )
    );
  }

  // Cache-breaker smell: dates/timestamps in an auto-generated memory file.
  for (const f of files) {
    if (!AUTO_GENERATED_RE.test(f.content)) continue;
    const lines = f.content.split(/\r\n|\r|\n/);
    const hits = [];
    lines.forEach((line, i) => {
      if (DATE_LIKE_RE.test(line)) hits.push({ line: i + 1, text: truncate(line, 80) });
    });
    if (hits.length) {
      findings.push(
        finding(
          'medium',
          'memory',
          `${f.path} looks auto-generated and contains ${hits.length} date/timestamp line(s)`,
          hits.slice(0, 5).map((h) => `L${h.line}: ${h.text}`).join(' | ') + (hits.length > 5 ? ` (+${hits.length - 5} more)` : ''),
          'A timestamp or "today" in a file that is re-read every session invalidates the prompt cache on every regeneration, turning a normally-free re-read into a full-price cache write for everything after it in the prompt.',
          'Drop the literal date/time from the generated file (store it out-of-band, e.g. in a sibling .json, or only in a git commit message) so the memory file content is stable between regenerations.',
          { file: f.path, hits: hits.length }
        )
      );
    }
  }

  return findings;
}

// --- 2. Settings -----------------------------------------------------------

function envVal(env, key) {
  return env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
}

function collectHookCommands(hooks) {
  const out = []; // {event, matcher, command, timeout, async}
  if (!settingsLib.isPlainObject(hooks)) return out;
  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) {
      const hookList = m && Array.isArray(m.hooks) ? m.hooks : [];
      for (const h of hookList) {
        if (h && typeof h.command === 'string') {
          out.push({ event, matcher: m.matcher, command: h.command, timeout: h.timeout, async: h.async });
        }
      }
    }
  }
  return out;
}

function checkSettings(cwd) {
  const findings = [];
  const { merged, layers } = settingsLib.effectiveSettings(cwd);
  const anyLayerFound = layers.user.found || layers.project.found || layers.local.found;

  if (!anyLayerFound) {
    findings.push(
      finding(
        'small',
        'settings',
        'No settings.json found',
        `checked ${layers.user.path}, ${layers.project.path}, ${layers.local.path}`,
        'n/a',
        'n/a'
      )
    );
  }

  const effort = settingsLib.effectiveEffortLevel(merged);
  if (effort === null || effort === undefined) {
    findings.push(
      finding(
        'medium',
        'settings',
        'effortLevel is unset',
        'no effortLevel/effort key in any settings layer',
        'The unset default is high (xhigh on some models and hosts), which spends more thinking and tool-call tokens per turn than routine work needs. Effort is a quality lever: changing it mid-session also invalidates the prompt cache.',
        'Prefer per-task `/effort medium` over a global setting for routine sessions; reserve xhigh for problems that actually need the extra deliberation.',
        { effort }
      )
    );
  }

  const bashCap = merged.bashOutputMaxChars;
  if (bashCap === undefined) {
    findings.push(
      finding(
        'medium',
        'settings',
        'bashOutputMaxChars is unset',
        'no explicit cap (falls back to the Claude Code default, 30000)',
        'Every Bash tool result up to the cap is sent to the model in full; an uncapped-feeling 30000-char default lets one noisy command dominate a turn’s context.',
        'Set `bashOutputMaxChars` to 8000 if xend’s output shaping is enabled (it recovers the full output on demand), or 12000 if shaping is off.',
        { bashOutputMaxChars: bashCap }
      )
    );
  } else if (bashCap > 12000) {
    findings.push(
      finding(
        'medium',
        'settings',
        `bashOutputMaxChars is ${fmtInt(bashCap)} (over 12,000)`,
        `bashOutputMaxChars = ${fmtInt(bashCap)}`,
        'Large Bash output caps mean big command outputs (build logs, test runs, directory listings) are read into context near-verbatim on every call.',
        'Lower to 8000 with xend shaping enabled, or 12000 without it.',
        { bashOutputMaxChars: bashCap }
      )
    );
  }

  if (merged.promptCacheTtl === undefined) {
    findings.push(
      finding(
        'small',
        'settings',
        'promptCacheTtl is unset',
        'no explicit promptCacheTtl (defaults to the 5-minute cache)',
        'Interactive sessions with gaps over 5 minutes (review pauses, waiting on CI, context switches) fall out of the 5-minute cache and pay a full cache-write again on the next turn.',
        'Set `promptCacheTtl: "1h"` for interactive sessions with pauses > 5 min. Trade-off: a 1h cache write costs 2x the input price vs 1.25x for 5m, so it only pays off if the cache would otherwise have expired before reuse.',
        {}
      )
    );
  }

  if (merged.autoCompactWindow === undefined) {
    findings.push(
      finding(
        'small',
        'settings',
        'autoCompactWindow is unset (informational)',
        'no explicit autoCompactWindow',
        'Using the built-in default is fine; this is only worth tuning if compaction is firing more/less often than desired for this project’s context budget.',
        'No action needed unless you have observed compaction happening too early or too late; then set `autoCompactWindow` (or `CLAUDE_CODE_AUTO_COMPACT_WINDOW`) explicitly.',
        {}
      )
    );
  }

  const mcp = settingsLib.loadMcpConfig(cwd);
  const maxMcpOutput = envVal(merged.env, 'MAX_MCP_OUTPUT_TOKENS');
  if (mcp.total > 0 && maxMcpOutput === undefined) {
    findings.push(
      finding(
        'medium',
        'settings',
        `MAX_MCP_OUTPUT_TOKENS is unset with ${mcp.total} MCP server(s) configured`,
        `servers: ${[...mcp.byName.keys()].join(', ')}`,
        'MCP tool results have no built-in cap the way Bash/Read do; a chatty MCP server can return enormous payloads (full API responses, whole file trees) straight into context.',
        'Set env.MAX_MCP_OUTPUT_TOKENS to 10000 in settings.json to cap MCP tool results.',
        { servers: [...mcp.byName.keys()] }
      )
    );
  }

  if (merged.toolSearchEnabled === false) {
    findings.push(
      finding(
        'large',
        'settings',
        'toolSearchEnabled is explicitly false',
        'toolSearchEnabled: false',
        'Without tool search, every tool definition (including every MCP tool) is sent in full on every single turn instead of being loaded on demand, which is one of the largest fixed per-turn costs a project can carry once more than a handful of tools/servers are configured.',
        'Remove the override (or set `toolSearchEnabled: true`) unless a specific tool must always be eagerly available.',
        {}
      )
    );
  }

  const hookCommands = collectHookCommands(merged.hooks);
  const userPromptHooks = hookCommands.filter((h) => h.event === 'UserPromptSubmit');
  const likelyInjecting = userPromptHooks.filter((h) => /echo|cat\s|printf|additionalContext|inject/i.test(h.command));
  if (likelyInjecting.length) {
    findings.push(
      finding(
        'medium',
        'settings',
        `${likelyInjecting.length} UserPromptSubmit hook(s) likely inject context every turn`,
        likelyInjecting.map((h) => truncate(h.command, 90)).join(' | '),
        'A UserPromptSubmit hook runs (and its additionalContext output is added) on every single user message, so any non-trivial injected text is paid for on every turn rather than once per session.',
        'Move stable, session-scoped context to a SessionStart hook instead (runs once, cache-friendly); keep UserPromptSubmit hooks for truly per-turn signals only.',
        { commands: likelyInjecting.map((h) => h.command) }
      )
    );
  }

  const dateHooks = hookCommands.filter((h) => /\bdate\b|\$\(date/.test(h.command));
  if (dateHooks.length) {
    findings.push(
      finding(
        'medium',
        'settings',
        `${dateHooks.length} hook command(s) call \`date\` (cache-breaker)`,
        dateHooks.map((h) => `${h.event}: ${truncate(h.command, 80)}`).join(' | '),
        'A hook that embeds the current date/time into its output changes on every invocation, which invalidates the prompt cache from that point in the prompt onward for every subsequent turn.',
        'Drop the timestamp from hook output, or move it somewhere that is not re-injected into the prompt on every turn.',
        { commands: dateHooks.map((h) => h.command) }
      )
    );
  }

  if (envVal(merged.env, 'CLAUDE_CODE_EXTRA_BODY') !== undefined) {
    findings.push(
      finding(
        'small',
        'settings',
        'CLAUDE_CODE_EXTRA_BODY is set (informational)',
        `env.CLAUDE_CODE_EXTRA_BODY = ${truncate(JSON.stringify(merged.env.CLAUDE_CODE_EXTRA_BODY), 120)}`,
        'This is how server-side context editing (Anthropic’s `clear_tool_uses`) is enabled; it could be xend’s own L6 layer or a foreign integration.',
        'No action needed if this is xend’s aggressive-profile context editing; otherwise verify what set it before assuming xend controls it.',
        {}
      )
    );
  }

  return { findings, merged, mcp };
}

// --- 3. MCP ------------------------------------------------------------------

function checkMcp(mcp, merged) {
  const findings = [];
  if (mcp.total === 0) return findings;

  const bySourceCount = { user: 0, project: 0, local: 0 };
  for (const names of mcp.byName.values()) {
    for (const s of names) bySourceCount[s] = (bySourceCount[s] || 0) + 1;
  }
  findings.push(
    finding(
      'small',
      'mcp',
      `${mcp.total} MCP server(s) configured`,
      `user: ${bySourceCount.user}, project: ${bySourceCount.project}, local: ${bySourceCount.local} -- ${[...mcp.byName.keys()].join(', ')}`,
      'Each MCP server contributes tool definitions to every turn’s context unless tool search is on.',
      'n/a (see the tool-search finding if this list is long)',
      { servers: [...mcp.byName.keys()] }
    )
  );

  if (mcp.total > 5 && merged.toolSearchEnabled !== true) {
    findings.push(
      finding(
        'medium',
        'mcp',
        `${mcp.total} MCP servers configured but toolSearchEnabled is not confirmed on`,
        `toolSearchEnabled = ${JSON.stringify(merged.toolSearchEnabled)}`,
        'With more than a handful of MCP servers, their combined tool definitions can be a significant fraction of a turn’s fixed overhead when loaded eagerly instead of on demand.',
        'Set `toolSearchEnabled: true` so tool definitions load on demand via search instead of being sent in full every turn.',
        {}
      )
    );
  }

  return findings;
}

// --- 4. Plugins ----------------------------------------------------------------

function hasClaudeBinary() {
  try {
    execFileSync('claude', ['--version'], { timeout: 10000, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

function pluginNames(enabledPlugins) {
  if (!enabledPlugins) return [];
  if (Array.isArray(enabledPlugins)) return enabledPlugins.filter((x) => typeof x === 'string');
  if (typeof enabledPlugins === 'object') {
    return Object.keys(enabledPlugins).filter((k) => enabledPlugins[k] !== false);
  }
  return [];
}

function checkPlugins(merged) {
  const findings = [];
  const names = pluginNames(merged.enabledPlugins);
  if (!names.length) return findings;

  const canRunClaude = hasClaudeBinary();
  const details = names.map((name) => {
    let costInfo = null;
    if (canRunClaude) {
      try {
        const out = execFileSync('claude', ['plugin', 'details', name], { timeout: 10000, encoding: 'utf8' });
        const m = /([\d,]+)\s*tokens?/i.exec(out);
        costInfo = m ? `${m[1]} tokens (projected)` : truncate(out, 120);
      } catch (_) {
        costInfo = null; // ignore failures per spec
      }
    }
    return { name, costInfo };
  });

  findings.push(
    finding(
      'small',
      'plugins',
      `${names.length} plugin(s) enabled`,
      details.map((d) => `${d.name}${d.costInfo ? ` (${d.costInfo})` : ''}`).join(', '),
      'Each enabled plugin can add skills, hooks, and tool definitions that are part of the fixed per-turn overhead.',
      canRunClaude ? 'n/a' : 'Install the `claude` CLI on PATH to get projected per-plugin token cost here.',
      { plugins: details }
    )
  );

  return findings;
}

// --- 5. Recent usage -------------------------------------------------------------

async function checkRecentUsage(cwd) {
  const findings = [];
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - sevenDaysMs;
  const all = transcript.listProjectTranscripts(cwd, { recursive: true });
  const recent = all
    .filter((f) => f.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 50);

  if (!recent.length) {
    findings.push(
      finding(
        'small',
        'usage',
        'No transcripts from the last 7 days',
        `checked ${transcript.projectDirFor(cwd)}`,
        'n/a',
        'n/a'
      )
    );
    return findings;
  }

  const totals = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const byModel = new Map(); // model -> {turns, tokens, cost}
  let turnCount = 0;
  let filesProcessed = 0;

  for (const f of recent) {
    let data;
    try {
      data = await transcript.summarizeTranscript(f.file, { trackTools: false });
    } catch (_) {
      continue; // unreadable file: skip, do not crash the audit
    }
    filesProcessed++;
    const report = transcript.buildReport(data);
    turnCount += report.turnCount;
    for (const k of Object.keys(totals)) totals[k] += report.totals[k];
    for (const [model, entry] of Object.entries(report.costByModel)) {
      if (!byModel.has(model)) byModel.set(model, { turns: 0, cost: 0, hasUnknownCost: false });
      const acc = byModel.get(model);
      acc.turns += entry.turns;
      if (entry.cost.totalCost == null) acc.hasUnknownCost = true;
      else acc.cost += entry.cost.totalCost;
    }
  }

  const cacheDenom = totals.input_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens;
  const cacheHitRatio = cacheDenom > 0 ? totals.cache_read_input_tokens / cacheDenom : null;
  const costTotal = [...byModel.values()].reduce((s, v) => s + v.cost, 0);

  findings.push(
    finding(
      'small',
      'usage',
      `Recent usage: ${filesProcessed} transcript(s), ${fmtInt(turnCount)} turns, last 7 days`,
      `input ${fmtInt(totals.input_tokens)}, cache-create ${fmtInt(totals.cache_creation_input_tokens)}, cache-read ${fmtInt(totals.cache_read_input_tokens)}, output ${fmtInt(totals.output_tokens)} -- cache hit ratio ${cacheHitRatio == null ? 'n/a' : (cacheHitRatio * 100).toFixed(1) + '%'} -- est cost $${costTotal.toFixed(2)}`,
      'This is the actual recent token/cost footprint this audit’s other findings are trying to reduce.',
      'n/a',
      { totals, byModel: Object.fromEntries(byModel), cacheHitRatio, costTotal }
    )
  );

  if (cacheHitRatio !== null && cacheHitRatio < 0.7) {
    findings.push(
      finding(
        'large',
        'usage',
        `Cache hit ratio is only ${(cacheHitRatio * 100).toFixed(1)}% over the last 7 days (target >= 70%)`,
        `cache-read ${fmtInt(totals.cache_read_input_tokens)} of ${fmtInt(cacheDenom)} total input tokens across ${filesProcessed} transcript(s)`,
        'A low cache hit ratio means most of the context is being paid for at full (or cache-write) price on every turn instead of the ~10x-cheaper cache-read price, which is usually the single biggest lever on cost.',
        'Likely causes to check: many short sessions instead of a few long ones, frequent /clear, switching model or effort level mid-session (each switch invalidates the cache), or a hook that injects dynamic (e.g. timestamped) text into every prompt.',
        { cacheHitRatio }
      )
    );
  }

  return findings;
}

// --- 6. Environment -------------------------------------------------------------

function binaryExists(cmd) {
  try {
    execFileSync(cmd, ['--version'], { timeout: 5000, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

// Languages with code-intelligence (LSP) plugins: "go to definition" replaces grep-then-read-many.
const LSP_HINTS = [
  ['.ts,.tsx,.js,.jsx', 'typescript'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java,.kt', 'jvm'],
  ['.rb', 'ruby'],
  ['.cs', 'csharp'],
];

function countSourceFiles(root, maxFiles) {
  const counts = new Map();
  let seen = 0;
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.venv', 'venv', '__pycache__']);
  const stack = [root];
  while (stack.length && seen < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (seen >= maxFiles) break;
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name)); continue; }
      seen++;
      const ext = path.extname(e.name).toLowerCase();
      if (ext) counts.set(ext, (counts.get(ext) || 0) + 1);
    }
  }
  return counts;
}

function checkLsp(cwd) {
  const counts = countSourceFiles(cwd, 5000);
  const hits = [];
  for (const [exts, lang] of LSP_HINTS) {
    const n = exts.split(',').reduce((a, x) => a + (counts.get(x) || 0), 0);
    if (n >= 20) hits.push(`${lang} (${n} files)`);
  }
  if (!hits.length) return [];
  return [finding(
    'medium',
    'environment',
    'Code-intelligence (LSP) plugin recommended for this repository',
    `source files by language: ${hits.join(', ')}`,
    'Without a language server, locating a definition or its callers means grep followed by reading several candidate files; Anthropic lists LSP plugins among its token-reduction recommendations because "go to definition" replaces that read fan-out.',
    'Install the matching plugin from the official marketplace (Claude Code: /plugin, search for the language), then prefer its definition/references tools over grep-and-read for navigation.',
    { languages: hits }
  )];
}

function checkEnvironment() {
  const findings = [];
  const py = binaryExists('python3');
  const jq = binaryExists('jq');
  findings.push(
    finding(
      'small',
      'environment',
      `Node ${process.version}; python3 ${py ? 'available' : 'not found'}; jq ${jq ? 'available' : 'not found'} (informational)`,
      `node=${process.version} python3=${py} jq=${jq}`,
      'n/a',
      'n/a',
      { node: process.version, python3: py, jq }
    )
  );
  return findings;
}

// --- output ------------------------------------------------------------------

function printText(findings) {
  const sorted = findings.slice().sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]);
  const lines = [];
  lines.push('xend doctor');
  lines.push('');
  let n = 1;
  for (const f of sorted) {
    lines.push(`[${f.impact.toUpperCase()}] #${n} (${f.category}) ${f.title}`);
    lines.push(`  found: ${f.found}`);
    if (f.why && f.why !== 'n/a') lines.push(`  why:   ${f.why}`);
    if (f.fix && f.fix !== 'n/a') lines.push(`  fix:   ${f.fix}`);
    lines.push('');
    n++;
  }
  const counts = { large: 0, medium: 0, small: 0 };
  for (const f of findings) counts[f.impact]++;
  lines.push(`${findings.length} findings: ${counts.large} large, ${counts.medium} medium, ${counts.small} small`);
  console.log(lines.join('\n'));
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

  const findings = [];
  const safe = (fn) => {
    try {
      return fn();
    } catch (err) {
      return [finding('small', 'internal', 'A doctor check failed', String((err && err.message) || err), 'n/a', 'n/a')];
    }
  };

  findings.push(...safe(() => checkMemoryFiles(cwd)));
  const settingsResult = safe(() => checkSettings(cwd)) || {};
  const settingsFindings = Array.isArray(settingsResult) ? settingsResult : settingsResult.findings || [];
  const merged = Array.isArray(settingsResult) ? {} : settingsResult.merged || {};
  const mcp = Array.isArray(settingsResult) ? settingsLib.loadMcpConfig(cwd) : settingsResult.mcp || settingsLib.loadMcpConfig(cwd);
  findings.push(...settingsFindings);
  findings.push(...safe(() => checkMcp(mcp, merged)));
  findings.push(...safe(() => checkPlugins(merged)));

  try {
    findings.push(...(await checkRecentUsage(cwd)));
  } catch (err) {
    findings.push(finding('small', 'internal', 'Recent usage scan failed', String((err && err.message) || err), 'n/a', 'n/a'));
  }

  findings.push(...safe(() => checkEnvironment()));
  findings.push(...safe(() => checkLsp(cwd)));

  if (args.json) {
    const counts = { large: 0, medium: 0, small: 0 };
    for (const f of findings) counts[f.impact]++;
    console.log(JSON.stringify({ cwd, findings, summary: { total: findings.length, ...counts } }, null, 2));
  } else {
    printText(findings);
  }
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch((err) => {
    // Even a fatal error still reports something and exits 0, per spec.
    console.error('xend doctor: internal error: ' + ((err && err.stack) || err));
    process.exitCode = 0;
  });
}

module.exports = {
  finding,
  truncate,
  normalizeParagraph,
  splitParagraphs,
  DATE_LIKE_RE,
  AUTO_GENERATED_RE,
  checkMemoryFiles,
  checkSettings,
  checkMcp,
  checkPlugins,
  checkRecentUsage,
  checkEnvironment,
  collectHookCommands,
  pluginNames,
  parseArgs,
  main,
};
