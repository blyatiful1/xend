#!/usr/bin/env node
'use strict';
// Apply a profile's native Claude Code settings with a backup and a printed diff.
//   node setup.js <lite|balanced|aggressive> [--scope user|project] [--dry-run] [--undo] [--with-recommended]
// Conservative by design: only keys with a clear, evidence-backed effect are written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./lib/config.js');

// Project scope writes settings.local.json (gitignored by convention) so an experimental env var
// such as CLAUDE_CODE_EXTRA_BODY is never pushed to teammates; --scope project-shared targets
// the committed .claude/settings.json explicitly.
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
  fs.writeFileSync(file, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + COMPACT_INSTRUCTIONS);
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }

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
    if (!current || current.promptCacheTtl === undefined) changes.push({ path: ['promptCacheTtl'], value: '1h', reason: 'fewer cache misses across pauses longer than 5 minutes (write cost 2x vs 1.25x; already the default on subscriptions within included usage; skip on an API key with continuous traffic)' });
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
  const profileName = args.find((a) => config.PROFILES[a]);
  const scope = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : 'user';
  const dry = args.includes('--dry-run');
  const undo = args.includes('--undo');
  const withRecommended = args.includes('--with-recommended');
  const compactInstructions = args.includes('--compact-instructions');
  const cwd = process.cwd();
  const file = settingsPath(scope, cwd);

  if (undo) {
    const dir = path.dirname(file);
    const backups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(file) + '.xend-backup-')).sort() : [];
    if (!backups.length) { console.log('no xend backup found next to ' + file); return; }
    const latest = path.join(dir, backups[backups.length - 1]);
    fs.copyFileSync(latest, file);
    console.log('restored ' + file + ' from ' + latest);
    return;
  }
  if (compactInstructions) appendCompactInstructions(dry);
  if (!profileName) {
    if (!compactInstructions) { console.log('usage: setup.js <lite|balanced|aggressive> [--scope user|project|project-shared] [--dry-run] [--with-recommended] [--compact-instructions] [--undo]'); process.exitCode = 1; }
    return;
  }

  // 1) record the profile for xend itself
  const cfgFile = config.userConfigPath();
  const userCfg = config.readJson(cfgFile) || {};
  const profileChanged = userCfg.profile !== profileName;
  if (!dry) {
    userCfg.profile = profileName;
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify(userCfg, null, 2) + '\n');
  }
  console.log((dry ? '[dry-run] ' : '') + 'xend profile: ' + profileName + (profileChanged ? ' (written to ' + cfgFile + ')' : ' (unchanged)'));

  // 2) native settings
  const cfg = config.PROFILES[profileName];
  const current = readJson(file);
  const changes = planChanges(profileName, cfg, current, withRecommended);
  if (!changes.length) { console.log('no native settings changes for this profile' + (withRecommended ? '' : ' (add --with-recommended for promptCacheTtl, bashOutputMaxChars, MAX_MCP_OUTPUT_TOKENS; --compact-instructions for a CLAUDE.md compaction section)')); return; }
  console.log('settings file: ' + file);
  for (const c of changes) console.log('  ' + (c.value === undefined ? 'remove ' : 'set ') + c.path.join('.') + (c.value === undefined ? '' : ' = ' + (typeof c.value === 'string' ? c.value : JSON.stringify(c.value))) + '   # ' + c.reason);
  if (dry) return;
  const next = apply(current, changes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (current) {
    const backup = file + '.xend-backup-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, backup);
    console.log('backup: ' + backup);
  }
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  console.log('written. Restart Claude Code for env changes to take effect. Undo with: node setup.js --undo');
}

main();
