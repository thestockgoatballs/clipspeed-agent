// mcp/clipspeed-mcp/src/tools.js
//
// Pure, testable tool definitions for the public clipspeed-mcp package.
// These wrap the PUBLIC /api/v1 surface using a personal `csai_live_` key
// (sent as `X-API-Key`). No MCP SDK here — server.js owns the transport so
// this module stays trivially unit-testable with an injected fetch.
//
// Every tool returns the raw parsed JSON from the API. When the API replies
// with an error shape ({ error: { type, message }, upgrade_url? }) we surface
// it verbatim (plus upgrade_url) so the agent can relay it to the user
// ("you're out of credits → upgrade at ...") instead of a bare stack trace.

'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const CAPTION_STYLES = ['karaoke', 'hormozi', 'beasty', 'fire', 'youshaei', 'cinematic', 'bold'];
const ASPECT_RATIOS = ['9:16', '1:1', '16:9'];

// Refuse to write anything larger than this to the user's disk.
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

function sanitizeFilename(name, fallback = 'clip') {
  const base = String(name || '').trim() || fallback;
  // strip path separators + reserved/control chars, collapse whitespace, lowercase
  const cleaned = base
    .replace(/[\/\\]+/g, '')          // path separators -> removed (never spaces)
    .replace(/[<>:"|?*\x00-\x1f]/g, '') // reserved + control chars -> removed
    .replace(/\s+/g, ' ')              // collapse remaining whitespace
    .replace(/^\.+/, '')               // no leading dots (hidden files)
    .trim()
    .slice(0, 120)
    .toLowerCase();
  const safe = cleaned || fallback;
  return safe.endsWith('.mp4') ? safe : `${safe}.mp4`;
}

function buildTools({ baseUrl, apiKey, fetchImpl, downloadsDir } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('global fetch is unavailable — clipspeed-mcp requires Node.js >= 18.');
  }
  const root = String(baseUrl || 'https://api.clipspeed.ai').replace(/\/+$/, '');
  const downloadsRoot = downloadsDir || path.join(os.homedir(), 'Downloads');

  // Core HTTP client. Returns parsed JSON. On an API error shape, throw an
  // Error whose message is a compact JSON string carrying { error, upgrade_url,
  // ... } so server.js relays the full, actionable payload to the agent.
  async function api(method, apiPath, { body, query } = {}) {
    let url = root + apiPath;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    const res = await doFetch(url, {
      method,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      if (!res.ok) {
        throw new Error(JSON.stringify({ error: { type: 'server_error', message: `HTTP ${res.status}` }, status: res.status }));
      }
      return { raw: text };
    }

    if (!res.ok || (data && data.error)) {
      // Preserve the standardized error shape + upgrade_url so the agent can
      // tell the user exactly what happened and how to fix it.
      const payload = {
        error: (data && data.error) || { type: 'server_error', message: `HTTP ${res.status}` },
        status: res.status,
      };
      if (data && data.upgrade_url) payload.upgrade_url = data.upgrade_url;
      if (data && data.credits_remaining !== undefined) payload.credits_remaining = data.credits_remaining;
      if (data && data.credits_needed !== undefined) payload.credits_needed = data.credits_needed;
      throw new Error(JSON.stringify(payload));
    }
    return data;
  }

  // ── download_clip helpers ────────────────────────────────────────────
  async function saveOneClip(clip) {
    const url = clip && clip.url;
    if (!url) return { clip_index: clip && clip.index, title: clip && clip.title, skipped: 'no downloadable url' };

    // Size guard via HEAD (best-effort — the API's R2 links honour HEAD).
    let sizeBytes = null;
    try {
      const head = await doFetch(url, { method: 'HEAD' });
      const len = head && head.headers && typeof head.headers.get === 'function' ? head.headers.get('content-length') : null;
      if (len) sizeBytes = parseInt(len, 10);
    } catch (_) { /* HEAD unsupported — fall through to a streamed guard */ }
    if (sizeBytes !== null && sizeBytes > MAX_DOWNLOAD_BYTES) {
      return { clip_index: clip.index, title: clip.title, skipped: `file is ${(sizeBytes / 1048576).toFixed(0)}MB (over the 500MB safety limit)` };
    }

    const res = await doFetch(url, { method: 'GET' });
    if (!res || !res.ok) {
      return { clip_index: clip.index, title: clip.title, skipped: `download failed (HTTP ${res ? res.status : '?'})` };
    }
    // Second guard: honour content-length on the GET even if HEAD was unavailable.
    const getLen = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
    if (getLen && parseInt(getLen, 10) > MAX_DOWNLOAD_BYTES) {
      return { clip_index: clip.index, title: clip.title, skipped: `file is ${(parseInt(getLen, 10) / 1048576).toFixed(0)}MB (over the 500MB safety limit)` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) {
      return { clip_index: clip.index, title: clip.title, skipped: `file is ${(buf.length / 1048576).toFixed(0)}MB (over the 500MB safety limit)` };
    }

    await fsp.mkdir(downloadsRoot, { recursive: true });
    const filename = sanitizeFilename(clip.filename || clip.title, `clip-${clip.index || 1}`);
    const outPath = path.join(downloadsRoot, filename);
    await fsp.writeFile(outPath, buf);
    return { clip_index: clip.index, title: clip.title, path: outPath, bytes: buf.length };
  }

  const tools = [
    {
      name: 'clip_video',
      description:
        'Turn any video URL (YouTube, TikTok, Twitch, Instagram, X, Kick, Vimeo, or a direct link) into scored, captioned, ready-to-post vertical clips. Use this when the user gives you a video and wants shorts. Returns a job_id — poll get_clip_status until it is complete. Jobs typically take 10–30 minutes.',
      inputSchema: {
        type: 'object',
        properties: {
          video_url: { type: 'string', description: 'Public URL of the source video to clip.' },
          aspect_ratio: { type: 'string', enum: ASPECT_RATIOS, description: 'Output aspect ratio. Default 9:16 (vertical, best for Shorts/Reels/TikTok).' },
          caption_style: { type: 'string', enum: CAPTION_STYLES, description: 'Caption look. Default karaoke (green highlight, highest-converting).' },
          clip_count: { type: 'number', description: 'How many clips to try to produce (default 10).' },
          platform: { type: 'string', description: "Source platform hint; leave off to auto-detect (default 'auto')." },
        },
        required: ['video_url'],
      },
      handler: (a) =>
        api('POST', '/api/v1/clips/generate', {
          body: {
            url: a.video_url,
            aspect_ratio: a.aspect_ratio || '9:16',
            caption_style: a.caption_style || 'karaoke',
            clip_count: a.clip_count || 10,
            platform: a.platform || 'auto',
          },
        }).then((r) => ({
          job_id: r.id,
          status: r.status,
          platform: r.platform,
          // server returns a relative status_url ('/api/v1/clips/<id>'); make it absolute so it's directly fetchable
          status_url: r.status_url ? (/^https?:\/\//.test(r.status_url) ? r.status_url : root + r.status_url) : undefined,
          message: r.message,
        })),
    },

    {
      name: 'get_clip_status',
      description:
        'Check whether a clip job is done and get the finished clips. Use after clip_video to poll (every 30–60s). ' +
        'Clips arrive AS THEY FINISH, so a clips[] array does NOT mean the job is done — it often holds a partial batch. ' +
        'Announce the job as finished ONLY when delivery.complete is true; while it is false, say how many clips (delivery.delivered) are ready so far and keep polling. ' +
        'delivery also carries visible / captionRepair / state. A clip whose delivery_state is "caption_repair" plays but its captions failed, so it is not finished work; ' +
        '"unknown_status" plays too but the server could not classify it, so never call that batch finished. ' +
        'delivery.expected is ADVISORY (the candidate count analysis proposed, often higher than what gets cut) and may be null — never poll against it and never quote it as a target. ' +
        'Present the top clips by viral_score.',
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'The job_id returned by clip_video.' } },
        required: ['job_id'],
      },
      handler: (a) =>
        api('GET', `/api/v1/clips/${encodeURIComponent(a.job_id)}`).then((r) => ({
          job_id: r.id,
          status: r.status,
          url: r.url,
          platform: r.platform,
          clips_found: r.clips_found,
          // ⛔ 2026-09-22 — THE ONLY FIELD THAT MAY BE ANNOUNCED AS FINISHED.
          // This tool used to receive clips ONLY for a terminal project, so 174
          // finished clips across 12 projects were invisible here (35878ccb 15/15
          // for 33.8h, 75acee88 8/8 for 45.8h — both owing nothing). That gate is
          // gone, which means a PARTIAL batch now arrives too — so the assistant
          // must be told the difference or it will announce 18 of 23 as done.
          // `delivery.complete` is true only when the project reached terminal
          // success AND holds ≥1 real satisfied clip AND owes no captions AND
          // holds no unclassifiable row. `clips.length` is not a signal, and
          // neither is `delivery.expected` — that is the analysis candidate count,
          // which the cut stage drops from; polling against it left 405 of 1,354
          // finished projects (29.9%) polling forever in the first cut of this.
          delivery: r.delivery || null,
          clips: (r.clips || []).map((c) => ({
            clip_id: c.id,
            title: c.title,
            viral_score: c.viral_score,
            duration: c.duration,
            video_url: c.video_url,
            hook: c.hook,
            hashtags: c.hashtags,
            // 'ready' | 'silent_verified' | 'caption_repair' | 'unknown_status'.
            // caption_repair plays but its captions failed — real video, unmet
            // obligation. unknown_status plays and is shown on purpose (hiding it
            // is how 72 live-lane clips disappeared) but is never "finished work".
            delivery_state: c.delivery_state || null,
          })),
          error: r.error || null,
        })),
    },

    {
      name: 'list_clips',
      description:
        "List the user's recent clip jobs (most recent first) so you can find a past job_id. Use when the user says things like \"show my clips\" or \"what did I make yesterday\". Optionally filter by status.",
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max jobs to return (default 20, max 100).' },
          status: { type: 'string', description: "Optional status filter, e.g. 'completed', 'processing', 'queued', 'failed'." },
        },
      },
      handler: (a) => api('GET', '/api/v1/clips', { query: { limit: a.limit, status: a.status } }),
    },

    {
      name: 'download_clip',
      description:
        'Download finished clip files to the user\'s ~/Downloads folder — the marquee local-disk feature a hosted MCP cannot do. Use after a job is complete when the user wants the actual .mp4 files. Pass clip_index (1-based) to grab one clip, or omit it to download all clips from the job. Files over 500MB are skipped for safety.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'The completed job_id.' },
          clip_index: { type: 'number', description: '1-based index of a single clip to download. Omit to download every clip in the job.' },
        },
        required: ['job_id'],
      },
      handler: async (a) => {
        const manifest = await api('GET', `/api/v1/clips/${encodeURIComponent(a.job_id)}/download/all`);
        let clips = manifest.clips || [];
        if (clips.length === 0) return { job_id: a.job_id, saved: [], message: 'No downloadable clips found for this job.' };

        if (a.clip_index !== undefined && a.clip_index !== null) {
          const target = clips.find((c) => Number(c.index) === Number(a.clip_index));
          if (!target) {
            throw new Error(JSON.stringify({ error: { type: 'not_found', message: `Clip index ${a.clip_index} not found (job has ${clips.length} clips).` } }));
          }
          clips = [target];
        }

        const saved = [];
        for (const clip of clips) {
          // eslint-disable-next-line no-await-in-loop
          saved.push(await saveOneClip(clip));
        }
        return {
          job_id: a.job_id,
          downloads_dir: downloadsRoot,
          count: saved.filter((s) => s.path).length,
          saved,
        };
      },
    },

    {
      name: 'get_usage',
      description:
        'Show the user how many credits they have left and their plan. Use when they ask "how many credits do I have / am I out". 1 credit = 1 minute of source video. Returns credits_remaining, credits_total, credits_used_this_month, plan, and is_trialing.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => api('GET', '/api/v1/usage'),
    },

    {
      name: 'discover_trending',
      description:
        "Find the fastest-growing recent video in a niche to clip — ClipSpeed's differentiator. Use when the user wants to grow a page or asks \"what should I clip today\". Pass a niche (e.g. 'AI tools'); omit to reuse the remembered niche. Returns a ranked pick plus candidates with velocity and channel-lift. Lead with the pick and the one-line reason, then offer to clip it.",
      inputSchema: {
        type: 'object',
        properties: {
          niche: { type: 'string', description: "Topic to search, e.g. 'AI tools', 'fitness', 'crypto'." },
          days: { type: 'number', description: 'Look-back window in days (default 7).' },
        },
      },
      handler: (a) => api('POST', '/api/v1/discover', { body: { niche: a.niche, days: a.days || 7 } }),
    },

    {
      name: 'schedule_post',
      description:
        "Schedule a post to the user's connected social accounts (youtube, tiktok, instagram, x, linkedin). Content is one of: clip_id (a finished ClipSpeed clip, from get_clip_status), text (a text post — X and LinkedIn), or media_url (a public https image or video link; text is its caption). A picked scheduled_at is booked exactly or refused with the next open time; omit it to post as soon as possible. preview: true books nothing and returns the plan. Returns, per platform, the scheduled time in the user's time zone and the post id, or why it was not scheduled.",
      inputSchema: {
        type: 'object',
        properties: {
          platforms: { type: 'array', items: { type: 'string', enum: ['tiktok', 'youtube', 'instagram', 'x', 'linkedin'] }, description: 'Platforms to publish to.' },
          clip_id: { type: 'string', description: 'A finished clip to publish (from get_clip_status).' },
          text: { type: 'string', description: 'Post text / caption (required for a text post).' },
          caption: { type: 'string', description: 'Alias of text.' },
          title: { type: 'string', description: 'Post title where the platform has one (YouTube requires it).' },
          hashtags: { type: 'array', items: { type: 'string' } },
          media_url: { type: 'string', description: 'Public https link to an image or video to post.' },
          scheduled_at: { type: 'string', description: 'ISO 8601 time to publish. Omit to publish as soon as possible.' },
          preview: { type: 'boolean', description: 'true = plan only, book nothing.' },
          privacy_status: { type: 'string', enum: ['public', 'unlisted', 'private'], description: 'YouTube only.' },
        },
        required: ['platforms'],
      },
      handler: (a) =>
        api('POST', '/api/v1/schedule', {
          body: {
            clip_id: a.clip_id,
            platforms: a.platforms,
            text: a.text != null ? a.text : a.caption,
            title: a.title,
            hashtags: a.hashtags,
            media_url: a.media_url,
            scheduled_at: a.scheduled_at,
            preview: a.preview === true,
            privacy_status: a.privacy_status,
          },
        }),
    },

    {
      name: 'list_scheduled_posts',
      description:
        'List the user\'s scheduled / posted social posts (most recent first). Use to review what is queued, check whether something posted, or find a post_id to cancel. Optionally filter by status or platform.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: "Optional status filter, e.g. 'scheduled', 'posted', 'failed', 'cancelled'." },
          platform: { type: 'string', description: 'Optional platform filter (tiktok, youtube, instagram, x, linkedin).' },
          limit: { type: 'number', description: 'Max posts to return (default 20).' },
        },
      },
      handler: (a) => api('GET', '/api/v1/schedule', { query: { status: a.status, platform: a.platform, limit: a.limit } }),
    },

    {
      name: 'cancel_scheduled_post',
      description:
        'Cancel a post that is still scheduled (not yet processing or sent). Use when the user says "cancel that post". Only works while status is "scheduled" — a post already processing/sent cannot be cancelled.',
      inputSchema: {
        type: 'object',
        properties: { post_id: { type: 'string', description: 'The id of the scheduled post to cancel (from list_scheduled_posts).' } },
        required: ['post_id'],
      },
      handler: (a) => api('DELETE', `/api/v1/schedule/${encodeURIComponent(a.post_id)}`),
    },

    {
      name: 'list_channels',
      description: "Lists the platforms ClipSpeed posts to and this account's connection on each (connected / not connected / needs reconnect / coming soon), what each takes (text, image, video), its limits and daily pacing, and the account's time zone.",
      inputSchema: { type: 'object', properties: {} },
      handler: () => api('GET', '/api/v1/channels'),
    },
    {
      name: 'connect_channel',
      description: 'Returns a private 10-minute link that connects one platform to this ClipSpeed account; the user opens it, signs in to the platform and approves.',
      inputSchema: { type: 'object', properties: { platform: { type: 'string' } }, required: ['platform'] },
      handler: (a) => api('POST', `/api/v1/channels/${encodeURIComponent(a.platform)}/connect`),
    },
    {
      name: 'platform_settings',
      description: 'The posting rules for one platform: accepted kinds, text/title limits (X counts a link as 23), whether a title is required, pacing per kind, availability.',
      inputSchema: { type: 'object', properties: { platform: { type: 'string' } }, required: ['platform'] },
      handler: (a) => api('GET', `/api/v1/platforms/${encodeURIComponent(a.platform)}/settings`),
    },
    {
      name: 'update_scheduled_post',
      description: 'Changes the text, title or hashtags of a post that is still scheduled and has not started sending. The booked time does not change.',
      inputSchema: { type: 'object', properties: { post_id: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } }, required: ['post_id'] },
      handler: (a) => api('PATCH', `/api/v1/schedule/${encodeURIComponent(a.post_id)}`, { body: { text: a.text, title: a.title, hashtags: a.hashtags } }),
    },
    {
      name: 'post_analytics',
      description: "A posted item's views, likes, comments and shares where ClipSpeed has them; says plainly when not posted yet or not available.",
      inputSchema: { type: 'object', properties: { post_id: { type: 'string' } }, required: ['post_id'] },
      handler: (a) => api('GET', `/api/v1/schedule/${encodeURIComponent(a.post_id)}/analytics`),
    },
    {
      name: 'plan_week',
      description: "Lays a project's finished clips (or clip_ids) over the next days (default 7, max 14) on the connected platforms — best clips first, inside the account's limits, spacing and each platform's good hours — and returns every slot in the account's time zone. Nothing is booked unless approve is true; show the plan first.",
      inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, clip_ids: { type: 'array', items: { type: 'string' } }, platforms: { type: 'array', items: { type: 'string' } }, days: { type: 'number' }, preset: { type: 'string', enum: ['steady', 'balanced', 'beast'] }, approve: { type: 'boolean' } } },
      handler: (a) => api('POST', '/api/v1/plan', { body: { project_id: a.project_id, clip_ids: a.clip_ids, platforms: a.platforms, days: a.days, preset: a.preset, approve: a.approve === true } }),
    },
    {
      name: 'restyle_captions',
      description:
        'Regenerate a project\'s captions in a different style without re-clipping. Use when the user says "make the captions hormozi style" for an existing job. Pass the project_id (the same value as the clip job_id) and a style.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project/job id whose captions to restyle.' },
          style: { type: 'string', enum: CAPTION_STYLES, description: 'New caption style to apply.' },
        },
        required: ['project_id', 'style'],
      },
      handler: (a) => api('POST', '/api/v1/captions/restyle', { body: { project_id: a.project_id, style: a.style } }),
    },
  ];

  return tools;
}

module.exports = { buildTools, sanitizeFilename, CAPTION_STYLES, ASPECT_RATIOS, MAX_DOWNLOAD_BYTES };
