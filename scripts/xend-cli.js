#!/usr/bin/env node
'use strict';
// xend CLI: small utilities used by skills and by people.
//   node xend-cli.js config [--cwd DIR]           print the resolved configuration
//   node xend-cli.js context [--cwd DIR]          print the session context block
//   node xend-cli.js state-dir <session-id>       print the per-session state directory
//   node xend-cli.js set <session-id> <key> <v>   set a session override (terse, shape, enabled)
//   node xend-cli.js profile [name]               print or set the user-level profile
//   node xend-cli.js note <session-id> <text...>  append a note to the session checkpoint
//   node xend-cli.js ponytail <session-id> [arg]  switch the lean level, or 'rules' / 'status'
//   node xend-cli.js outline <file> [--max N]     print a heuristic outline of a file
//   node xend-cli.js plan <sub> [args] [--session <id>] [--file <path>]
//       set               validate + write a plan (JSON via --file or stdin)
//       status            print per-task status, the verify command, scope warnings
//       next [--peek]     print ready briefs to dispatch; --peek: no state change
//       brief <id>        print one task's brief
//       done <id> PASS|FAIL [note]   record a manual verdict
//       reset <id>        back to todo (attempts kept)
//       show              print the raw plan JSON
const fs = require('fs');
const path = require('path');
const config = require('./lib/config.js');
const state = require('./lib/state.js');
const context = require('./lib/context.js');
const ponytail = require('./lib/ponytail.js');
const plan = require('./lib/plan.js');

function arg(name) { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : undefined; }


function textLabel(cfg) {
  return cfg.ponytailText === 'upstream' ? 'upstream-verbatim (measured)' : 'adapted (untested)';
}

function sessionPonytail(sid, cwd) {
  const dir = state.sessionDir(sid);
  const cfg = config.resolve({ cwd });
  const sess = state.sessionOverrides(dir);
  if (sess.ponytail) cfg.ponytail = sess.ponytail;
  if (sess.ponytailText) cfg.ponytailText = sess.ponytailText;
  const cached = state.readJson(path.join(dir, 'config.json'), null);
  const pt = (cached && cached.ponytailDetected) || ponytail.detect({ env: process.env, cwd });
  const o = ponytail.owns(pt, cfg);
  return { dir, cfg, sess, pt, owns: o };
}

function ponytailStatus(s) {
  const p = { upstreamOwns: s.owns.upstreamOwns, owns: s.owns.ownsLean, mode: s.pt.mode, root: s.pt.root, text: s.cfg.ponytailText, strict: s.cfg.ponytailStrict === true };
  const block = context.build(s.cfg, { ponytail: p });
  const lines = [
    'lean level: ' + s.cfg.ponytail + (s.sess.ponytail ? ' (session override)' : ''),
    'owner: ' + (s.owns.upstreamOwns ? 'ponytail plugin (xend defers; use /ponytail <level>)' : 'xend'),
    'text: ' + textLabel(s.cfg) + (p.strict ? ', strict (no xend bridging text)' : ''),
    'upstream: ' + (s.pt.installed ? 'installed via ' + s.pt.channel + (s.pt.version ? ' v' + s.pt.version : '') + (s.pt.root ? ' at ' + s.pt.root : '') + ', injecting=' + s.pt.injecting + ', mode=' + s.pt.mode : 'no evidence found'),
    'session block: ' + Buffer.byteLength(block) + ' B (~' + Math.round(Buffer.byteLength(block) / 3.8) + ' tok)',
    'evidence: ' + s.pt.evidence.join('; '),
  ];
  console.log(lines.join('\n'));
}

function ponytailCommand(sid, want, cwd) {
  const s = sessionPonytail(sid, cwd);
  if (want === 'status') return ponytailStatus(s);
  if (want === 'rules') {
    console.log('Full upstream ruleset: ' + ponytail.VENDOR_SKILL);
    console.log('These rules are already active in this session (' + textLabel(s.cfg) + '). Read the file for reference only; do not restate it in your reply.');
    return;
  }
  if (!config.PONYTAIL_LEVELS.includes(want)) {
    console.log('ponytail must be one of: ' + config.PONYTAIL_LEVELS.join(', ') + ', rules, status');
    process.exitCode = 1; return;
  }
  if (s.owns.upstreamOwns) {
    console.log('The ponytail plugin owns the lean ruleset this session (mode ' + s.pt.mode + '); xend cannot change its level. Run /ponytail ' + want + ' instead, and do not claim the level changed.');
    return;
  }
  if (s.cfg.ponytail === want) { console.log('Lean level already ' + want + '; nothing changed.'); return; }
  state.setSessionOverride(s.dir, 'ponytail', want);
  if (want === 'off') {
    state.setSessionOverride(s.dir, 'ponytailInjected', false);
    console.log('Lean off. Ignore the Lean block from the session start; no lean rules apply for the rest of this session.');
    return;
  }
  if (s.sess.ponytailInjected === true) { console.log(ponytail.levelDelta(want)); return; }
  const cold = Object.assign({}, s.cfg, { ponytail: want });
  const parts = context.ponytailParts(cold, { text: cold.ponytailText, strict: cold.ponytailStrict === true, root: s.pt.root });
  state.setSessionOverride(s.dir, 'ponytailInjected', parts.injected);
  console.log(parts.parts.join('\n\n'));
}

function parsePlanArgs(args) {
  const out = { session: undefined, file: undefined, peek: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--session') out.session = args[++i];
    else if (a === '--file') out.file = args[++i];
    else if (a === '--peek') out.peek = true;
    else out.positional.push(a);
  }
  return out;
}

function planCommand(sub, args, cwd) {
  const { session, file, peek, positional } = parsePlanArgs(args);
  const resolved = state.resolveSessionDir({ session, env: process.env, cwd });
  if (!resolved.dir) {
    console.log('no session found: pass --session <id>, or run this from a session xend has seen start');
    process.exitCode = 1;
    return;
  }
  const dir = resolved.dir;
  const sessionLine = () => { if (resolved.source !== 'arg') console.log('session: ' + resolved.id + ' (' + resolved.source + ')'); };
  const requirePlan = () => {
    const p = plan.load(dir);
    if (!p) { console.log('no plan set for this session'); process.exitCode = 1; }
    return p;
  };
  switch (sub) {
    case 'set': {
      let raw;
      try { raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'); }
      catch (e) { console.log('could not read plan input: ' + e.message); process.exitCode = 1; return; }
      let input;
      try { input = JSON.parse(raw); } catch (e) { console.log('invalid JSON: ' + e.message); process.exitCode = 1; return; }
      const v = plan.validate(input);
      if (!v.ok) { v.errors.forEach((e) => console.log(e)); process.exitCode = 1; return; }
      const p = plan.normalize(input);
      plan.save(dir, p);
      console.log('plan: ' + p.tasks.length + ' tasks, ' + plan.ready(p).length + ' ready');
      for (const t of p.tasks) {
        console.log(t.id + ' [' + t.tier + '] ' + t.title + ' — files: ' + t.files.join(', ') + ' — deps: ' + (t.deps.length ? t.deps.join(', ') : 'none'));
      }
      return;
    }
    case 'status': {
      const p = requirePlan(); if (!p) return;
      for (const line of plan.statusLines(p)) console.log(line);
      sessionLine();
      return;
    }
    case 'next': {
      const p = requirePlan(); if (!p) return;
      const result = plan.next(p, { peek });
      if (!peek) plan.save(dir, p);
      if (!result.dispatch.length && !result.self.length) {
        console.log(result.complete ? 'plan complete' : 'no ready tasks');
        return;
      }
      for (const d of result.dispatch) {
        console.log('subagent_type: ' + d.subagentType);
        console.log(d.brief);
        console.log('');
      }
      if (result.self.length) {
        console.log('do yourself:');
        for (const t of result.self) console.log(t.id + ': ' + (t.lastVerdict || t.title));
      }
      return;
    }
    case 'brief': {
      const p = requirePlan(); if (!p) return;
      const id = positional[0];
      const task = p.tasks.find((t) => t.id === id);
      if (!task) { console.log('unknown task: ' + id); process.exitCode = 1; return; }
      console.log(plan.brief(p, task));
      return;
    }
    case 'done': {
      const p = requirePlan(); if (!p) return;
      const [id, verdict, ...noteParts] = positional;
      const res = plan.markDone(p, id, verdict, noteParts.join(' '));
      if (!res.ok) { console.log(res.error); process.exitCode = 1; return; }
      plan.save(dir, p);
      console.log(plan.taskStatusLine(p, res.task));
      return;
    }
    case 'reset': {
      const p = requirePlan(); if (!p) return;
      const id = positional[0];
      const task = plan.reset(p, id);
      if (!task) { console.log('unknown task: ' + id); process.exitCode = 1; return; }
      plan.save(dir, p);
      console.log(plan.taskStatusLine(p, task));
      return;
    }
    case 'show': {
      const p = requirePlan(); if (!p) return;
      console.log(JSON.stringify(p, null, 2));
      return;
    }
    default:
      console.log('usage: xend-cli.js plan set|status|next|brief|done|reset|show');
      process.exitCode = 1;
  }
}

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
      console.log(context.build(cfg, { cliPath: __filename }));
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
      for (const [k, levels] of [['ponytail', config.PONYTAIL_LEVELS], ['ponytailText', config.PONYTAIL_TEXTS]]) {
        if (key !== k) continue;
        if (!levels.includes(String(value))) {
          console.log(k + ' must be one of: ' + levels.join(', '));
          process.exitCode = 1; return;
        }
        // line 40 above coerced the string 'off' to boolean false; session-start's
        // `if (overrides.ponytail)` would then skip it and the switch would silently do nothing.
        v = String(value);
      }
      state.setSessionOverride(dir, key, v);
      console.log('xend session override: ' + key + ' = ' + JSON.stringify(v));
      return;
    }
    case 'ponytail': {
      const [sid, rawArg] = rest;
      ponytailCommand(sid, String(rawArg || 'status').toLowerCase(), cwd);
      return;
    }
    case 'plan': {
      const [sub, ...planArgs] = rest;
      planCommand(sub, planArgs, cwd);
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
      console.log('usage: xend-cli.js config|context|state-dir|set|profile|note|ponytail|plan');
  }
}

main();
