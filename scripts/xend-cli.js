#!/usr/bin/env node
'use strict';
// xend CLI: small utilities used by skills and by people.
//   node xend-cli.js config [--cwd DIR]           print the resolved configuration
//   node xend-cli.js context [--cwd DIR]          print the session context block
//   node xend-cli.js state-dir <session-id>       print the per-session state directory
//   node xend-cli.js set <session-id> <key> <v>   set a session override (terse, shape, enabled)
//   node xend-cli.js profile [name]               print or set the user-level profile
//   node xend-cli.js note <session-id> <text...>  append a note to the session checkpoint
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const state = require('./lib/state.js');
const context = require('./lib/context.js');

function arg(name) { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : undefined; }

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cwd = arg('--cwd') || process.cwd();
  switch (cmd) {
    case 'config': {
      const cfg = config.resolve({ cwd });
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }
    case 'context': {
      const cfg = config.resolve({ cwd });
      console.log(context.build(cfg, {}));
      return;
    }
    case 'state-dir': {
      console.log(state.sessionDir(rest[0]));
      return;
    }
    case 'set': {
      const [sid, key, value] = rest;
      const dir = state.sessionDir(sid);
      let v = value;
      if (value === 'true' || value === 'on') v = true;
      else if (value === 'false' || value === 'off') v = false;
      if (key === 'terse' && !config.TERSE_LEVELS.includes(String(value))) {
        console.log('terse must be one of: ' + config.TERSE_LEVELS.join(', '));
        process.exitCode = 1; return;
      }
      if (key === 'terse' && value === 'off') v = 'off';
      state.setSessionOverride(dir, key, v);
      console.log('xend session override: ' + key + ' = ' + JSON.stringify(v));
      return;
    }
    case 'profile': {
      const file = config.userConfigPath();
      if (!rest[0]) {
        const cfg = config.resolve({ cwd });
        console.log('profile: ' + cfg.profile + ' (terse ' + cfg.terse + ')' + (cfg.sources.length ? '\nsources: ' + cfg.sources.join(', ') : ''));
        return;
      }
      if (!config.PROFILES[rest[0]]) { console.log('unknown profile: ' + rest[0] + ' (lite | balanced | aggressive)'); process.exitCode = 1; return; }
      const cur = config.readJson(file) || {};
      cur.profile = rest[0];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n');
      console.log('profile set to ' + rest[0] + ' in ' + file + ' (applies to new sessions; use /xend:setup to apply native settings)');
      return;
    }
    case 'note': {
      const [sid, ...words] = rest;
      const dir = state.sessionDir(sid);
      const f = path.join(dir, 'checkpoint.md');
      let cur = '';
      try { cur = fs.readFileSync(f, 'utf8'); } catch (_) { cur = '# xend checkpoint\n'; }
      if (!/\nNotes:\n/.test(cur)) cur += '\nNotes:\n';
      cur += words.join(' ') + '\n';
      fs.writeFileSync(f, cur);
      console.log('checkpoint updated: ' + f);
      return;
    }
    default:
      console.log('usage: xend-cli.js config|context|state-dir|set|profile|note');
  }
}

main();
