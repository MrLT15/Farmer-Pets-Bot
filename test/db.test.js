const assert = require("node:assert/strict");
const test = require("node:test");

const { createDatabase } = require("../src/db");

function createMockPool(results = []) {
  const calls = [];

  return {
    calls,
    endCalls: 0,
    async end() {
      this.endCalls++;
    },
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
    "awardCommunityEventPayouts",
    "awardCommunityMilestoneReward",
    "clearPayoutsForDiscordIds",
    "close",
    "ensurePlayer",
    "getDailyCheckInState",
    "getPayoutRows",
    "getPendingWithdrawalRows",
    "getPlayerBalance",
    "getStatsRow",
    "getWallet",
    "getWeeklyLeaderboardRows",
    "initDatabase",
    "recordDailyCheckIn",
    "recordRescue",
    "requestWithdrawal",
    "resetPayouts",
    "resetWeeklyStats",
    "validateRequiredTables"
  ].sort());
});



test("close ends the injected pool when supported", async () => {
  const pool = createMockPool();
  const db = createDatabase(pool);

  await db.close();

  assert.equal(pool.endCalls, 1);
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
    { rows: [] },
    { rows: [] }
  ]);
  const db = createDatabase(pool, { logger: { log: message => logs.push(message) } });

  await db.initDatabase();

  assert.equal(pool.calls.length, 6);
  assert.match(normalizeSql(pool.calls[2].sql), /CREATE TABLE IF NOT EXISTS farmerpets_balances/);
  assert.match(normalizeSql(pool.calls[3].sql), /ALTER TABLE farmerpets_balances/);
  assert.match(normalizeSql(pool.calls[4].sql), /CREATE TABLE IF NOT EXISTS farmerpets_withdrawals/);
  assert.match(normalizeSql(pool.calls[5].sql), /CREATE TABLE IF NOT EXISTS farmerpets_logs/);
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


test("clearPayoutsForDiscordIds resets only paid payout balances", async () => {
  const pool = createMockPool([{ rows: [], rowCount: 2 }]);
  const db = createDatabase(pool);

  assert.equal(await db.clearPayoutsForDiscordIds(["discord-1", "discord-2"]), 2);
  assert.match(normalizeSql(pool.calls[0].sql), /WHERE discord_id = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(pool.calls[0].params, [["discord-1", "discord-2"]]);
});

test("clearPayoutsForDiscordIds skips empty paid id lists", async () => {
  const pool = createMockPool();
  const db = createDatabase(pool);

  assert.equal(await db.clearPayoutsForDiscordIds([]), 0);
  assert.deepEqual(pool.calls, []);
});


test("requestWithdrawal locks bot balance and creates a pending withdrawal", async () => {
  const pool = createMockPool([
    { rows: [] },
    { rows: [{ payout_nkfe: 12 }] },
    { rows: [] },
    { rows: [{ id: 9, discord_id: "discord-1", wallet: "farmer.wam", amount_nkfe: 5, status: "pending" }] },
    { rows: [] }
  ]);
  const db = createDatabase(pool);

  const result = await db.requestWithdrawal("discord-1", "farmer.wam", 5);

  assert.equal(result.ok, true);
  assert.equal(result.remaining, 7);
  assert.equal(result.withdrawal.id, 9);
  assert.equal(pool.calls[0].sql, "BEGIN");
  assert.match(normalizeSql(pool.calls[1].sql), /FOR UPDATE/);
  assert.match(normalizeSql(pool.calls[2].sql), /SET payout_nkfe = payout_nkfe - \$2/);
  assert.match(normalizeSql(pool.calls[3].sql), /INSERT INTO farmerpets_withdrawals/);
  assert.equal(pool.calls[4].sql, "COMMIT");
});

test("requestWithdrawal rejects requests above available balance", async () => {
  const pool = createMockPool([
    { rows: [] },
    { rows: [{ payout_nkfe: 3 }] },
    { rows: [] }
  ]);
  const db = createDatabase(pool);

  assert.deepEqual(await db.requestWithdrawal("discord-1", "farmer.wam", 5), {
    ok: false,
    available: 3,
    requested: 5
  });
  assert.equal(pool.calls[2].sql, "ROLLBACK");
});
