const { Client, GatewayIntentBits } = require("discord.js");

const defaultConfig = require("./config");
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
const farmEvents = require("./services/farmEvents");
const database = require("./db");

function createDefaultClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });
}

function getMissingRuntimeConfig(config = {}) {
  const requiredConfig = {
    DISCORD_TOKEN: config.TOKEN,
    CLIENT_ID: config.CLIENT_ID,
    GUILD_ID: config.GUILD_ID,
    DATABASE_URL: config.DATABASE_URL
  };

  return Object.entries(requiredConfig)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function assertRuntimeConfig(config) {
  const missingConfig = getMissingRuntimeConfig(config);

  if (missingConfig.length) {
    throw new Error(`Missing required Farmer Pets configuration: ${missingConfig.join(", ")}`);
  }
}

function createBotApp({
  client = createDefaultClient(),
  config = defaultConfig,
  commandDefinitions = commands,
  db = database,
  eventService = farmEvents,
  roleService = { analyzeAssets, getSuccessChance, syncRoles },
  playerStatsService = {
    buildLeaderboardMessage,
    buildStatsPayload,
    handleDailyCheckIn,
    postWeeklyLeaderboardAndReset
  },
  assetService = { getAssets },
  ui = { buildRescueButtonRow, embedBuilders },
  utils = { getEventAnnouncementTarget },
  runtimes = {
    createCommandHandlers,
    createFarmEventDiscordRuntime,
    createInteractionHandler,
    createRescueHandlers,
    registerClientReadyHandler
  }
} = {}) {
  let activeFarmEvent = null;

  async function announceNewFarmerRoles(member, wallet, addedRoleNames) {
    if (!addedRoleNames.length) return;

    const channel = await client.channels.fetch(config.LEADERBOARD_CHANNEL).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel.send(
      `🌾 **NEW FARMER PETS ROLE UNLOCKED!** 🌾\n\n` +
        `**${member.displayName}** just unlocked new Farmer Pets role(s):\n\n` +
        `${addedRoleNames.map(role => `✅ ${role}`).join("\n")}\n\n` +
        `Wallet: **${wallet}**\n\n` +
        `The farm keeps growing. 🚜`
    );
  }

  const farmEventDiscord = runtimes.createFarmEventDiscordRuntime({
    client,
    farmChannelId: config.FARM_CHANNEL,
    farmerVerifiedRoleId: config.FARMER_VERIFIED_ROLE,
    awardCommunityMilestoneReward: db.awardCommunityMilestoneReward,
    buildRescueButtonRow: ui.buildRescueButtonRow,
    createFarmEvent: eventService.createFarmEvent,
    embedBuilders: ui.embedBuilders,
    getActiveFarmEvent: () => activeFarmEvent,
    getEventAnnouncementTarget: utils.getEventAnnouncementTarget,
    getEventThreadIntro: eventService.getEventThreadIntro,
    getEventThreadName: eventService.getEventThreadName,
    getNextFarmEventDelay: eventService.getNextFarmEventDelay,
    getRemainingEventMs: eventService.getRemainingEventMs,
    markCommunityGoalAnnounced: eventService.markCommunityGoalAnnounced,
    markCommunityMilestoneAwarded: eventService.markCommunityMilestoneAwarded,
    setActiveFarmEvent: farmEvent => {
      activeFarmEvent = farmEvent;
    },
    shouldAnnounceCommunityGoal: eventService.shouldAnnounceCommunityGoal,
    shouldAwardCommunityMilestone: eventService.shouldAwardCommunityMilestone
  });

  const {
    announceCommunityGoalReached,
    scheduleEvent,
    startFarmEvent,
    updateFarmEventMessage
  } = farmEventDiscord;

  const { handleFarmHelp, handleRescue } = runtimes.createRescueHandlers({
    announceCommunityGoalReached,
    embedBuilders: ui.embedBuilders,
    ensurePlayer: db.ensurePlayer,
    flagsEphemeral: config.FLAGS_EPHEMERAL,
    getActiveFarmEvent: () => activeFarmEvent,
    getEventAnnouncementTarget: utils.getEventAnnouncementTarget,
    getFarmHelpBlockReason: eventService.getFarmHelpBlockReason,
    getRescueBlockReason: eventService.getRescueBlockReason,
    getRescueReward: eventService.getRescueReward,
    getSuccessChance: roleService.getSuccessChance,
    getWallet: db.getWallet,
    recordCommunitySuccess: eventService.recordCommunitySuccess,
    recordFarmHelp: eventService.recordFarmHelp,
    recordRescue: db.recordRescue,
    releaseRescueAttempt: eventService.releaseRescueAttempt,
    reserveRescueAttempt: eventService.reserveRescueAttempt,
    updateFarmEventMessage
  });

  function registerBotReadyHandler() {
    runtimes.registerClientReadyHandler({
      client,
      token: config.TOKEN,
      clientId: config.CLIENT_ID,
      guildId: config.GUILD_ID,
      commands: commandDefinitions,
      initDatabase: db.initDatabase,
      scheduleEvent,
      postWeeklyLeaderboardAndReset: playerStatsService.postWeeklyLeaderboardAndReset
    });
  }

  function registerInteractionHandler() {
    const commandHandlers = runtimes.createCommandHandlers({
      announceNewFarmerRoles,
      analyzeAssets: roleService.analyzeAssets,
      buildLeaderboardMessage: playerStatsService.buildLeaderboardMessage,
      buildStatsPayload: playerStatsService.buildStatsPayload,
      flagsEphemeral: config.FLAGS_EPHEMERAL,
      getAssets: assetService.getAssets,
      getPayoutRows: db.getPayoutRows,
      getWallet: db.getWallet,
      getActiveFarmEvent: () => activeFarmEvent,
      handleDailyCheckIn: playerStatsService.handleDailyCheckIn,
      handleRescue,
      resetPayouts: db.resetPayouts,
      startFarmEvent,
      syncRoles: roleService.syncRoles
    });

    client.on("interactionCreate", runtimes.createInteractionHandler({
      commandHandlers,
      handleFarmHelp,
      handleRescue
    }));
  }

  function startBot() {
    assertRuntimeConfig(config);

    registerBotReadyHandler();
    registerInteractionHandler();

    return client.login(config.TOKEN);
  }

  return {
    announceNewFarmerRoles,
    client,
    getActiveFarmEvent: () => activeFarmEvent,
    registerBotReadyHandler,
    registerInteractionHandler,
    startBot
  };
}

function startBot() {
  return createBotApp().startBot();
}

module.exports = { createBotApp, getMissingRuntimeConfig, startBot };
