# Mainz

A Discord moderation, utility, giveaway, and Word Bomb bot.

## Run locally

```bash
pnpm install
PORT=5000 pnpm --filter @workspace/api-server run dev
```

## Railway deployment

Railway uses `railway.json` to build and start the API server. The pre-deploy command runs the database migration and pushes the Drizzle schema before starting the bot, so database tables are created or updated before the bot connects. Add these variables to the Railway service:

- `DATABASE_URL` — PostgreSQL connection string used by the bot
- `DISCORD_BOT_TOKEN` — Discord bot token

Railway provides `PORT` automatically.

## Join to Create voice channels

Members who join a designated lobby voice channel get their own temporary voice channel, which is deleted automatically once it is empty. Configure it with:

- `JTC_LOBBY_CHANNEL_ID` — ID of the lobby voice channel (required; the feature is disabled when unset)
- `JTC_CATEGORY_ID` — ID of the category for created channels (optional; defaults to the lobby's category)

Each created channel is explicitly visible and joinable, even when its parent category denies those permissions. Its chat welcomes and pings the owner with a single **Commands** button. Clicking it opens a private control panel with action buttons and the full command list; parameterized actions prompt for their values. Owners can also use `!voice` (aliases `!v` and `!vc`) or `/voice help`. Bumping moves a channel to the top of its category with a one-hour cooldown; bitrate is limited by the server's boost tier. Ownership passes to another member when the owner leaves.

The bot needs the Manage Channels and Move Members permissions, and the Guild Voice States gateway intent. Temporary channels are tracked in memory, so channels left over from before a restart are not cleaned up automatically.

The bot service must remain running continuously because Discord bots require a long-lived process.

## Credits

Members earn 20 credits from chat once per minute. Use `!credit` to check the server balance.

Server managers can create reusable custom embeds with `!embed new <name>`, set content with `!embed edit <name> <title|author|description|color|image|thumbnail|footer> <value>`, add fields with `!embed field <name> add <field name>|<value>|[inline]`, preview with `!embed show <name>`, and send with `!embed send <name> #channel`. Use `!embed list` to see saved embeds; `!embed clear <name> <field>` clears one setting. Hex colors must use `#RRGGBB`; image and thumbnail values must be HTTP(S) URLs. Existing command-response embeds can be customized by command, for example `!embed override ban color #5865F2` or `!embed override ban author Moderation`, then previewed with `!embed override-show ban`. Use `!embed override-clear ban color` to clear one override or `!embed override-reset ban` to restore that command's defaults. `!embed` lists the full syntax.