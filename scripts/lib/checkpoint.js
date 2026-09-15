'use strict';
// Build a compact checkpoint from a session transcript (JSONL): files edited, verification
// commands seen, recent user requests. Deterministic text, no timestamps.
const fs = require('fs');
const readline = require('readline');
const { execFileSync } = require('child_process');
const plan = require('./plan.js');

const VERIFY_RE = /\b(pytest|unittest|jest|vitest|mocha|npm (run )?(test|lint|build|typecheck)|pnpm (run )?(test|lint|build)|yarn (run )?(test|lint|build)|go (test|build|vet)|cargo (test|build|check|clippy)|make (test|check|lint)|tsc|eslint|ruff|mypy|flake8|black|prettier|rspec|phpunit|dotnet (test|build)|mvn|gradle)\b/;

async function fromTranscript(transcriptPath, opts) {
  opts = opts || {};
  const edited = new Map();
  const commands = [];
  const prompts = [];
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { edited: [], commands: [], prompts: [] };
  const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    const msg = rec.message;
    if (!msg) continue;
    if (rec.type === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b || b.type !== 'tool_use' || !b.input) continue;
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) {
          const f = b.input.file_path || b.input.notebook_path;
          if (f) edited.set(f, (edited.get(f) || 0) + 1);
        } else if (b.name === 'Bash' && typeof b.input.command === 'string' && VERIFY_RE.test(b.input.command)) {
          const c = b.input.command.trim().slice(0, 160);
          const i = commands.indexOf(c);
          if (i !== -1) commands.splice(i, 1);
          commands.push(c);
        }
      }
    } else if (rec.type === 'user' && !rec.isMeta) {
      let text = '';
      if (typeof msg.content === 'string') text = msg.content;
      else if (Array.isArray(msg.content)) text = msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
      text = text.trim();
      if (!text || text.startsWith('<') || text.startsWith('[')) continue;
      prompts.push(text.replace(/\s+/g, ' ').slice(0, 200));
    }
  }
  return {
    edited: Array.from(edited.entries()).map(([f, n]) => ({ file: f, edits: n })),
    commands: commands.slice(-8),
    prompts: prompts.slice(-3),
  };
}

function gitBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) { return ''; }
}

function render(data, cwd) {
  const lines = ['# xend checkpoint'];
  const branch = cwd ? gitBranch(cwd) : '';
  if (branch) lines.push('Branch: ' + branch);
  if (data.prompts.length) {
    lines.push('Recent requests:');
    for (const p of data.prompts) lines.push('- ' + p);
  }
  if (data.edited.length) {
    lines.push('Files edited this session:');
    for (const e of data.edited.slice(0, 30)) lines.push('- ' + e.file + (e.edits > 1 ? ' (' + e.edits + ' edits)' : ''));
    if (data.edited.length > 30) lines.push('- ... ' + (data.edited.length - 30) + ' more');
  }
  if (data.commands.length) {
    lines.push('Verification commands used:');
    for (const c of data.commands) lines.push('- ' + c);
  }
  // Plan.json survives on disk regardless; this is only so /clear and compaction (which re-inject
  // the checkpoint, not the plan file) keep the architect plan visible too.
  if (data.plan) {
    lines.push('Plan:');
    for (const l of plan.statusLines(data.plan)) lines.push(l);
  }
  // Notes stays last: pre-compact.js re-extracts it from the *previous* checkpoint.md with
  // /\nNotes:\n([\s\S]*)$/, which greedily captures to end-of-file.
  if (data.notes) lines.push('Notes:\n' + data.notes.trim());
  return lines.join('\n') + '\n';
}

// Merge the PostToolUse edit log (exact, not subject to transcript write lag).
function mergeEdits(data, editsFile) {
  let text = '';
  try { text = fs.readFileSync(editsFile, 'utf8'); } catch (_) { return data; }
  const counts = new Map(data.edited.map((e) => [e.file, e.edits]));
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.file) seen.set(r.file, (seen.get(r.file) || 0) + 1); } catch (_) {}
  }
  for (const [f, n] of seen) counts.set(f, Math.max(counts.get(f) || 0, n));
  data.edited = Array.from(counts.entries()).map(([file, edits]) => ({ file, edits }));
  return data;
}

module.exports = { fromTranscript, render, gitBranch, mergeEdits };
