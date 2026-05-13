const assert = require("node:assert/strict");
const test = require("node:test");

const {
  checkDatabase,
  getMissingRuntimeConfig,
  parseArgs,
  runDoctor
} = require("../scripts/doctor");

const READY_CONFIG = {
  TOKEN: "token",
  CLIENT_ID: "client",
  GUILD_ID: "guild",
  DATABASE_URL: "postgres://user:password@host/db",
  FARM_CHANNEL: "farm-channel",
  LEADERBOARD_CHANNEL: "leaderboard-channel",
  FARMER_VERIFIED_ROLE: "verified-role",
  WAX_RPC_URL: "https://wax.example",
  NKFE_TOKEN_CONTRACT: "nkfe.token",
  NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
  NKFE_TREASURY_PRIVATE_KEY: "private-key"
};

function createPoolClass(results) {
  const instances = [];

  class MockPool {
    constructor(options) {
      this.options = options;
      this.endCalls = 0;
      this.queryCalls = [];
      instances.push(this);
    }

    async query(sql, params) {
      this.queryCalls.push({ sql, params });
      const result = results.shift();

      if (result instanceof Error) {
        throw result;
      }

      return result || { rows: [] };
    }

    async end() {
      this.endCalls++;
    }
  }

  MockPool.instances = instances;
  return MockPool;
}

function createLogger() {
  const logs = [];

  return {
    logs,
    logger: {
      error: (...args) => logs.push(["error", ...args]),
      log: (...args) => logs.push(["log", ...args])
    }
  };
}

test("getMissingRuntimeConfig lists missing deployment settings", () => {
  assert.deepEqual(getMissingRuntimeConfig({ TOKEN: "token" }), [
    "CLIENT_ID",
    "GUILD_ID",
    "DATABASE_URL"
  ]);
});

test("parseArgs supports skipping database checks", () => {
  assert.deepEqual(parseArgs(["--skip-db"]), { skipDatabase: true });
  assert.deepEqual(parseArgs([]), { skipDatabase: false });
});

test("checkDatabase verifies required table and columns", async () => {
  const PoolClass = createPoolClass([
    { rows: [{ verified_wallets: "verified_wallets" }] },
    { rows: [{ column_name: "discord_id" }, { column_name: "wallet" }] }
  ]);

  assert.deepEqual(await checkDatabase(READY_CONFIG, { PoolClass }), {
    ok: true,
    message: "Database connection and verified_wallets schema look ready."
  });
  assert.equal(PoolClass.instances[0].endCalls, 1);
  assert.deepEqual(PoolClass.instances[0].queryCalls[1].params, [["discord_id", "wallet"]]);
});

test("checkDatabase reports missing database prerequisites", async () => {
  assert.deepEqual(await checkDatabase({ ...READY_CONFIG, DATABASE_URL: undefined }), {
    ok: false,
    skipped: true,
    message: "DATABASE_URL is missing; database checks were skipped."
  });

  const missingTablePool = createPoolClass([{ rows: [{ verified_wallets: null }] }]);

  assert.deepEqual(await checkDatabase(READY_CONFIG, { PoolClass: missingTablePool }), {
    ok: false,
    message: "Missing required table public.verified_wallets."
  });

  const missingColumnPool = createPoolClass([
    { rows: [{ verified_wallets: "verified_wallets" }] },
    { rows: [{ column_name: "discord_id" }] }
  ]);

  assert.deepEqual(await checkDatabase(READY_CONFIG, { PoolClass: missingColumnPool }), {
    ok: false,
    message: "Table public.verified_wallets is missing required column(s): wallet."
  });
});

test("runDoctor returns success when config and database checks pass", async () => {
  const { logger, logs } = createLogger();
  const PoolClass = createPoolClass([
    { rows: [{ verified_wallets: "verified_wallets" }] },
    { rows: [{ column_name: "discord_id" }, { column_name: "wallet" }] }
  ]);

  const exitCode = await runDoctor({ runtimeConfig: READY_CONFIG, logger, PoolClass });

  assert.equal(exitCode, 0);
  assert.equal(logs.some(entry => entry.includes("✅ Required runtime config is present.")), true);
  assert.equal(logs.some(entry => entry.includes("✅ Direct WAX withdrawals are configured.")), true);
  assert.equal(logs.some(entry => entry.includes("✅ Database connection and verified_wallets schema look ready.")), true);
});

test("runDoctor reports which withdrawal settings are missing without failing", async () => {
  const { logger, logs } = createLogger();

  const exitCode = await runDoctor({
    runtimeConfig: {
      ...READY_CONFIG,
      NKFE_TOKEN_CONTRACT: "",
      NKFE_TREASURY_PRIVATE_KEY: ""
    },
    logger,
    skipDatabase: true
  });

  assert.equal(exitCode, 0);
  const warning = logs.find(entry => entry[1]?.includes("Automatic $NKFE withdrawals are not configured"));
  assert.match(warning[1], /NKFE_TOKEN_CONTRACT/);
  assert.match(warning[1], /NKFE_TREASURY_PRIVATE_KEY/);
  assert.match(warning[1], /NKFE_WITHDRAWAL_WEBHOOK_URL/);
});

test("runDoctor returns failure for missing config or failed database checks", async () => {
  const missing = createLogger();

  assert.equal(await runDoctor({ runtimeConfig: {}, logger: missing.logger, skipDatabase: true }), 1);
  assert.deepEqual(missing.logs.find(entry => entry[0] === "error"), [
    "error",
    "❌ Missing required config: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, DATABASE_URL"
  ]);

  const failingDb = createLogger();
  const PoolClass = createPoolClass([new Error("connection refused")]);

  assert.equal(await runDoctor({ runtimeConfig: READY_CONFIG, logger: failingDb.logger, PoolClass }), 1);
  assert.deepEqual(failingDb.logs.find(entry => entry[0] === "error"), [
    "error",
    "❌ Database check failed:",
    "connection refused"
  ]);
});
