function env(name, fallback) {
  return process.env[name] || fallback;
}

function envFlag(name, fallback = true) {
  const value = process.env[name];

  if (value === undefined || value === "") return fallback;

  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const HEALTH_PORT = process.env.HEALTH_PORT || process.env.PORT;
const ENABLE_EVENT_THREADS = envFlag("ENABLE_EVENT_THREADS", true);

const FARM_CHANNEL = env("FARM_CHANNEL", env("FARM_CHANNEL_ID", "1270948980615938109"));
const LEADERBOARD_CHANNEL = env(
  "LEADERBOARD_CHANNEL",
  env("LEADERBOARD_CHANNEL_ID", "1499255526054170825")
);

const ROLE_IDS = {
  verified: env("FARMER_VERIFIED_ROLE", env("FARMER_VERIFIED_ROLE_ID", "1499240994397356112")),
  food: env("FARMER_FOOD_ROLE", env("FARMER_FOOD_ROLE_ID", "1499241227097477171")),
  wood: env("FARMER_WOOD_ROLE", env("FARMER_WOOD_ROLE_ID", "1499241359146487838")),
  silver: env("FARMER_SILVER_ROLE", env("FARMER_SILVER_ROLE_ID", "1499241567016189972")),
  tool: env("FARMER_TOOL_ROLE", env("FARMER_TOOL_ROLE_ID", "1499240639655579881")),
  workingFarm: env(
    "FARMER_WORKING_FARM_ROLE",
    env("FARMER_WORKING_FARM_ROLE_ID", "1499242211928182905")
  ),
  fullFarm: env("FARMER_FULL_FARM_ROLE", env("FARMER_FULL_FARM_ROLE_ID", "1499242342937399508"))
};

const FARMER_VERIFIED_ROLE = ROLE_IDS.verified;

const ATOMIC_API = env("ATOMIC_API", "https://wax.api.atomicassets.io/atomicassets/v1/assets");
const FARMER_PETS_API = env("FARMER_PETS_API", "https://pets-api-main.herokuapp.com");
const CONTRACT_ACCOUNT = env("CONTRACT_ACCOUNT", "farmerpetssc");

const FLAGS_EPHEMERAL = 64;
const FARM_EVENT_DURATION_MS = 30 * 60 * 1000;
const FARM_EVENT_DURATION_MS = 30 * 60 * 1000;
const ATOMIC_ASSET_PAGE_LIMIT = 1000;
const RESCUE_BUTTON_CUSTOM_ID = "fp-rescue-button";
const HELP_FARM_BUTTON_CUSTOM_ID = "fp-help-farm-button";
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const COMMUNITY_EVENT_CHANCE = 25;
const COMMUNITY_GOAL_MIN = 3;
const COMMUNITY_GOAL_MAX = 8;
const COMMUNITY_BONUS_MIN = 2;
const COMMUNITY_BONUS_MAX = 6;
const COMMUNITY_HELPS_PER_PROGRESS = 3;
const EMBED_COLORS = {
  success: 0x2ecc71,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
  info: 0x3498db,
  farm: 0x8bc34a
};

const ROLES = {
  verified: { id: ROLE_IDS.verified, name: "🌱 Farmer Pets Verified" },
  food: { id: ROLE_IDS.food, name: "🥫 Pet Food Producer" },
  wood: { id: ROLE_IDS.wood, name: "🪵 Wood Gatherer" },
  silver: { id: ROLE_IDS.silver, name: "🥈 Silver Miner" },
  tool: { id: ROLE_IDS.tool, name: "🛠️ Farm Tool Holder" },
  workingFarm: { id: ROLE_IDS.workingFarm, name: "🚜 Working Farm" },
  fullFarm: { id: ROLE_IDS.fullFarm, name: "🏭 Full Farm Operator" }
};

module.exports = {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  HEALTH_PORT,
  ENABLE_EVENT_THREADS,
  FARM_CHANNEL,
  LEADERBOARD_CHANNEL,
  FARMER_VERIFIED_ROLE,
  ATOMIC_API,
  FARMER_PETS_API,
  CONTRACT_ACCOUNT,
  FLAGS_EPHEMERAL,
  FARM_EVENT_DURATION_MS,
  ATOMIC_ASSET_PAGE_LIMIT,
  RESCUE_BUTTON_CUSTOM_ID,
  HELP_FARM_BUTTON_CUSTOM_ID,
  PACIFIC_TIME_ZONE,
  COMMUNITY_EVENT_CHANCE,
  COMMUNITY_GOAL_MIN,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_BONUS_MIN,
  COMMUNITY_BONUS_MAX,
  COMMUNITY_HELPS_PER_PROGRESS,
  EMBED_COLORS,
  ROLES
};
