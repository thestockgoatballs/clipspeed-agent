---
name: clipspeed
description: Use when the user wants to turn a video or live stream into ready-to-post captioned clips, schedule or publish social media posts (text, images, video or clips) to YouTube, TikTok, Instagram, X, LinkedIn, Threads, Bluesky or a Facebook Page, plan a week of posts, connect a social account, check what is scheduled, or read a post's numbers — through ClipSpeed.
metadata:
  requirements:
    env:
      - CLIPSPEED_API_KEY
    binaries:
      - clipspeed
---

# ClipSpeed — clip it, plan it, post it

ClipSpeed is the scheduler whose agent also makes the content. One account, one `clipspeed` CLI (or the
same tools over MCP at `https://api.clipspeed.ai/mcp`): cut a video or a live stream into scored,
captioned clips, then plan and book posts — your own words, images, videos or those clips — on the
user's connected channels. The server holds the rules (the account's daily limits, spacing, each
platform's text limits and good hours), so you never have to.

Install: `npm i -g clipspeed-mcp` (gives `clipspeed`), then `clipspeed auth:key csai_live_…` or
`export CLIPSPEED_API_KEY=csai_live_…`. Keys: https://www.clipspeed.ai/dashboard/api-key/ (paid plan or the $1 trial).

## Hard rules

1. **Show before you book.** For anything with more than one post, run `plan` (or `posts:create … --preview`)
   first, show the user the slots in their time zone, and book only after they say yes. The server never
   moves a time the user picked: a slot that breaks the rules is refused with the reason and the next open time.
2. **Check the channel first.** `clipspeed channels:list` says what is connected and what each platform takes
   (text / image / video) and its limits. Do not compose a text post for YouTube or TikTok; do not exceed
   X's 280 (a link counts as 23), Threads 500, Bluesky 300, LinkedIn 3,000. If a channel is missing,
   `clipspeed channels:connect <platform>` returns a 10-minute link for the user to open — you cannot
   sign in for them, and ClipSpeed never sees platform passwords.
3. **Your words post word for word.** A text/image/video post you write is published verbatim (hashtags
   you pass are appended). Write it as it should appear.
4. **Media is a public https URL** (JPG/PNG/WebP/GIF up to 25 MB, MP4/MOV/WebM up to 1 GB) or a ClipSpeed
   clip id. Local files: upload them somewhere public first, or clip through ClipSpeed.
5. **Same words = same post.** Re-running a command with identical content on the same platform is refused
   as a duplicate, so a retry never double-posts. Change the text to post again.
6. **Report what the command returned** — the post ids, local times, refusals and their next open slot.
   Never claim a post went out: `posts:list` shows status and the public link once the platform issued an id.

## The standard flows

**A link → clips → a week of posts (the full loop)**
1. `clipspeed clip <video-url> --style karaoke` → a `job_id` / project id.
2. `clipspeed status <job_id>` every ~60 s until `completed` (clips are final when `hasCaptions` is true).
3. `clipspeed plan --project <project-id> --days 7` → the plan, per day, in the user's time zone. Show it.
4. On yes: `clipspeed plan --project <project-id> --days 7 --approve` → booked posts with ids.

**A post the user dictated**
- `clipspeed posts:create -p x,linkedin -c "Shipping agentic scheduling today." --at 2026-12-01T14:00:00Z --preview`
  then the same without `--preview`. Omit `--at` to post as soon as the account's spacing allows (the
  answer says when). `--media <url>` for an image/video; `--clip <clip-id>` for a ClipSpeed clip;
  `--title` where the platform has one (YouTube requires it); `--privacy unlisted` for YouTube.

**Manage the calendar**
- `clipspeed posts:list [--status scheduled] [--platform x]` · `clipspeed posts:update <id> -c "new copy"`
  (only before it starts sending; the time never changes) · `clipspeed posts:cancel <id>` ·
  `clipspeed analytics <id>`.

**Ideas** — `clipspeed discover "<niche>"` ranks fast-growing recent videos to clip.

## Quick reference

| Command | Does | Key flags |
|---|---|---|
| `channels:list` | connected channels, what each takes, limits, the account time zone | |
| `channels:connect <platform>` | 10-minute connect link for the user | |
| `settings <platform>` | the rules for one platform | |
| `posts:create` | book one post on one or more platforms | `-p` `-c` `--media` `--clip` `--at` `--title` `--hashtags` `--privacy` `--preview` |
| `plan` | lay a project's clips over the next days; `--approve` books | `--project` `--clips` `-p` `--days` `--preset steady\|balanced\|beast` |
| `posts:list` / `posts:update` / `posts:cancel` / `analytics` | the calendar | `--status` `--platform` |
| `clip <url>` / `status <job>` / `clips` / `download <job>` | clipping | `--style` `--aspect` `--count` |
| `discover "<niche>"` / `usage` | ideas, balance | |

Add `--json` to any command for machine-readable output. Errors come back as plain sentences from the server (plan required, not connected, text too long, day full with the next open time) — pass them on unchanged.
