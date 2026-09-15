#!/usr/bin/env node
'use strict';
// PreCompact hook: write a checkpoint from the transcript so SessionStart(compact) can
// re-inject what the summary tends to lose (edited files, verification commands, requests).
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const checkpoint = require('./lib/checkpoint.js');

async function main() {
  const input = io.readHookInput();
  if (!input) return;
  const cfg = config.resolve({ cwd: input.cwd });
  if (cfg.checkpoint === false) return;
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  const data = await checkpoint.fromTranscript(input.transcript_path);
  checkpoint.mergeEdits(data, path.join(dir, 'edits.jsonl'));
  // keep manual notes written by /xend:checkpoint
  try {
    const prev = fs.readFileSync(path.join(dir, 'checkpoint.md'), 'utf8');
    const m = prev.match(/\nNotes:\n([\s\S]*)$/);
    if (m) data.notes = m[1];
  } catch (_) {}
  fs.writeFileSync(path.join(dir, 'checkpoint.md'), checkpoint.render(data, input.cwd));
}

main().catch((e) => io.debug('pre-compact error: ' + (e && e.stack || e))).then(() => process.exit(0));
