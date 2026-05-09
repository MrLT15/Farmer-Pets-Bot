const assert = require("node:assert/strict");
const test = require("node:test");

const { createDatabase } = require("../src/db");

function createMockPool(results = []) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const result = results.shift();

      if (result instanceof Error) {
        throw result;
      }

      return result || { rows: [], rowCount: 0 };
    }
  };
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

test("createDatabase exposes the database helper surface", () => {
  const db = createDatabase(createMockPool());

  assert.deepEqual(Object.keys(db).sort(), [
    "awardCommunityMilestoneReward",
    "ensurePlayer",
    "getDailyCheckInState",
    "getPayoutRows",
    "getStatsRow",
    "getWallet",
    "getWeeklyLeaderboardRows",
    "initDatabase",
    "recordDailyCheckIn",
    "recordRescue",
    "resetPayouts",
    "resetWeeklyStats",
    "validateRequiredTables"
  ].sort());
});

test("validateRequiredTables fails when verified_wallets table is missing", async () => {
  const pool = createMockPool([{ rows: [{ verified_wallets: null }] }]);
  const db = createDatabase(pool);

  await assert.rejects(
    () => db.validateRequiredTables(),
    /Missing required table public\.verified_wallets/
  );
  assert.equal(pool.calls.length, 1);
  assert.match(normalizeSql(pool.calls[0].sql), /to_regclass\('public\.verified_wallets'\)/);
});

test("validateRequiredTables reports missing required wallet columns", async () => {
  const pool = createMockPool([
    { rows: [{ verified_wallets: "verified_wallets" }] },
    { rows: [{ column_name: "discord_id" }] }
  ]);
  const db = createDatabase(pool);

  await assert.rejects(
    () => db.validateRequiredTables(),
    /missing required column\(s\): wallet/
  );
  assert.deepEqual(pool.calls[1].params, [["discord_id", "wallet"]]);
});

test("initDatabase validates dependencies, creates tables, and logs readiness", async () => {
  const logs = [];
  const pool = createMockPool([
    { rows: [{ verified_wallets: "verified_wallets" }] },
    { rows: [{ column_name: "discord_id" }, { column_name: "wallet" }] },
    { rows: [] },
    { rows: [] },
    { rows: [] }
  ]);
  const db = createDatabase(pool, { logger: { log: message => logs.push(message) } });

  await db.initDatabase();

  assert.equal(pool.calls.length, 5);
  assert.match(normalizeSql(pool.calls[2].sql), /CREATE TABLE IF NOT EXISTS farmerpets_balances/);
  assert.match(normalizeSql(pool.calls[3].sql), /ALTER TABLE farmerpets_balances/);
  assert.match(normalizeSql(pool.calls[4].sql), /CREATE TABLE IF NOT EXISTS farmerpets_logs/);
  assert.deepEqual(logs, ["Farmer Pets database tables ready."]);
});

test("getWallet returns the verified wallet or null", async () => {
  const foundPool = createMockPool([{ rows: [{ wallet: "farmer.wam" }] }]);
  const foundDb = createDatabase(foundPool);

  assert.equal(await foundDb.getWallet("discord-1"), "farmer.wam");
  assert.deepEqual(foundPool.calls[0].params, ["discord-1"]);

  const missingDb = createDatabase(createMockPool([{ rows: [] }]));

  assert.equal(await missingDb.getWallet("discord-2"), null);
});

test("awardCommunityMilestoneReward skips empty or non-positive awards", async () => {
  const pool = createMockPool();
  const db = createDatabase(pool);

  assert.equal(await db.awardCommunityMilestoneReward([], 5), 0);
  assert.equal(await db.awardCommunityMilestoneReward(["discord-1"], 0), 0);
  assert.deepEqual(pool.calls, []);
});

test("recordRescue writes the log and updates rescue streak state", async () => {
  const pool = createMockPool([
    { rows: [] },
    { rows: [{ current_rescue_streak: 3, best_rescue_streak: 5 }] }
  ]);
  const db = createDatabase(pool);

  const streak = await db.recordRescue("discord-1", "farmer.wam", "Barn Fire", true, 4);

  assert.deepEqual(streak, { current_rescue_streak: 3, best_rescue_streak: 5 });
  assert.match(normalizeSql(pool.calls[0].sql), /INSERT INTO farmerpets_logs/);
  assert.deepEqual(pool.calls[0].params, ["discord-1", "farmer.wam", "Barn Fire", true, 4]);
  assert.match(normalizeSql(pool.calls[1].sql), /RETURNING current_rescue_streak, best_rescue_streak/);
  assert.deepEqual(pool.calls[1].params, ["discord-1", "farmer.wam", 4, 1, 1]);
});

test("recordDailyCheckIn persists rewards and returns streak totals", async () => {
  const pool = createMockPool([{ rows: [{ daily_streak: 7, best_daily_streak: 9 }] }]);
  const db = createDatabase(pool);

  const updated = await db.recordDailyCheckIn("discord-1", 8, 7, "2026-05-09");

  assert.deepEqual(updated, { daily_streak: 7, best_daily_streak: 9 });
  assert.match(normalizeSql(pool.calls[0].sql), /last_daily_checkin = \$4::date/);
  assert.deepEqual(pool.calls[0].params, ["discord-1", 8, 7, "2026-05-09"]);
});
