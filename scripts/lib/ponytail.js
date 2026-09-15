'use strict';
// ponytail integration: the only module in xend that turns upstream bytes into text.
//
// Upstream: ponytail 4.10.0 by Dietrich Gebert (@DietrichGebert),
// https://github.com/DietrichGebert/ponytail, MIT ("Copyright (c) 2026 DietrichGebert").
// The verbatim ruleset lives in vendor/ponytail/SKILL.md; see THIRD_PARTY_NOTICES.md and
// vendor/ponytail/PROVENANCE.md.
//
// filterSkillBodyForMode reproduces upstream's documented filter behaviour; do not
// "improve" it — its two guard conditions (a table row whose bold label is not a mode; a
// bullet that needs a quoted value to count as a worked example) encode bugs upstream
// already fixed, and diverging silently changes the injected text.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PONYTAIL_LEVELS = ['off', 'lite', 'full', 'ultra'];
const PONYTAIL_TEXTS = ['adapted', 'upstream'];
const UPSTREAM_MODES = ['auto', 'yield', 'ignore'];
const DEFAULT_MODE = 'full';

// vendor/ponytail/SKILL.md, whole file and body-after-frontmatter. Pinned in
// vendor/ponytail/PROVENANCE.md and asserted by tests/ponytail.test.js.
const FILE_SHA256 = '1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2';
const BODY_SHA256 = '4e7382857d47d796bd20454c6d10318293fd3724efef6cc1e90cdf589e765e24';

const VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor', 'ponytail');
const VENDOR_SKILL = path.join(VENDOR_DIR, 'SKILL.md');

function normalizeMode(m) {
  const s = String(m == null ? '' : m).trim().toLowerCase();
  return s === 'lite' || s === 'full' || s === 'ultra' ? s : null;
}

// Port of upstream getPonytailInstructions' filter. Both guard comments are upstream's.
function filterSkillBodyForMode(body, mode) {
  const eff = normalizeMode(mode) || DEFAULT_MODE;
  const wf = String(body || '').replace(/^---[\s\S]*?---\s*/, '');
  return wf.split(/\r?\n/).filter((line) => {
    // Only the intensity table rows and worked examples are mode-specific, and both are
    // keyed by a mode name. A bullet whose label is not a mode — e.g. "No unrequested
    // abstractions: ..." — is a normal rule and must be kept verbatim.
    const t = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
    if (t) { const m = normalizeMode(t[1].trim()); if (m) return m === eff; }
    // Require a quoted value: every worked example is `- lite: "..."`. Without this, an
    // ordinary rule bullet that happens to start with a mode word is silently dropped in
    // every other mode — it looks like a worked example but is prose meant to survive.
    const e = line.match(/^-\s*([^:]+):\s*"/);
    if (e) { const m = normalizeMode(e[1].trim()); if (m) return m === eff; }
    return true;
  }).join('\n');
}

// The three reconciliation tags xend appends to upstream's own lines (never a deletion,
// never a re-wording), suppressed entirely under ponytailStrict. See SPEC §7.2.
const XEND_TAGS = [
  [/^Switch: `\/ponytail lite\|full\|ultra`\./, ' Use /xend:ponytail here. [xend]'],
  [/^Pattern: `\[code\] → skipped/, ' Write it without the arrow: skipped X; add when Y. [xend]'],
  // appended in place after the Boundaries clause, not at end of line: that line carries
  // the start of the next sentence, and a tag after it would split it.
  [/terse prose\)\./, " xend's own output style already covers that. [xend]", true],
];

function tagText(text) {
  const used = XEND_TAGS.map(() => false);
  return text.split('\n').map((line) => {
    for (let i = 0; i < XEND_TAGS.length; i++) {
      const [re, tag, inline] = XEND_TAGS[i];
      if (used[i] || !re.test(line)) continue;
      used[i] = true;
      return inline ? line.replace(re, (m) => m + tag) : line + tag;
    }
    return line;
  }).join('\n');
}

function readSkillBody(opts) {
  const files = [];
  // a plugin or skills-dir install keeps the skill under skills/ponytail/; a bare skill
  // folder (channel 'skill-only') is the skill directory itself
  if (opts.root) files.push(opts.channel === 'skill-only' ? path.join(opts.root, 'SKILL.md') : path.join(opts.root, 'skills', 'ponytail', 'SKILL.md'));
  files.push(opts.vendorPath || VENDOR_SKILL);
  for (const f of files) {
    try { return fs.readFileSync(f, 'utf8'); } catch (_) { /* try the next source */ }
  }
  return null;
}

// Exactly what upstream's hook injects. Returns null when no source can be read, so the
// caller can fall back to the adapted text instead of emitting an empty part.
function upstreamText(level, opts) {
  opts = opts || {};
  const eff = normalizeMode(level) || DEFAULT_MODE;
  const body = readSkillBody(opts);
  if (body == null) return null;
  const text = 'PONYTAIL MODE ACTIVE — level: ' + eff + '\n\n' + filterSkillBodyForMode(body, eff);
  return opts.strict ? text : tagText(text);
}

// What a mid-session level switch still needs to say when the ruleset is already in
// context: the new level line, nothing else.
function levelDelta(level) {
  const ctx = require('./context.js');
  const eff = normalizeMode(level);
  if (!eff) return 'Lean rules off for the rest of this session.';
  return 'Lean level changed for the rest of this session. ' + ctx.LEAN_LEVEL[eff];
}

// --- detection ---------------------------------------------------------------

function readJson(file, ev) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (ev) ev.push('read ' + file);
    return j;
  } catch (_) {
    if (ev) ev.push('no ' + file);
    return null;
  }
}

function claudeDirOf(env) {
  const c = env.CLAUDE_CONFIG_DIR && String(env.CLAUDE_CONFIG_DIR).trim();
  return c || path.join(os.homedir(), '.claude');
}

function settingsFiles(claudeDir, cwd) {
  return [
    path.join(claudeDir, 'settings.json'),
    path.join(claudeDir, 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ];
}

// Absent means enabled: only an explicit false disables a plugin.
function pluginEnabled(key, settings) {
  let on = true;
  for (const s of settings) {
    const e = s && s.enabledPlugins;
    if (e && Object.prototype.hasOwnProperty.call(e, key)) on = e[key] !== false;
  }
  return on;
}

// A plugin injects only if its manifest actually wires a SessionStart hook.
function hookState(root, ev) {
  const out = { session: false, subagent: false };
  const man = readJson(path.join(root, '.claude-plugin', 'plugin.json'), ev);
  let hooks = man && man.hooks;
  if (typeof hooks === 'string') hooks = (readJson(path.join(root, hooks), ev) || {}).hooks;
  if (!hooks || typeof hooks !== 'object') hooks = (readJson(path.join(root, 'hooks', 'hooks.json'), ev) || {}).hooks;
  if (!hooks || typeof hooks !== 'object') return out;
  out.session = Array.isArray(hooks.SessionStart) && hooks.SessionStart.length > 0;
  out.subagent = Array.isArray(hooks.SubagentStart) && hooks.SubagentStart.length > 0;
  return out;
}

// D1: an installed marketplace plugin named ponytail.
function findInstalled(claudeDir, ev) {
  const j = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'), ev);
  const plugins = (j && j.plugins) || {};
  for (const key of Object.keys(plugins)) {
    if (String(key).split('@')[0].toLowerCase() !== 'ponytail') continue;
    const entries = Array.isArray(plugins[key]) ? plugins[key] : [plugins[key]];
    for (const e of entries) {
      if (!e) continue;
      const marketplace = key.split('@')[1] || null;
      const root = e.installPath || (marketplace
        ? path.join(claudeDir, 'plugins', 'cache', marketplace, 'ponytail', String(e.version || ''))
        : null);
      if (root) return { key, root, version: e.version || null, marketplace };
    }
  }
  return null;
}

// D2/D3: a skills-dir plugin, or a bare SKILL.md with no manifest.
function findSkillsDir(dirs, ev) {
  for (const base of dirs) {
    const root = path.join(base, 'ponytail');
    const man = path.join(root, '.claude-plugin', 'plugin.json');
    const j = readJson(man, ev);
    if (j && String(j.name).toLowerCase() === 'ponytail') return { root, channel: 'skills-dir', version: j.version || null };
    try {
      fs.statSync(path.join(root, 'SKILL.md'));
      ev.push('found ' + path.join(root, 'SKILL.md') + ' without a plugin manifest');
      return { root, channel: 'skill-only', version: null };
    } catch (_) { ev.push('no ' + path.join(root, 'SKILL.md')); }
  }
  return null;
}

// D4: an activate hook wired directly in a settings file.
const ACTIVATE_RE = /(^|[/\\])ponytail-activate\.(js|mjs|cjs)/;
const SUBAGENT_RE = /(^|[/\\])ponytail-subagent\.(js|mjs|cjs)/;

function scanSettingsHooks(settings) {
  const out = { session: false, subagent: false };
  for (const s of settings) {
    const h = s && s.hooks;
    if (!h) continue;
    for (const [event, re] of [['SessionStart', ACTIVATE_RE], ['SubagentStart', SUBAGENT_RE]]) {
      for (const g of (Array.isArray(h[event]) ? h[event] : [])) {
        for (const e of ((g && g.hooks) || [])) {
          if (e && typeof e.command === 'string' && re.test(e.command)) {
            if (event === 'SessionStart') out.session = true; else out.subagent = true;
          }
        }
      }
    }
  }
  return out;
}

// D5: the level upstream would run at. 'off' means upstream's hook emits nothing.
function upstreamMode(env, ev) {
  const fromEnv = String(env.PONYTAIL_DEFAULT_MODE || '').trim().toLowerCase();
  if (fromEnv) { ev.push('PONYTAIL_DEFAULT_MODE=' + fromEnv); return fromEnv === 'off' ? 'off' : (normalizeMode(fromEnv) || DEFAULT_MODE); }
  const base = env.XDG_CONFIG_HOME
    || (process.platform === 'win32' ? env.APPDATA : null)
    || path.join(os.homedir(), '.config');
  const j = readJson(path.join(base, 'ponytail', 'config.json'), ev);
  const m = j && String(j.defaultMode || '').trim().toLowerCase();
  if (m === 'off') return 'off';
  return normalizeMode(m) || DEFAULT_MODE;
}

// Static, offline, bounded. Every read degrades to "not installed" rather than throwing:
// the worst case is a visible duplicate ruleset, never a silent loss of it.
function detect(o) {
  o = o || {};
  const env = o.env || process.env;
  const cwd = o.cwd || process.cwd();
  const claudeDir = o.claudeDir || claudeDirOf(env);
  const ev = [];
  const out = {
    installed: false, capable: false, injecting: false, channel: null, root: null, version: null,
    marketplace: null, mode: null, subagentHook: false, statuslineNudgePending: false,
    enabled: true, evidence: ev,
  };
  try {
    const settings = settingsFiles(claudeDir, cwd).map((f) => readJson(f, ev));
    const inst = findInstalled(claudeDir, ev);
    let hooks = { session: false, subagent: false };
    if (inst) {
      out.installed = true; out.channel = 'plugin'; out.root = inst.root;
      out.version = inst.version; out.marketplace = inst.marketplace;
      out.enabled = pluginEnabled(inst.key, settings);
      hooks = hookState(inst.root, ev);
    } else {
      const sd = findSkillsDir([path.join(claudeDir, 'skills'), path.join(cwd, '.claude', 'skills')], ev);
      if (sd) {
        out.installed = true; out.channel = sd.channel; out.root = sd.root; out.version = sd.version;
        if (sd.channel === 'skills-dir') hooks = hookState(sd.root, ev);
      }
    }
    const fromSettings = scanSettingsHooks(settings);
    if (fromSettings.session && !out.installed) { out.installed = true; out.channel = 'settings-hook'; }
    out.subagentHook = hooks.subagent || fromSettings.subagent;
    out.mode = upstreamMode(env, ev);
    // capable: a SessionStart hook is wired and the plugin is enabled. injecting: it will
    // actually emit text, i.e. capable and not configured off (activate.js exits on 'off').
    out.capable = out.enabled && (hooks.session || fromSettings.session);
    out.injecting = out.capable && out.mode !== 'off';
    // Corroboration only: the flag file survives uninstall and hook order is not
    // guaranteed, so it never makes a detection on its own.
    try { fs.statSync(path.join(claudeDir, '.ponytail-active')); ev.push('flag file present'); }
    catch (_) { ev.push('no ' + path.join(claudeDir, '.ponytail-active')); }
    try { fs.statSync(path.join(claudeDir, '.ponytail-statusline-nudged')); }
    catch (_) { out.statuslineNudgePending = out.injecting; }
  } catch (e) {
    ev.push('detection failed: ' + ((e && e.message) || e));
  }
  return out;
}

// upstream is authoritative when it can actually inject; 'yield' forces that, 'ignore'
// denies it. Its off state counts as ownership: one source of truth, as configured.
function owns(detected, cfg) {
  const mode = (cfg && cfg.upstream && cfg.upstream.ponytail) || 'auto';
  // ownership follows the ability to inject, not the current level: a user who set
  // PONYTAIL_DEFAULT_MODE=off configured one source of truth, and xend respects it.
  const capable = mode === 'yield' ? true : !!(detected && (detected.capable || detected.injecting));
  const upstreamOwns = capable && mode !== 'ignore';
  return { ownsLean: !upstreamOwns, upstreamOwns, injecting: !!(detected && detected.injecting), upstreamMode: mode };
}

module.exports = {
  PONYTAIL_LEVELS, PONYTAIL_TEXTS, UPSTREAM_MODES, DEFAULT_MODE,
  FILE_SHA256, BODY_SHA256, VENDOR_DIR, VENDOR_SKILL,
  normalizeMode, filterSkillBodyForMode, upstreamText, levelDelta, detect, owns,
};
