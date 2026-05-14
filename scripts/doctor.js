const { Pool } = require("pg");

const config = require("../src/config");

const REQUIRED_CONFIG = {
  DISCORD_TOKEN: "TOKEN",
  CLIENT_ID: "CLIENT_ID",
  GUILD_ID: "GUILD_ID",
  DATABASE_URL: "DATABASE_URL"
};

function getMissingRuntimeConfig(runtimeConfig = {}) {
  return Object.entries(REQUIRED_CONFIG)
    .filter(([, key]) => !runtimeConfig[key])
    .map(([name]) => name);
}

async function checkDatabase(runtimeConfig, { PoolClass = Pool } = {}) {
  if (!runtimeConfig.DATABASE_URL) {
    return {
      ok: false,
      skipped: true,
      message: "DATABASE_URL is missing; database checks were skipped."
    };
  }

  const pool = new PoolClass({
    connectionString: runtimeConfig.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const tableRes = await pool.query(
      "SELECT to_regclass('public.verified_wallets') AS verified_wallets"
    );

    if (!tableRes.rows[0]?.verified_wallets) {
      return {
        ok: false,
        message: "Missing required table public.verified_wallets."
      };
    }

    const columnRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'verified_wallets'
        AND column_name = ANY($1::text[]);
    `, [["discord_id", "wallet"]]);

    const columns = new Set(columnRes.rows.map(row => row.column_name));
    const missingColumns = ["discord_id", "wallet"].filter(column => !columns.has(column));

    if (missingColumns.length) {
      return {
        ok: false,
        message: `Table public.verified_wallets is missing required column(s): ${missingColumns.join(", ")}.`
      };
    }

    return {
      ok: true,
      message: "Database connection and verified_wallets schema look ready."
    };
  } finally {
    await pool.end();
  }
}

function parseArgs(argv) {
  return {
    skipDatabase: argv.includes("--skip-db")
  };
}

async function runDoctor({
  runtimeConfig = config,
  logger = console,
  PoolClass = Pool,
  skipDatabase = false
} = {}) {
  const missingConfig = getMissingRuntimeConfig(runtimeConfig);
  let exitCode = 0;

  logger.log("Farmer Pets Bot doctor\n");

  if (missingConfig.length) {
    exitCode = 1;
    logger.error(`❌ Missing required config: ${missingConfig.join(", ")}`);
  } else {
    logger.log("✅ Required runtime config is present.");
  }

  logger.log(`ℹ️ Farm channel: ${runtimeConfig.FARM_CHANNEL || "not configured"}`);
  logger.log(`ℹ️ Leaderboard channel: ${runtimeConfig.LEADERBOARD_CHANNEL || "not configured"}`);
  logger.log(`ℹ️ Verified role: ${runtimeConfig.FARMER_VERIFIED_ROLE || "not configured"}`);
  logger.log(`ℹ️ Event threads: ${runtimeConfig.ENABLE_EVENT_THREADS === false ? "disabled" : "enabled"}`);

  if (runtimeConfig.NKFE_PAYOUT_API_URL) {
    logger.log("✅ NKFE payout API URL is configured for withdrawals.");
  } else {
    logger.log(
      "⚠️ Automatic $NKFE withdrawals are not configured. Set NKFE_PAYOUT_API_URL for the external payout API."
    );
  }

  if (skipDatabase) {
    logger.log("⚠️ Database checks skipped by --skip-db.");
    return exitCode;
  }

  try {
    const dbCheck = await checkDatabase(runtimeConfig, { PoolClass });

    if (dbCheck.ok) {
      logger.log(`✅ ${dbCheck.message}`);
    } else if (dbCheck.skipped) {
      logger.log(`⚠️ ${dbCheck.message}`);
    } else {
      exitCode = 1;
      logger.error(`❌ ${dbCheck.message}`);
    }
  } catch (error) {
    exitCode = 1;
    logger.error("❌ Database check failed:", error.message);
  }

  return exitCode;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  runDoctor(options).then(exitCode => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  checkDatabase,
  getMissingRuntimeConfig,
  parseArgs,
  runDoctor
};
