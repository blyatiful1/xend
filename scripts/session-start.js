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
const ponytail = require('./lib/ponytail.js');

function main() {
  const input = io.readHookInput() || {};
  const cfg = config.resolve({ cwd: input.cwd });
  const dir = state.sessionDir(input.session_id, process.env, input.scratchpad_dir);
  // pointers so the CLI (run from a skill or a shell, outside this hook's stdin) can find this
  // session's state dir without a --session argument
  state.writeSessionPointers(process.env, input.session_id, dir, input.cwd);
  // detect once per session; the cached config carries it so no later hook re-walks the tree
  const pt = ponytail.detect({ env: process.env, cwd: input.cwd });
  cfg.ponytailDetected = pt;
  // cache the resolved config so per-tool-call hooks do not walk the filesystem again
  state.writeJson(path.join(dir, 'config.json'), cfg);
  const overrides = state.sessionOverrides(dir);
  if (overrides.terse) cfg.terse = overrides.terse;
  if (overrides.ponytail) cfg.ponytail = overrides.ponytail;
  if (overrides.ponytailText) cfg.ponytailText = overrides.ponytailText;
  if (overrides.architect === false) cfg.architect = Object.assign({}, cfg.architect, { enabled: false });
  if (overrides.enabled === false) return;
  const source = input.source || 'startup';
  const opts = { cliPath: path.join(__dirname, 'xend-cli.js') };
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
  const o = ponytail.owns(pt, cfg);
  opts.ponytail = {
    owns: o.ownsLean, upstreamOwns: o.upstreamOwns, injecting: o.injecting,
    mode: pt.mode, channel: pt.channel, root: pt.root,
    text: cfg.ponytailText, strict: cfg.ponytailStrict === true,
  };
  // the switcher reads this to choose between a small delta and a cold inject
  state.setSessionOverride(dir, 'ponytailInjected', context.ponytailParts(cfg, opts.ponytail).injected);
  const block = context.build(cfg, opts);
  io.writeHookOutput({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: block } });
}

try { main(); } catch (e) { io.debug('session-start error: ' + (e && e.stack || e)); }
process.exit(0);
