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
| `ATOMIC_API`, `FARMER_PETS_API`, `CONTRACT_ACCOUNT` | Optional | Override only if upstream WAX/Farmer Pets endpoints or contract names change. |

Short names such as `FARM_CHANNEL`, `LEADERBOARD_CHANNEL`, and `FARMER_VERIFIED_ROLE` are also supported and take precedence over their `_ID` aliases.

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
- `/fp-leaderboard` — show the weekly leaderboard.

Admin-only operational commands:

- `/fp-health` — show bot uptime, configured channels, health-port status, and active event name.
- `/fp-eventstatus` — show active event timers, players, helpers, and co-op progress.
- `/fp-cancelevent` — cancel and close the active event.
- `/fp-postleaderboard` — manually post the weekly leaderboard and reset weekly stats.
- `/fp-payouts` — show outstanding manual $NKFE payouts.
- `/fp-resetpayouts` — reset payout balances after manual payment.
- `/fp-testevent` — start a test event when no event is active.

## Health endpoint

Set `HEALTH_PORT` (or platform-provided `PORT`) to start a lightweight HTTP server. `GET /health` returns uptime and active farm-event summary data, which is useful for deployment health checks.

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
