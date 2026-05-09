const { Client, GatewayIntentBits } = require("discord.js");

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  FARM_CHANNEL,
  LEADERBOARD_CHANNEL,
  FARMER_VERIFIED_ROLE,
  FLAGS_EPHEMERAL
} = require("./config");
const { getEventAnnouncementTarget } = require("./utils/events");
const { buildRescueButtonRow } = require("./ui/buttons");
const embedBuilders = require("./ui/embeds");
const { getAssets } = require("./services/assets");
const { analyzeAssets, getSuccessChance, syncRoles } = require("./services/roles");
const {
  buildLeaderboardMessage,
  buildStatsPayload,
  handleDailyCheckIn,
  postWeeklyLeaderboardAndReset
} = require("./services/playerStats");
const { commands } = require("./commands/definitions");
const { createCommandHandlers } = require("./commands/handlers");
const { createInteractionHandler } = require("./interactions");
const { createFarmEventDiscordRuntime } = require("./runtime/farmEventDiscord");
const { registerClientReadyHandler } = require("./runtime/startup");
const { createRescueHandlers } = require("./runtime/rescueHandlers");
const {
  createFarmEvent,
  getEventThreadIntro,
  getEventThreadName,
  getFarmHelpBlockReason,
  getNextFarmEventDelay,
  getRemainingEventMs,
  getRescueBlockReason,
  getRescueReward,
  markCommunityGoalAnnounced,
  markCommunityMilestoneAwarded,
  recordCommunitySuccess,
  recordFarmHelp,
  releaseRescueAttempt,
  reserveRescueAttempt,
  shouldAnnounceCommunityGoal,
  shouldAwardCommunityMilestone
} = require("./services/farmEvents");
const {
  awardCommunityMilestoneReward,
  ensurePlayer,
  getPayoutRows,
  getWallet,
  initDatabase,
  recordRescue,
  resetPayouts
} = require("./db");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let activeFarmEvent = null;

// ROLE LOGIC

async function announceNewFarmerRoles(member, wallet, addedRoleNames) {
  if (!addedRoleNames.length) return;

  const channel = await client.channels.fetch(LEADERBOARD_CHANNEL).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send(
    `🌾 **NEW FARMER PETS ROLE UNLOCKED!** 🌾\n\n` +
      `**${member.displayName}** just unlocked new Farmer Pets role(s):\n\n` +
      `${addedRoleNames.map(role => `✅ ${role}`).join("\n")}\n\n` +
      `Wallet: **${wallet}**\n\n` +
      `The farm keeps growing. 🚜`
  );
}

// FARM EVENTS

const farmEventDiscord = createFarmEventDiscordRuntime({
  client,
  farmChannelId: FARM_CHANNEL,
  farmerVerifiedRoleId: FARMER_VERIFIED_ROLE,
  awardCommunityMilestoneReward,
  buildRescueButtonRow,
  createFarmEvent,
  embedBuilders,
  getActiveFarmEvent: () => activeFarmEvent,
  getEventAnnouncementTarget,
  getEventThreadIntro,
  getEventThreadName,
  getNextFarmEventDelay,
  getRemainingEventMs,
  markCommunityGoalAnnounced,
  markCommunityMilestoneAwarded,
  setActiveFarmEvent: farmEvent => {
    activeFarmEvent = farmEvent;
  },
  shouldAnnounceCommunityGoal,
  shouldAwardCommunityMilestone
});

const {
  announceCommunityGoalReached,
  scheduleEvent,
  startFarmEvent,
  updateFarmEventMessage
} = farmEventDiscord;

const { handleFarmHelp, handleRescue } = createRescueHandlers({
  announceCommunityGoalReached,
  embedBuilders,
  ensurePlayer,
  flagsEphemeral: FLAGS_EPHEMERAL,
  getActiveFarmEvent: () => activeFarmEvent,
  getEventAnnouncementTarget,
  getFarmHelpBlockReason,
  getRescueBlockReason,
  getRescueReward,
  getSuccessChance,
  getWallet,
  recordCommunitySuccess,
  recordFarmHelp,
  recordRescue,
  releaseRescueAttempt,
  reserveRescueAttempt,
  updateFarmEventMessage
});

function registerBotReadyHandler() {
  registerClientReadyHandler({
    client,
    token: TOKEN,
    clientId: CLIENT_ID,
    guildId: GUILD_ID,
    commands,
    initDatabase,
    scheduleEvent,
    postWeeklyLeaderboardAndReset
  });
}

function registerInteractionHandler() {
  const commandHandlers = createCommandHandlers({
    announceNewFarmerRoles,
    analyzeAssets,
    buildLeaderboardMessage,
    buildStatsPayload,
    flagsEphemeral: FLAGS_EPHEMERAL,
    getAssets,
    getPayoutRows,
    getWallet,
    getActiveFarmEvent: () => activeFarmEvent,
    handleDailyCheckIn,
    handleRescue,
    resetPayouts,
    startFarmEvent,
    syncRoles
  });

  client.on("interactionCreate", createInteractionHandler({
    commandHandlers,
    handleFarmHelp,
    handleRescue
  }));
}

function startBot() {
  registerBotReadyHandler();
  registerInteractionHandler();

  return client.login(TOKEN);
}

module.exports = { startBot };
