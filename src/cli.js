'use strict';
// mcp/clipspeed-mcp/src/cli.js — the `clipspeed` command for agents that run commands instead of MCP
// (OpenClaw, Hermes, Grok Build, Paperclip, nanoclaw, cron jobs, CI). Every command is one of the SAME
// tools the MCP server exposes (src/tools.js), so a skill written for the CLI and a conversation over
// MCP book through the same API, the same rules, the same words.
//
//   clipspeed auth:key csai_live_…          save your API key (~/.clipspeed/credentials.json, 0600)
//   clipspeed channels:list                 what is connected, what each platform takes
//   clipspeed channels:connect bluesky      a 10-minute link that connects one platform
//   clipspeed posts:create -p x,linkedin -c "Shipping today." --at 2026-12-01T14:00:00Z [--preview]
//   clipspeed plan --project <id> --days 7 [--approve]
//   clipspeed clip <video-url> | clips <project> | discover "<niche>" | posts:list | posts:cancel <id>
//
// Output is JSON with --json (for scripts) or a readable rendering (for people and agents alike).

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_BASE_URL = 'https://api.clipspeed.ai';
const CRED_DIR = path.join(os.homedir(), '.clipspeed');
const CRED_FILE = path.join(CRED_DIR, 'credentials.json');

// command → tool, plus how its flags map onto the tool's arguments
const COMMANDS = {
  'channels:list':    { tool: 'list_channels',          args: {} },
  'channels:connect': { tool: 'connect_channel',        positional: ['platform'] },
  'settings':         { tool: 'platform_settings',      positional: ['platform'] },
  'posts:create':     { tool: 'schedule_post',          flags: { p: 'platforms', platforms: 'platforms', c: 'text', text: 'text', caption: 'text', m: 'media_url', media: 'media_url', carousel: 'media_urls', stories: 'media_urls', type: 'post_type', clip: 'clip_id', at: 'scheduled_at', title: 'title', hashtags: 'hashtags', privacy: 'privacy_status', preview: 'preview' }, lists: ['platforms', 'hashtags', 'media_urls'], bools: ['preview'], perPlatform: true },
  'posts:list':       { tool: 'list_scheduled_posts',   flags: { status: 'status', platform: 'platform', limit: 'limit', from: 'from', to: 'to' } },
  'posts:update':     { tool: 'update_scheduled_post',  positional: ['post_id'], flags: { c: 'text', text: 'text', title: 'title', hashtags: 'hashtags' }, lists: ['hashtags'] },
  'posts:cancel':     { tool: 'cancel_scheduled_post',  positional: ['post_id'] },
  'analytics':        { tool: 'post_analytics',         positional: ['post_id'] },
  'plan':             { tool: 'plan_week',              flags: { project: 'project_id', clips: 'clip_ids', p: 'platforms', platforms: 'platforms', days: 'days', preset: 'preset', approve: 'approve' }, lists: ['clip_ids', 'platforms'], bools: ['approve'], numbers: ['days'] },
  'clip':             { tool: 'clip_video',             positional: ['video_url'], flags: { style: 'caption_style', aspect: 'aspect_ratio', count: 'clip_count' }, numbers: ['clip_count'] },
  'status':           { tool: 'get_clip_status',        positional: ['job_id'] },
  'clips':            { tool: 'list_clips',             flags: { limit: 'limit', status: 'status' } },
  'download':         { tool: 'download_clip',          positional: ['job_id'], flags: { index: 'clip_index', dir: 'dir' } },
  'discover':         { tool: 'discover_trending',      positional: ['niche'], flags: { days: 'days' }, numbers: ['days'] },
  'usage':            { tool: 'get_usage',              args: {} },
  'restyle':          { tool: 'restyle_captions',       positional: ['project_id'], flags: { style: 'style' } },
};
const ALIASES = { 'channels': 'channels:list', 'connect': 'channels:connect', 'post': 'posts:create', 'schedule': 'posts:create', 'posts': 'posts:list', 'cancel': 'posts:cancel', 'update': 'posts:update', 'plan-week': 'plan' };

function readSavedKey() {
  try { const j = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); return j && typeof j.api_key === 'string' ? j.api_key : null; } catch (_) { return null; }
}
function saveKey(key) {
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CRED_FILE, JSON.stringify({ api_key: key, saved_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(CRED_FILE, 0o600); } catch (_) { /* best effort */ }
}
function resolveKey(env = process.env) {
  return env.CLIPSPEED_API_KEY || readSavedKey();
}

/** --flag value / --flag=value / --bool; positionals in order. */
function parseArgv(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2); const nxt = argv[i + 1];
      if (nxt == null || nxt.startsWith('-')) flags[k] = true; else { flags[k] = nxt; i++; }
    } else if (a.startsWith('-') && a.length === 2) {
      const k = a.slice(1); const nxt = argv[i + 1];
      if (nxt == null || nxt.startsWith('-')) flags[k] = true; else { flags[k] = nxt; i++; }
    } else pos.push(a);
  }
  return { flags, pos };
}

// Per-channel copy (the per_platform contract): --per-platform '<json>' and/or --<platform>-text,
// --<platform>-title, --<platform>-hashtags (e.g. --x-text "short version" --youtube-title "…").
const PER_PLATFORM_FLAG = /^(youtube|tiktok|instagram|x|linkedin_page|linkedin|facebook|threads|bluesky|pinterest)-(text|caption|title|hashtags)$/;
function perPlatformFromFlags(flags) {
  let pp = null;
  if (flags['per-platform'] !== undefined) {
    try { pp = JSON.parse(String(flags['per-platform'])); } catch (_) { throw new Error('--per-platform must be JSON, e.g. \'{"x":{"text":"short version"}}\''); }
    if (!pp || typeof pp !== 'object' || Array.isArray(pp)) throw new Error('--per-platform must be a JSON object keyed by platform.');
  }
  for (const [k, v] of Object.entries(flags)) {
    const m = PER_PLATFORM_FLAG.exec(k);
    if (!m || v === true) continue;
    pp = pp || {};
    const field = m[2] === 'caption' ? 'text' : m[2];
    pp[m[1]] = { ...(pp[m[1]] || {}), [field]: field === 'hashtags' ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : String(v) };
  }
  return pp;
}

function buildArgs(spec, { flags, pos }) {
  const out = { ...(spec.args || {}) };
  if (spec.perPlatform) { const pp = perPlatformFromFlags(flags); if (pp) out.per_platform = pp; }
  (spec.positional || []).forEach((name, i) => { if (pos[i] != null) out[name] = pos[i]; });
  for (const [flag, name] of Object.entries(spec.flags || {})) {
    if (flags[flag] === undefined) continue;
    let v = flags[flag];
    if ((spec.bools || []).includes(name)) v = v === true || String(v).toLowerCase() === 'true';
    else if ((spec.lists || []).includes(name)) v = String(v).split(',').map((s) => s.trim()).filter(Boolean);
    else if ((spec.numbers || []).includes(name)) v = Number(v);
    out[name] = v;
  }
  return out;
}

function render(value, indent = '') {
  if (value == null) return `${indent}—`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(none)`;
    return value.map((v) => (typeof v === 'object' && v !== null ? `${indent}•\n${render(v, indent + '  ')}` : `${indent}• ${v}`)).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (typeof v === 'object' && v !== null ? `${indent}${k}:\n${render(v, indent + '  ')}` : `${indent}${k}: ${v}`)).join('\n');
  }
  return `${indent}${value}`;
}

function help() {
  const lines = ['clipspeed — ClipSpeed from the command line (clips, channels, scheduling). Same tools as the MCP server.', '',
    'Auth:', '  clipspeed auth:key csai_live_…     save your API key (or export CLIPSPEED_API_KEY)', '  clipspeed auth:status', '  clipspeed auth:logout', '',
    'Commands:'];
  for (const [cmd, spec] of Object.entries(COMMANDS)) {
    const p = (spec.positional || []).map((x) => `<${x}>`).join(' ');
    const f = Object.entries(spec.flags || {}).filter(([k]) => k.length > 1).map(([k]) => `--${k}`).join(' ');
    lines.push(`  clipspeed ${cmd} ${p} ${f}`.replace(/\s+$/, ''));
  }
  lines.push('', 'Flags: --json (machine output) · --base-url <url>', '',
    'Examples:',
    '  clipspeed channels:list',
    '  clipspeed posts:create -p x,linkedin -c "Shipping agentic scheduling today." --at 2026-12-01T14:00:00Z --preview',
    '  clipspeed posts:create -p instagram,linkedin -c "Five lessons" --carousel https://…/1.png,https://…/2.png,https://…/3.png --preview',
    '  clipspeed posts:create -p instagram,facebook --type story --stories https://…/1.jpg,https://…/2.mp4 --at 2026-12-01T14:00:00Z',
    '  clipspeed posts:create -p x,linkedin -c "The long LinkedIn version…" --x-text "The short X version" --preview',
    '  clipspeed plan --project 3f2e… --days 7            # show the week',
    '  clipspeed plan --project 3f2e… --days 7 --approve  # book it',
    '  clipspeed clip https://youtu.be/… --style karaoke && clipspeed status <job_id>', '',
    'Get a key: https://www.clipspeed.ai/dashboard/api-key/  ·  Docs: https://www.clipspeed.ai/agents/cli/');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), { fetchImpl, stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const { flags, pos } = parseArgv(argv);
  const cmdRaw = pos.shift();
  const cmd = ALIASES[cmdRaw] || cmdRaw;
  const json = flags.json === true;
  const out = (v) => stdout.write((json ? JSON.stringify(v, null, 2) : render(v)) + '\n');

  if (!cmd || cmd === 'help' || cmd === '--help' || flags.help) { stdout.write(help() + '\n'); return 0; }
  if (cmd === 'auth:key') { const k = pos[0] || flags.key; if (!k || !/^csai_/.test(String(k))) { stderr.write('Pass your ClipSpeed API key (starts with csai_). Get one at https://www.clipspeed.ai/dashboard/api-key/\n'); return 2; } saveKey(String(k)); stdout.write(`Saved to ${CRED_FILE}\n`); return 0; }
  if (cmd === 'auth:status') { const k = resolveKey(env); out(k ? { signed_in: true, key: `${k.slice(0, 10)}…${k.slice(-4)}`, source: env.CLIPSPEED_API_KEY ? 'CLIPSPEED_API_KEY' : CRED_FILE } : { signed_in: false, hint: 'clipspeed auth:key csai_live_… or export CLIPSPEED_API_KEY' }); return k ? 0 : 1; }
  if (cmd === 'auth:logout') { try { fs.unlinkSync(CRED_FILE); } catch (_) { /* nothing saved */ } stdout.write('Signed out (local key removed).\n'); return 0; }

  const spec = COMMANDS[cmd];
  if (!spec) { stderr.write(`Unknown command "${cmdRaw}". Run clipspeed --help.\n`); return 2; }
  const apiKey = resolveKey(env);
  if (!apiKey) { stderr.write('Not signed in. Run: clipspeed auth:key csai_live_…  (or export CLIPSPEED_API_KEY)\n'); return 1; }
  const baseUrl = flags['base-url'] || env.CLIPSPEED_BASE_URL || DEFAULT_BASE_URL;
  const { buildTools } = require('./tools');
  const tools = buildTools({ baseUrl, apiKey, fetchImpl });
  const tool = tools.find((t) => t.name === spec.tool);
  if (!tool) { stderr.write(`Tool ${spec.tool} is missing from this build.\n`); return 2; }
  let args;
  try { args = buildArgs(spec, { flags, pos }); } catch (e) { stderr.write(`✗ ${e.message}\n`); return 2; }
  try {
    const result = await tool.handler(args);
    out(result);
    return result && result.ok === false ? 1 : 0;
  } catch (e) {
    let payload = null; try { payload = JSON.parse(e.message); } catch (_) { /* plain message */ }
    const msg = payload && payload.error ? (payload.error.message || payload.error.type || e.message) : e.message;
    if (json) stdout.write(JSON.stringify(payload || { error: { message: msg } }, null, 2) + '\n'); else stderr.write(`✗ ${msg}\n`);
    return 1;
  }
}

module.exports = { main, parseArgv, buildArgs, perPlatformFromFlags, COMMANDS, ALIASES, render, resolveKey, CRED_FILE };
