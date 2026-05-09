const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const FARM_CHANNEL = "1270948980615938109";
const LEADERBOARD_CHANNEL = "1499255526054170825";
const FARMER_VERIFIED_ROLE = "1499240994397356112";

const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";
const FARMER_PETS_API = "https://pets-api-main.herokuapp.com";
const CONTRACT_ACCOUNT = "farmerpetssc";

const FLAGS_EPHEMERAL = 64;
const FARM_EVENT_DURATION_MS = 5 * 60 * 1000;
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
  verified: { id: "1499240994397356112", name: "🌱 Farmer Pets Verified" },
  food: { id: "1499241227097477171", name: "🥫 Pet Food Producer" },
  wood: { id: "1499241359146487838", name: "🪵 Wood Gatherer" },
  silver: { id: "1499241567016189972", name: "🥈 Silver Miner" },
  tool: { id: "1499240639655579881", name: "🛠️ Farm Tool Holder" },
  workingFarm: { id: "1499242211928182905", name: "🚜 Working Farm" },
  fullFarm: { id: "1499242342937399508", name: "🏭 Full Farm Operator" }
};

module.exports = {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
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
