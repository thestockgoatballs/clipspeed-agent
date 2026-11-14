# ClipSpeed in Gemini CLI

The `clipspeed` MCP server (OAuth sign-in in the browser on first use) gives you clipping tools (`submit_to_clipspeed`, `check_clips`, `clip_livestream`, `discover_trending`) and scheduling tools (`list_channels`, `connect_channel`, `platform_settings`, `schedule_post`, `plan_week`, `list_scheduled_posts`, `update_scheduled_post`, `cancel_scheduled_post`, `post_analytics`) on the user's own ClipSpeed account.

Rules that matter: show a plan (`plan_week`, or `schedule_post` with `preview: true`) before booking more than one post; check `list_channels` for what each platform takes and its limits; your words post verbatim; a picked time is booked exactly or refused with the next open slot; report only what the tools return.
