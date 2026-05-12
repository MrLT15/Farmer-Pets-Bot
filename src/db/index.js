const { Pool } = require("pg");

const { DATABASE_URL } = require("../config");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function createDatabase(dbPool, { logger = console } = {}) {
  async function close() {
    if (typeof dbPool.end === "function") {
      await dbPool.end();
    }
  }

  async function initDatabase() {
    await validateRequiredTables();

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS farmerpets_balances (
        discord_id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        payout_nkfe INTEGER NOT NULL DEFAULT 0,
        lifetime_nkfe INTEGER NOT NULL DEFAULT 0,
        total_successes INTEGER NOT NULL DEFAULT 0,
        total_attempts INTEGER NOT NULL DEFAULT 0,
        weekly_nkfe INTEGER NOT NULL DEFAULT 0,
        weekly_successes INTEGER NOT NULL DEFAULT 0,
        weekly_attempts INTEGER NOT NULL DEFAULT 0,
        daily_streak INTEGER NOT NULL DEFAULT 0,
        best_daily_streak INTEGER NOT NULL DEFAULT 0,
        last_daily_checkin DATE,
        current_rescue_streak INTEGER NOT NULL DEFAULT 0,
        best_rescue_streak INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await dbPool.query(`
      ALTER TABLE farmerpets_balances
        ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS best_daily_streak INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_daily_checkin DATE,
        ADD COLUMN IF NOT EXISTS current_rescue_streak INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS best_rescue_streak INTEGER NOT NULL DEFAULT 0;
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS farmerpets_logs (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        event_name TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        reward INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    logger.log("Farmer Pets database tables ready.");
  }

  async function validateRequiredTables() {
    const tableRes = await dbPool.query(
      "SELECT to_regclass('public.verified_wallets') AS verified_wallets"
    );

    if (!tableRes.rows[0]?.verified_wallets) {
      throw new Error(
        "Missing required table public.verified_wallets. This bot depends on an existing wallet verification table with discord_id and wallet columns."
      );
    }

    const columnRes = await dbPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'verified_wallets'
        AND column_name = ANY($1::text[]);
    `, [["discord_id", "wallet"]]);

    const columns = new Set(columnRes.rows.map(row => row.column_name));
    const missingColumns = ["discord_id", "wallet"].filter(
      column => !columns.has(column)
    );

    if (missingColumns.length) {
      throw new Error(
        `Table public.verified_wallets is missing required column(s): ${missingColumns.join(", ")}.`
      );
    }
  }

  async function getWallet(discordId) {
    const res = await dbPool.query(
      "SELECT wallet FROM verified_wallets WHERE discord_id = $1",
      [discordId]
    );

    return res.rows[0]?.wallet || null;
  }

  async function ensurePlayer(discordId, wallet) {
    await dbPool.query(
      `
      INSERT INTO farmerpets_balances (discord_id, wallet, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (discord_id)
      DO UPDATE SET wallet = EXCLUDED.wallet, updated_at = NOW();
      `,
      [discordId, wallet]
    );
  }

  async function awardCommunityMilestoneReward(discordIds, reward) {
    if (!discordIds.length || reward <= 0) return 0;

    const res = await dbPool.query(
      `
      UPDATE farmerpets_balances
      SET payout_nkfe = payout_nkfe + $2,
          lifetime_nkfe = lifetime_nkfe + $2,
          weekly_nkfe = weekly_nkfe + $2,
          updated_at = NOW()
      WHERE discord_id = ANY($1::text[]);
      `,
      [discordIds, reward]
    );

    return res.rowCount;
  }

  async function recordRescue(discordId, wallet, eventName, success, reward) {
    await dbPool.query(
      `
      INSERT INTO farmerpets_logs (discord_id, wallet, event_name, success, reward)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [discordId, wallet, eventName, success, reward]
    );

    const rescueStreak = success ? 1 : 0;

    const res = await dbPool.query(
      `
      INSERT INTO farmerpets_balances (
        discord_id,
        wallet,
        payout_nkfe,
        lifetime_nkfe,
        total_successes,
        total_attempts,
        weekly_nkfe,
        weekly_successes,
        weekly_attempts,
        current_rescue_streak,
        best_rescue_streak,
        updated_at
      )
      VALUES ($1, $2, $3, $3, $4, 1, $3, $4, 1, $5, $5, NOW())
      ON CONFLICT (discord_id)
      DO UPDATE SET
        wallet = EXCLUDED.wallet,
        payout_nkfe = farmerpets_balances.payout_nkfe + EXCLUDED.payout_nkfe,
        lifetime_nkfe = farmerpets_balances.lifetime_nkfe + EXCLUDED.lifetime_nkfe,
        total_successes = farmerpets_balances.total_successes + EXCLUDED.total_successes,
        total_attempts = farmerpets_balances.total_attempts + 1,
        weekly_nkfe = farmerpets_balances.weekly_nkfe + EXCLUDED.weekly_nkfe,
        weekly_successes = farmerpets_balances.weekly_successes + EXCLUDED.weekly_successes,
        weekly_attempts = farmerpets_balances.weekly_attempts + 1,
        current_rescue_streak = CASE
          WHEN $4 = 1 THEN farmerpets_balances.current_rescue_streak + 1
          ELSE 0
        END,
        best_rescue_streak = CASE
          WHEN $4 = 1 THEN GREATEST(
            farmerpets_balances.best_rescue_streak,
            farmerpets_balances.current_rescue_streak + 1
          )
          ELSE farmerpets_balances.best_rescue_streak
        END,
        updated_at = NOW()
      RETURNING current_rescue_streak, best_rescue_streak;
      `,
      [discordId, wallet, reward, success ? 1 : 0, rescueStreak]
    );

    return res.rows[0];
  }

  async function awardCommunityEventPayouts(entries, reward, eventName) {
    if (!entries.length || reward <= 0) return 0;

    for (const entry of entries) {
      await dbPool.query(
        `
        INSERT INTO farmerpets_logs (discord_id, wallet, event_name, success, reward)
        VALUES ($1, $2, $3, TRUE, $4);
        `,
        [entry.discordId, entry.wallet, eventName, reward]
      );

      await dbPool.query(
        `
        INSERT INTO farmerpets_balances (
          discord_id, wallet, payout_nkfe, lifetime_nkfe, weekly_nkfe, updated_at
        )
        VALUES ($1, $2, $3, $3, $3, NOW())
        ON CONFLICT (discord_id)
        DO UPDATE SET
          wallet = EXCLUDED.wallet,
          payout_nkfe = farmerpets_balances.payout_nkfe + EXCLUDED.payout_nkfe,
          lifetime_nkfe = farmerpets_balances.lifetime_nkfe + EXCLUDED.lifetime_nkfe,
          weekly_nkfe = farmerpets_balances.weekly_nkfe + EXCLUDED.weekly_nkfe,
          updated_at = NOW();
        `,
        [entry.discordId, entry.wallet, reward]
      );
    }

    return entries.length;
  }

  async function getDailyCheckInState(discordId) {
    const res = await dbPool.query(
      `
      SELECT daily_streak,
             best_daily_streak,
             to_char(last_daily_checkin, 'YYYY-MM-DD') AS last_daily_checkin_key
      FROM farmerpets_balances
      WHERE discord_id = $1;
      `,
      [discordId]
    );

    return res.rows[0] || {};
  }

  async function recordDailyCheckIn(discordId, reward, streak, todayKey) {
    const res = await dbPool.query(
      `
      UPDATE farmerpets_balances
      SET payout_nkfe = payout_nkfe + $2,
          lifetime_nkfe = lifetime_nkfe + $2,
          weekly_nkfe = weekly_nkfe + $2,
          daily_streak = $3,
          best_daily_streak = GREATEST(best_daily_streak, $3),
          last_daily_checkin = $4::date,
          updated_at = NOW()
      WHERE discord_id = $1
      RETURNING daily_streak, best_daily_streak;
      `,
      [discordId, reward, streak, todayKey]
    );

    return res.rows[0];
  }

  async function getStatsRow(discordId) {
    const res = await dbPool.query(
      `
      SELECT *, to_char(last_daily_checkin, 'YYYY-MM-DD') AS last_daily_checkin_key
      FROM farmerpets_balances
      WHERE discord_id = $1;
      `,
      [discordId]
    );

    return res.rows[0];
  }

  async function getWeeklyLeaderboardRows() {
    const res = await dbPool.query(`
      SELECT discord_id, wallet, weekly_nkfe, weekly_successes, weekly_attempts, lifetime_nkfe
      FROM farmerpets_balances
      WHERE weekly_attempts > 0 OR weekly_nkfe > 0
      ORDER BY weekly_nkfe DESC, weekly_successes DESC, weekly_attempts DESC
      LIMIT 10;
    `);

    return res.rows;
  }

  async function getPayoutRows() {
    const res = await dbPool.query(`
      SELECT wallet, discord_id, payout_nkfe
      FROM farmerpets_balances
      WHERE payout_nkfe > 0
      ORDER BY payout_nkfe DESC;
    `);

    return res.rows;
  }

  async function resetWeeklyStats() {
    await dbPool.query(`
      UPDATE farmerpets_balances
      SET weekly_nkfe = 0,
          weekly_successes = 0,
          weekly_attempts = 0,
          updated_at = NOW();
    `);
  }

  async function resetPayouts() {
    await dbPool.query(`
      UPDATE farmerpets_balances
      SET payout_nkfe = 0,
          updated_at = NOW();
    `);
  }


  return {
    awardCommunityEventPayouts,
    awardCommunityMilestoneReward,
    close,
    ensurePlayer,
    getDailyCheckInState,
    getPayoutRows,
    getStatsRow,
    getWallet,
    getWeeklyLeaderboardRows,
    initDatabase,
    recordDailyCheckIn,
    recordRescue,
    resetPayouts,
    resetWeeklyStats,
    validateRequiredTables
  };
}

const database = createDatabase(pool);

module.exports = {
  createDatabase,
  ...database
};
