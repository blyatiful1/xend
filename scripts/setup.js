#!/usr/bin/env node
'use strict';
// Apply a profile's native Claude Code settings with a backup and a printed diff.
//   node setup.js <lite|balanced|aggressive> [--scope user|project|project-shared] [--dry-run] [--undo]
//                 [--with-recommended] [--compact-instructions] [--install-ponytail]
//   node setup.js                  (no arguments) a dry run of balanced
// Conservative by design: only keys with a clear, evidence-backed effect are written, an existing
// file is always backed up first, and a file that does not parse is never overwritten.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./lib/config.js');

// Project scope writes settings.local.json (gitignored by convention) so an experimental env var
// such as CLAUDE_CODE_EXTRA_BODY is never pushed to teammates; --scope project-shared targets
// the committed .claude/settings.json explicitly.
const { execFileSync } = require('child_process');
// setup.js is also required by tests (planChanges, readSettings); main() only runs as a script.
const ponytailLib = require('./lib/ponytail.js');

const PONYTAIL_INSTALL = [
  ['claude', ['plugin', 'marketplace', 'add', 'DietrichGebert/ponytail']],
  ['claude', ['plugin', 'install', 'ponytail@ponytail', '-s', 'user', '-y']],
];

// Report who owns the lean ruleset. Never edits ~/.config/ponytail/config.json or another
// plugin's enabledPlugins: xend does not silently reconfigure someone else's plugin.
function ponytailStep(profileName, cwd, install, dry) {
  const pt = ponytailLib.detect({ env: process.env, cwd });
  const prof = config.PROFILES[profileName];
  console.log('');
  console.log('lean (ponytail) rules: level ' + prof.ponytail + ', text ' + prof.ponytailText +
    (prof.ponytailText === 'upstream' ? ' (upstream-verbatim, the measured artifact)' : " (xend's adaptation, untested)"));
  if (pt.injecting) {
    console.log('  upstream ponytail is installed via ' + pt.channel + ' and injecting (mode ' + pt.mode + '); xend defers to it.');
    console.log('  cost: upstream ~1,382 tok/session vs xend\'s adapted rules ~295 tok/session.');
    console.log('  to use xend\'s cheaper text instead: XEND_UPSTREAM_PONYTAIL=ignore');
    console.log('  to silence upstream instead: PONYTAIL_DEFAULT_MODE=off (or claude plugin disable ponytail)');
    return;
  }
  if (pt.channel === 'skill-only') console.log('  ponytail is present as a bare skill at ' + pt.root + ', which self-activates zero times.');
  else console.log('  no injecting upstream ponytail found; xend owns the ruleset.');
  console.log('  for the upstream-verbatim ruleset (MIT, Dietrich Gebert) install it yourself:');
  for (const [cmd, argv] of PONYTAIL_INSTALL) console.log('    ' + cmd + ' ' + argv.join(' '));
  if (!install) { console.log('  (add --install-ponytail to run those two commands now; --with-recommended never does)'); return; }
  if (dry) { console.log('  [dry-run] would run the two commands above'); return; }
  for (const [cmd, argv] of PONYTAIL_INSTALL) {
    try { execFileSync(cmd, argv, { stdio: 'inherit' }); }
    catch (e) { console.log('  could not run "' + cmd + ' ' + argv.join(' ') + '"; run it by hand.'); break; }
  }
}

function settingsPath(scope, cwd) {
  if (scope === 'project') return path.join(cwd, '.claude', 'settings.local.json');
  if (scope === 'project-shared') return path.join(cwd, '.claude', 'settings.json');
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

const COMPACT_INSTRUCTIONS = `
# Compact instructions
When compacting, keep exact file paths that were read or edited, the exact test and build commands
used, names of failing tests, decisions made and open items. Drop narration, restated diffs, and
passing-test output.
`;

function appendCompactInstructions(dry) {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'CLAUDE.md');
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch (_) {}
  if (/^# Compact instructions/m.test(cur)) { console.log('compact instructions already present in ' + file); return; }
  console.log((dry ? '[dry-run] ' : '') + 'append "# Compact instructions" section to ' + file);
  if (dry) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b = backup(file);
  if (b) console.log('backup: ' + b);
  fs.writeFileSync(file, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + COMPACT_INSTRUCTIONS);
}

// { value } for a readable file (null when it does not exist), { error } when it exists but does not
// parse: a settings file with a comment, a trailing comma or a stray byte must be fixed by hand,
// never replaced by a fresh object that drops the user's permissions and env.
function readSettings(f) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { value: null } : { error: e.message }; }
  if (!raw.replace(/^\uFEFF/, '').trim()) return { value: null };
  try {
    const v = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { error: 'not a JSON object' };
    return { value: v };
  } catch (e) { return { error: e.message }; }
}

// kind 'backup' copies are what --undo restores; 'undo-kept' (the file an --undo replaced) is kept
// under another name, so a second --undo still reaches the original and never swaps back and forth.
function backup(file, kind) {
  if (!fs.existsSync(file)) return null;
  const b = file + '.xend-' + (kind || 'backup') + '-' + new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, b);
  return b;
}

function contextEditingBody(ce) {
  return JSON.stringify({
    context_management: {
      edits: [{
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'input_tokens', value: ce.triggerTokens },
        keep: { type: 'tool_uses', value: ce.keepToolUses },
        clear_at_least: { type: 'input_tokens', value: ce.clearAtLeastTokens },
      }],
    },
  });
}

function planChanges(profileName, cfg, current, withRecommended) {
  const changes = []; // {path: ['env','X'], value, reason}
  const env = (current && current.env) || {};
  if (cfg.contextEditing && cfg.contextEditing.enabled) {
    changes.push({ path: ['env', 'CLAUDE_CODE_EXTRA_BODY'], value: contextEditingBody(cfg.contextEditing),
      reason: 'server-side clearing of old tool results (context editing); experimental. Each pass re-caches the remaining context, so it pays off only on sessions that continue ~20+ turns after a pass; see docs/RESEARCH.md H4' });
  } else if (env.CLAUDE_CODE_EXTRA_BODY && /context_management/.test(env.CLAUDE_CODE_EXTRA_BODY)) {
    changes.push({ path: ['env', 'CLAUDE_CODE_EXTRA_BODY'], value: undefined, reason: 'profile ' + profileName + ' does not use context editing' });
  }
  if (withRecommended) {
    if (!env.MAX_MCP_OUTPUT_TOKENS) changes.push({ path: ['env', 'MAX_MCP_OUTPUT_TOKENS'], value: '10000', reason: 'cap MCP tool results (default 25000)' });
    // promptCacheTtl is deliberately not here: the 1-hour cache costs 2x input per cache write
    // against 1.25x for 5 minutes, which only pays off with pauses over 5 minutes between turns.
    if (!current || current.bashOutputMaxChars === undefined) changes.push({ path: ['bashOutputMaxChars'], value: 20000, reason: 'native head-only cap for Bash output (default 30000); the full output is still persisted to a file by Claude Code' });
  }
  return changes;
}

function apply(obj, changes) {
  const out = JSON.parse(JSON.stringify(obj || {}));
  for (const c of changes) {
    let cur = out;
    for (let i = 0; i < c.path.length - 1; i++) {
      if (typeof cur[c.path[i]] !== 'object' || cur[c.path[i]] === null) cur[c.path[i]] = {};
      cur = cur[c.path[i]];
    }
    const last = c.path[c.path.length - 1];
    if (c.value === undefined) delete cur[last]; else cur[last] = c.value;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const profileArg = args.find((a) => config.PROFILES[a]);
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'user';
  let dry = args.includes('--dry-run');
  const undo = args.includes('--undo');
  const withRecommended = args.includes('--with-recommended');
  const compactInstructions = args.includes('--compact-instructions');
  const installPonytail = args.includes('--install-ponytail');
  const cwd = process.cwd();
  const file = settingsPath(scope, cwd);
  // /xend:setup with no arguments previews the default profile and changes nothing
  let profileName = profileArg;
  if (!args.length || (args.length === 1 && dry)) {
    profileName = 'balanced';
    dry = true;
    console.log('(no profile given: dry run of balanced; nothing is written)');
  }

  if (undo) {
    const dir = path.dirname(file);
    const backups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(file) + '.xend-backup-')).sort() : [];
    if (!backups.length) { console.log('no xend backup found next to ' + file); return; }
    const latest = path.join(dir, backups[backups.length - 1]);
    if (dry) { console.log('[dry-run] would restore ' + file + ' from ' + latest); return; }
    const kept = backup(file, 'undo-kept');
    fs.copyFileSync(latest, file);
    console.log('restored ' + file + ' from ' + latest + (kept ? ' (the replaced file is kept at ' + kept + ')' : ''));
    return;
  }
  if (!profileName) {
    if (compactInstructions) appendCompactInstructions(dry);
    if (!compactInstructions && !installPonytail) { console.log('usage: setup.js <lite|balanced|aggressive> [--scope user|project|project-shared] [--dry-run] [--with-recommended] [--compact-instructions] [--install-ponytail] [--undo]'); process.exitCode = 1; }
    if (installPonytail) ponytailStep('balanced', cwd, true, dry);
    return;
  }

  // Read both files before writing anything, so an unreadable one stops the run with nothing changed.
  const cfgFile = config.userConfigPath();
  const userRead = readSettings(cfgFile);
  const settingsRead = readSettings(file);
  for (const [f, r] of [[cfgFile, userRead], [file, settingsRead]]) {
    if (r.error) {
      console.log('cannot parse ' + f + ' (' + r.error + '); nothing was changed. Fix or remove it, then run setup again.');
      process.exitCode = 1;
      return;
    }
  }
  if (compactInstructions) appendCompactInstructions(dry);

  // 1) record the profile for xend itself
  const userCfg = userRead.value || {};
  const profileChanged = userCfg.profile !== profileName;
  if (!dry && profileChanged) {
    userCfg.profile = profileName;
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    const b = backup(cfgFile);
    fs.writeFileSync(cfgFile, JSON.stringify(userCfg, null, 2) + '\n');
    if (b) console.log('backup: ' + b);
  }
  console.log((dry ? '[dry-run] ' : '') + 'xend profile: ' + profileName + (profileChanged ? (dry ? ' (would be written to ' : ' (written to ') + cfgFile + ')' : ' (unchanged)'));

  // 2) lean (ponytail) ruleset ownership; installs the third-party plugin only when asked by name
  ponytailStep(profileName, cwd, installPonytail, dry);

  // 3) native settings
  const cfg = config.PROFILES[profileName];
  const current = settingsRead.value;
  const changes = planChanges(profileName, cfg, current, withRecommended);
  if (!changes.length) { console.log('no native settings changes for this profile' + (withRecommended ? '' : ' (add --with-recommended for bashOutputMaxChars and MAX_MCP_OUTPUT_TOKENS; --compact-instructions for a CLAUDE.md compaction section)')); return; }
  console.log('settings file: ' + file);
  for (const c of changes) console.log('  ' + (c.value === undefined ? 'remove ' : 'set ') + c.path.join('.') + (c.value === undefined ? '' : ' = ' + (typeof c.value === 'string' ? c.value : JSON.stringify(c.value))) + '   # ' + c.reason);
  if (dry) return;
  const next = apply(current, changes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const b = backup(file);
  if (b) console.log('backup: ' + b);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log('written. Restart Claude Code for env changes to take effect. Undo with: /xend:setup --undo');
}

if (require.main === module) main();

module.exports = { planChanges, readSettings, apply };
