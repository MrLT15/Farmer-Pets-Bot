# Farmer Pets Discord Bot

[![CI](https://github.com/MrLT15/Farmer-Pets-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/MrLT15/Farmer-Pets-Bot/actions/workflows/ci.yml)

A standalone Discord bot for Farmer Pets wallet-based roles, farm rescue events, daily check-ins, leaderboards, and manual $NKFE payout reporting.

## Requirements

- Node.js 20+
- PostgreSQL database reachable by `DATABASE_URL`
- Existing `public.verified_wallets` table with `discord_id` and `wallet` columns
- Discord bot token plus guild, channel, and role IDs for the target server

## Configuration

Copy `.env.example` into your deployment environment and set the required values:

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token used by `client.login()`. |
| `CLIENT_ID` | Yes | Discord application client ID for slash command registration. |
| `GUILD_ID` | Yes | Discord guild/server ID for slash command registration. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `FARM_CHANNEL_ID` | Recommended | Channel for farm event announcements. Defaults to the Farmer Pets production channel. |
| `LEADERBOARD_CHANNEL_ID` | Recommended | Channel for leaderboard and role-unlock announcements. Defaults to the Farmer Pets production channel. |
| `FARMER_*_ROLE_ID` | Recommended | Role IDs used by `/fp-roles` and event pings. Defaults to Farmer Pets production roles. |
| `HEALTH_PORT` or `PORT` | Optional | Starts a lightweight HTTP health endpoint at `/health` for web-service hosts. |
| `ENABLE_EVENT_THREADS` | Optional | Defaults to `true`; set to `false` if the bot should skip per-event Discord thread creation. |
| `ENABLE_VERIFIED_MEMBER_DMS` | Optional | Defaults to `true`; DMs verified non-bot members when a normal rescue or Commander event starts. |
| `FARM_EVENT_DURATION_MINUTES` | Optional | Defaults to `5`; controls how long normal rescue events stay open. |
| `COMMUNITY_EVENT_DURATION_MINUTES` | Optional | Defaults to `10`; controls Commander-started community event duration. |
| `ATOMIC_API`, `FARMER_PETS_API`, `CONTRACT_ACCOUNT` | Optional | Override only if upstream WAX/Farmer Pets endpoints or contract names change. |
| `NKFE_PAYOUT_SOURCE_WALLET` | Optional | Treasury/source wallet label included in withdrawal provider calls. Defaults to `roadisledger`. |
| `NKFE_TOKEN_SYMBOL` | Optional | Token symbol shown in ledger/withdrawal messages and sent to the withdrawal provider. Defaults to `NKFE`. |
| `NKFE_WITHDRAWAL_WEBHOOK_URL`, `NKFE_WITHDRAWAL_WEBHOOK_SECRET`, `NKFE_WITHDRAWAL_MEMO` | Required for self-service withdrawals | Provider endpoint/secret/memo used by `/fp-withdraw` to send $NKFE from the treasury wallet to the player's verified wallet. |

Short names such as `FARM_CHANNEL`, `LEADERBOARD_CHANNEL`, and `FARMER_VERIFIED_ROLE` are also supported and take precedence over their `_ID` aliases.

## Discord permissions

In the farm event channel, make sure the bot role has:

- View Channel
- Send Messages
- Embed Links
- Create Public Threads, if `ENABLE_EVENT_THREADS=true`
- Send Messages in Threads, if `ENABLE_EVENT_THREADS=true`

If Discord returns `Missing Access` or `Missing Permissions` while creating event threads or posting optional rescue announcements, the bot now logs a concise warning and keeps the command flow running. If you do not want event threads, set `ENABLE_EVENT_THREADS=false`.

## Local checks

```bash
npm install
npm run check
npm test
npm run doctor -- --skip-db
```

`npm run check` syntax-checks all JavaScript files. `npm test` runs the syntax check and the Node.js test suite. `npm run doctor -- --skip-db` validates local configuration without opening a database connection.

## Command reference

General commands:

- `/fp-roles` — sync Farmer Pets Discord roles from verified wallet assets.
- `/fp-rescue` — join the current rescue event.
- `/fp-stats` — show your Farmer Pets stats.
- `/fp-daily` — claim the daily check-in reward.
- `/fp-leaderboard` — show the weekly leaderboard without pinging listed players.
- `/fp-communityevent` — Commander NFT holders can start a 10-minute shared-pool community rescue when no event is active.
- `/fp-withdraw` — withdraw from your Farmer Pets $NKFE bot balance to your verified wallet. Leave `amount` blank to withdraw the full available balance.

Admin-only operational commands:

- `/fp-health` — show bot uptime, configured channels, health-port status, and active event name.
- `/fp-eventstatus` — show active event timers, players, helpers, and co-op progress.
- `/fp-cancelevent` — cancel and close the active event.
- `/fp-postleaderboard` — manually run the Sunday-style leaderboard post and weekly stat reset.
- `/fp-payouts` — show outstanding in-bot $NKFE balances without pinging players.
- `/fp-withdrawals` — show pending legacy/manual $NKFE withdrawal requests, if any.
- `/fp-resetpayouts` — reset payout balances after an out-of-band manual payment.
- `/fp-testevent` — start a test event when no event is active.

## Mini-game mechanics

Rescue success starts at **35%** and can increase from Discord roles, seasonal bonuses, Security Forces NFTs, and Dog companions, but total chance is capped at **85%**. NDV and Parrot utility bonuses add $NKFE only on successful normal rescues. NPC holders receive one extra rescue attempt per active event. Commander NFT holders can start a 10-minute community rescue with a shared payout pool when no other farm event is active.

Normal rescue events default to a 5-minute window and continue to spawn every 2–4 hours. When a normal rescue or Commander-started event begins, the bot also sends a direct message to verified non-bot members if `ENABLE_VERIFIED_MEMBER_DMS=true`.

The weekly leaderboard job runs automatically every Sunday at **5:00 PM America/Los_Angeles**. That scheduled post is the only leaderboard that deliberately tags leaderboard players, ranks by weekly $NKFE earned, and then resets weekly leaderboard stats. Rewards stay in the Farmer Pets bot database as withdrawable balances until players run `/fp-withdraw`; when `NKFE_WITHDRAWAL_WEBHOOK_URL` is configured, the bot calls that provider to send $NKFE from `roadisledger` to the player's verified wallet and then deducts the in-bot balance.

## Health endpoint

Set `HEALTH_PORT` (or platform-provided `PORT`) to start a lightweight HTTP server. `GET /health` returns uptime and active farm-event summary data, which is useful for deployment health checks. In Render, add an environment variable with key `HEALTH_PORT` and value `3000`; do not paste `HEALTH_PORT=3000` into the value field.

## Deployment diagnostics

Run the doctor command after setting environment variables to validate runtime configuration and the `public.verified_wallets` database dependency:

```bash
npm run doctor
```

Use `npm run doctor -- --skip-db` when you only want to validate environment variables and configured Discord IDs.

## Starting the bot

```bash
npm start
```

Startup validates the required runtime configuration before registering Discord handlers or attempting to log in. Database initialization also validates that `public.verified_wallets` exists with the required wallet lookup columns.
