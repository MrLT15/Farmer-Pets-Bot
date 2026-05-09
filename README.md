# Farmer Pets Discord Bot

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
| `ATOMIC_API`, `FARMER_PETS_API`, `CONTRACT_ACCOUNT` | Optional | Override only if upstream WAX/Farmer Pets endpoints or contract names change. |

Short names such as `FARM_CHANNEL`, `LEADERBOARD_CHANNEL`, and `FARMER_VERIFIED_ROLE` are also supported and take precedence over their `_ID` aliases.

## Local checks

```bash
npm install
npm run check
npm test
```

`npm run check` syntax-checks all JavaScript files. `npm test` runs the syntax check and the Node.js test suite.

## Starting the bot

```bash
npm start
```

Startup validates the required runtime configuration before registering Discord handlers or attempting to log in. Database initialization also validates that `public.verified_wallets` exists with the required wallet lookup columns.
