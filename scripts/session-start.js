#!/usr/bin/env node
'use strict';
// SessionStart hook: inject the stable xend context block once per session start.
// On compact/clear: reset the dedupe registry and re-inject the checkpoint if one exists.
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const io = require('./lib/io.js');
const state = require('./lib/state.js');
const context = require('./lib/context.js');

function main() {
  const input = io.readHookInput() || {};
  const cfg = config.resolve({ cwd: input.cwd });
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  // cache the resolved config so per-tool-call hooks do not walk the filesystem again
  state.writeJson(path.join(dir, 'config.json'), cfg);
  const overrides = state.sessionOverrides(dir);
  if (overrides.terse) cfg.terse = overrides.terse;
  if (overrides.enabled === false) return;
  const source = input.source || 'startup';
  const opts = {};
  if (source === 'compact' || source === 'clear') {
    opts.reset = source;
    try { fs.unlinkSync(path.join(dir, 'dedupe.json')); } catch (_) {}
    if (cfg.checkpoint !== false) {
      try {
        const cp = fs.readFileSync(path.join(dir, 'checkpoint.md'), 'utf8');
        if (cp.trim()) opts.checkpoint = cp.slice(0, 2500);
      } catch (_) {}
    }
  }
  if (source === 'startup') state.pruneOld(process.env, 7);
  const block = context.build(cfg, opts);
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } });
}

try { main(); } catch (e) { io.debug('session-start error: ' + (e && e.stack || e)); }
process.exit(0);
