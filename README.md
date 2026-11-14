# ClipSpeed for AI agents — `clipspeed-mcp` + the `clipspeed` CLI

Clip any video or live stream into scored, captioned shorts, then **plan and schedule posts** — your own text, images, video or those clips — to YouTube, TikTok, Instagram, X, LinkedIn, Threads, Bluesky and Facebook Pages. The same tools everywhere: a hosted MCP server (OAuth, no key), this package's local MCP server (API key), and the `clipspeed` command line for agents that run commands.

Requires a ClipSpeed **paid plan or the $1 trial**. Keys: **https://www.clipspeed.ai/dashboard/api-key/** (they look like `csai_live_…`).

## Pick your agent

| Agent | Install |
|---|---|
| **Claude** (claude.ai, desktop, mobile) | Settings → Connectors → add `https://api.clipspeed.ai/mcp` (or the ClipSpeed connector from the directory). Sign in to ClipSpeed when asked. |
| **Claude Code** | `claude mcp add --transport http clipspeed https://api.clipspeed.ai/mcp` — or the plugin: `/plugin marketplace add thestockgoatballs/clipspeed-agent` then `/plugin install clipspeed@clipspeed` |
| **ChatGPT** | Developer mode → Connectors → custom connector `https://api.clipspeed.ai/mcp` |
| **Codex** | `codex mcp add clipspeed --url https://api.clipspeed.ai/mcp` |
| **Cursor / Windsurf / Cline / any MCP client** | add the MCP server URL `https://api.clipspeed.ai/mcp` (OAuth), or run this package locally: `npx clipspeed-mcp@1.1.0` with `CLIPSPEED_API_KEY` |
| **Gemini CLI** | `gemini extensions install https://github.com/thestockgoatballs/clipspeed-agent` |
| **OpenClaw, Hermes Agent, Grok Build, Paperclip, nanoclaw, cron, CI** — anything that runs commands | `npm i -g clipspeed-mcp` then `clipspeed auth:key csai_live_…`, and give the agent `SKILL.md` (`npx skills add thestockgoatballs/clipspeed-agent`) |
| **Claude Desktop (local server)** | `npx clipspeed-mcp@1.1.0 install` writes the server into your Claude Desktop config |

## What the tools do

**Scheduling** — `list_channels` (what is connected, what each platform takes, limits, the account's time zone) · `connect_channel` (a 10-minute link that connects one platform) · `platform_settings` · `schedule_post` (a clip, a text post, or an image/video by URL; `preview: true` books nothing; a picked time is booked exactly or refused with the next open slot) · **`plan_week`** (a project's clips laid over the next 7 days — up to 14 — on the connected platforms, best first, inside the account's limits; `approve: true` books it) · `list_scheduled_posts` · `update_scheduled_post` · `cancel_scheduled_post` · `post_analytics`.

**Clipping** — `clip_video` / `get_clip_status` / `list_clips` / `download_clip` / `restyle_captions` · `discover_trending` · `get_usage`. (The hosted server at `api.clipspeed.ai/mcp` adds live-stream clipping and AI image/video generation.)

Every booking goes through the same rules as the ClipSpeed app: the account's daily caps and spacing, each platform's text limits (X counts every link as 23), one piece of content per platform once (a retry never double-posts), and nothing a user picked is ever silently moved.

## The CLI

```bash
npm i -g clipspeed-mcp
clipspeed auth:key csai_live_…                 # or: export CLIPSPEED_API_KEY=csai_live_…
clipspeed channels:list
clipspeed channels:connect bluesky             # a 10-minute link for the user to open
clipspeed posts:create -p x,linkedin -c "Shipping agentic scheduling today." --at 2026-12-01T14:00:00Z --preview
clipspeed posts:create -p x,linkedin -c "Shipping agentic scheduling today." --at 2026-12-01T14:00:00Z
clipspeed clip https://youtu.be/… --style karaoke && clipspeed status <job_id>
clipspeed plan --project <project-id> --days 7            # the week, per day, in the account's time zone
clipspeed plan --project <project-id> --days 7 --approve  # book exactly that
clipspeed posts:list --status scheduled · clipspeed posts:update <id> -c "new copy" · clipspeed posts:cancel <id> · clipspeed analytics <id>
```

`--json` on any command returns the server's JSON. `--help` lists everything. Refusals are the server's own sentences (plan required, not connected, text too long, day full with the next open time).

## SKILL.md

`SKILL.md` in this package is the agent skill (agentskills format): the hard rules — show the plan before booking, check the channel first, words post verbatim, media is a public URL, same words are the same post — and the standard flows. Claude Code, Codex, Gemini CLI, OpenClaw and Hermes read it as-is; `npx skills add thestockgoatballs/clipspeed-agent` installs it.

## Local MCP server (API key)

```bash
export CLIPSPEED_API_KEY=csai_live_…
npx clipspeed-mcp@1.1.0           # stdio MCP server
```

Pin the version. Env: `CLIPSPEED_API_KEY` (required), `CLIPSPEED_BASE_URL` (default `https://api.clipspeed.ai`).

## Links

Guides per agent: https://www.clipspeed.ai/agents/ · per platform: https://www.clipspeed.ai/schedule/ · developer reference: https://www.clipspeed.ai/mcp/ · source: https://github.com/thestockgoatballs/clipspeed-agent

MIT. ClipSpeed is not affiliated with Anthropic, OpenAI, Google, xAI or any platform named above; product names are used to describe compatibility.
