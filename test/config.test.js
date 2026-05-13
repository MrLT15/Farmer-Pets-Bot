const assert = require("node:assert/strict");
const test = require("node:test");

const CONFIG_PATH = require.resolve("../src/config");
const ENV_NAMES = [
  "FARM_CHANNEL",
  "FARM_CHANNEL_ID",
  "LEADERBOARD_CHANNEL",
  "LEADERBOARD_CHANNEL_ID",
  "FARMER_VERIFIED_ROLE",
  "FARMER_VERIFIED_ROLE_ID",
  "FARMER_FOOD_ROLE",
  "FARMER_FOOD_ROLE_ID",
  "FARMER_WOOD_ROLE",
  "FARMER_WOOD_ROLE_ID",
  "FARMER_SILVER_ROLE",
  "FARMER_SILVER_ROLE_ID",
  "FARMER_TOOL_ROLE",
  "FARMER_TOOL_ROLE_ID",
  "FARMER_WORKING_FARM_ROLE",
  "FARMER_WORKING_FARM_ROLE_ID",
  "FARMER_FULL_FARM_ROLE",
  "FARMER_FULL_FARM_ROLE_ID",
  "ATOMIC_API",
  "FARMER_PETS_API",
  "CONTRACT_ACCOUNT",
  "NKFE_PAYOUT_SOURCE_WALLET",
  "NKFE_TOKEN_SYMBOL",
  "ENABLE_VERIFIED_MEMBER_DMS",
  "HEALTH_PORT",
  "PORT",
  "ENABLE_EVENT_THREADS",
  "FARM_EVENT_DURATION_MINUTES",
  "COMMUNITY_EVENT_DURATION_MINUTES"
];

function withConfigEnv(overrides, callback) {
  const original = new Map(ENV_NAMES.map(name => [name, process.env[name]]));

  for (const name of ENV_NAMES) {
    delete process.env[name];
  }

  Object.assign(process.env, overrides);
  delete require.cache[CONFIG_PATH];

  try {
    return callback(require(CONFIG_PATH));
  } finally {
    delete require.cache[CONFIG_PATH];

    for (const name of ENV_NAMES) {
      const value = original.get(name);

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("config uses stable Farmer Pets defaults when deployment overrides are absent", () => {
  withConfigEnv({}, config => {
    assert.equal(config.FARM_CHANNEL, "1270948980615938109");
    assert.equal(config.LEADERBOARD_CHANNEL, "1499255526054170825");
    assert.equal(config.FARMER_VERIFIED_ROLE, "1499240994397356112");
    assert.equal(config.ROLES.verified.id, "1499240994397356112");
    assert.equal(config.ROLES.fullFarm.id, "1499242342937399508");
    assert.equal(config.ATOMIC_API, "https://wax.api.atomicassets.io/atomicassets/v1/assets");
    assert.equal(config.FARMER_PETS_API, "https://pets-api-main.herokuapp.com");
    assert.equal(config.CONTRACT_ACCOUNT, "farmerpetssc");
    assert.equal(config.NKFE_PAYOUT_SOURCE_WALLET, "roadisledger");
    assert.equal(config.NKFE_TOKEN_SYMBOL, "NKFE");
    assert.equal(config.ENABLE_VERIFIED_MEMBER_DMS, true);
    assert.equal(config.HEALTH_PORT, undefined);
    assert.equal(config.ENABLE_EVENT_THREADS, true);
    assert.equal(config.FARM_EVENT_DURATION_MINUTES, 5);
    assert.equal(config.FARM_EVENT_DURATION_MS, 5 * 60 * 1000);
    assert.equal(config.COMMUNITY_EVENT_DURATION_MINUTES, 10);
    assert.equal(config.COMMUNITY_EVENT_DURATION_MS, 10 * 60 * 1000);
  });
});

test("config allows deployment environment to override channel, role, and API values", () => {
  withConfigEnv({
    FARM_CHANNEL_ID: "farm-channel-from-env",
    LEADERBOARD_CHANNEL_ID: "leaderboard-channel-from-env",
    FARMER_VERIFIED_ROLE_ID: "verified-role-from-env",
    FARMER_FOOD_ROLE_ID: "food-role-from-env",
    FARMER_WOOD_ROLE_ID: "wood-role-from-env",
    FARMER_SILVER_ROLE_ID: "silver-role-from-env",
    FARMER_TOOL_ROLE_ID: "tool-role-from-env",
    FARMER_WORKING_FARM_ROLE_ID: "working-farm-role-from-env",
    FARMER_FULL_FARM_ROLE_ID: "full-farm-role-from-env",
    ATOMIC_API: "https://atomic.example.test/assets",
    FARMER_PETS_API: "https://pets.example.test",
    CONTRACT_ACCOUNT: "contractacct",
    NKFE_PAYOUT_SOURCE_WALLET: "sourcewallet",
    NKFE_TOKEN_SYMBOL: "NKFE",
    HEALTH_PORT: "8080",
    ENABLE_EVENT_THREADS: "false",
    ENABLE_VERIFIED_MEMBER_DMS: "false",
    FARM_EVENT_DURATION_MINUTES: "45",
    COMMUNITY_EVENT_DURATION_MINUTES: "12"
  }, config => {
    assert.equal(config.FARM_CHANNEL, "farm-channel-from-env");
    assert.equal(config.LEADERBOARD_CHANNEL, "leaderboard-channel-from-env");
    assert.equal(config.FARMER_VERIFIED_ROLE, "verified-role-from-env");
    assert.equal(config.ROLES.food.id, "food-role-from-env");
    assert.equal(config.ROLES.wood.id, "wood-role-from-env");
    assert.equal(config.ROLES.silver.id, "silver-role-from-env");
    assert.equal(config.ROLES.tool.id, "tool-role-from-env");
    assert.equal(config.ROLES.workingFarm.id, "working-farm-role-from-env");
    assert.equal(config.ROLES.fullFarm.id, "full-farm-role-from-env");
    assert.equal(config.ATOMIC_API, "https://atomic.example.test/assets");
    assert.equal(config.FARMER_PETS_API, "https://pets.example.test");
    assert.equal(config.CONTRACT_ACCOUNT, "contractacct");
    assert.equal(config.NKFE_PAYOUT_SOURCE_WALLET, "sourcewallet");
    assert.equal(config.NKFE_TOKEN_SYMBOL, "NKFE");
    assert.equal(config.HEALTH_PORT, "8080");
    assert.equal(config.ENABLE_EVENT_THREADS, false);
    assert.equal(config.ENABLE_VERIFIED_MEMBER_DMS, false);
    assert.equal(config.FARM_EVENT_DURATION_MINUTES, 45);
    assert.equal(config.FARM_EVENT_DURATION_MS, 45 * 60 * 1000);
    assert.equal(config.COMMUNITY_EVENT_DURATION_MINUTES, 12);
    assert.equal(config.COMMUNITY_EVENT_DURATION_MS, 12 * 60 * 1000);
  });
});

test("short channel and role environment names take precedence over ID aliases", () => {
  withConfigEnv({
    FARM_CHANNEL: "farm-channel-short",
    FARM_CHANNEL_ID: "farm-channel-id",
    LEADERBOARD_CHANNEL: "leaderboard-channel-short",
    LEADERBOARD_CHANNEL_ID: "leaderboard-channel-id",
    FARMER_VERIFIED_ROLE: "verified-role-short",
    FARMER_VERIFIED_ROLE_ID: "verified-role-id",
    PORT: "9090"
  }, config => {
    assert.equal(config.FARM_CHANNEL, "farm-channel-short");
    assert.equal(config.LEADERBOARD_CHANNEL, "leaderboard-channel-short");
    assert.equal(config.FARMER_VERIFIED_ROLE, "verified-role-short");
    assert.equal(config.ROLES.verified.id, "verified-role-short");
    assert.equal(config.HEALTH_PORT, "9090");
  });
});
