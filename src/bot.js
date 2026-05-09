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

async function handleRescue(interaction) {
  const farmEvent = activeFarmEvent;

  const rescueBlockReason = getRescueBlockReason(farmEvent, interaction.user.id);

  if (rescueBlockReason) {
    await interaction.reply({
      content: rescueBlockReason,
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  reserveRescueAttempt(farmEvent, interaction.user.id);

  let attemptRecorded = false;

  try {
    const wallet = await getWallet(interaction.user.id);

    if (!wallet) {
      releaseRescueAttempt(farmEvent, interaction.user.id);

      await interaction.reply({
        content: "You must verify your wallet first using `/verify`.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    await ensurePlayer(interaction.user.id, wallet);

    const successChance = getSuccessChance(member);
    const success = Math.random() < successChance;
    const reward = getRescueReward(farmEvent, success);

    const streak = await recordRescue(
      interaction.user.id,
      wallet,
      farmEvent.name,
      success,
      reward
    );

    if (success && recordCommunitySuccess(farmEvent)) {
      await updateFarmEventMessage(farmEvent);
      await announceCommunityGoalReached(farmEvent);
    }

    attemptRecorded = true;

    const resultEmbed = embedBuilders.buildRescueResultEmbed({
      member,
      farmEvent,
      success,
      reward,
      successChance,
      streak
    });

    await interaction.reply({
      embeds: [resultEmbed],
      flags: FLAGS_EPHEMERAL
    });

    try {
      const target = getEventAnnouncementTarget(farmEvent);

      if (target?.isTextBased()) {
        await target.send({ embeds: [resultEmbed] });
      }
    } catch (error) {
      console.error("Failed to announce Farmer Pets rescue result:", error);
    }
  } catch (error) {
    if (!attemptRecorded) {
      releaseRescueAttempt(farmEvent, interaction.user.id);
    }

    throw error;
  }
}


async function handleFarmHelp(interaction) {
  const farmEvent = activeFarmEvent;

  const helpBlockReason = getFarmHelpBlockReason(farmEvent, interaction.user.id);

  if (helpBlockReason) {
    await interaction.reply({
      content: helpBlockReason,
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  const farmHelpWallet = await getWallet(interaction.user.id);

  if (!farmHelpWallet) {
    await interaction.reply({
      content: "You must verify your wallet first using `/verify`.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (!farmEvent.players.has(interaction.user.id)) {
    await interaction.reply({
      content: "Try **Rescue Pet** first, then you can help the farm after your attempt.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  const farmHelpMember = await interaction.guild.members.fetch(interaction.user.id);
  await ensurePlayer(interaction.user.id, farmHelpWallet);

  const progressAdded = recordFarmHelp(farmEvent, interaction.user.id);

  if (farmEvent.isCommunity) {
    await updateFarmEventMessage(farmEvent);
    await announceCommunityGoalReached(farmEvent);
  }

  const helpEmbed = embedBuilders.buildFarmHelpEmbed({
    member: farmHelpMember,
    farmEvent,
    progressAdded
  });

  await interaction.reply({
    embeds: [helpEmbed],
    flags: FLAGS_EPHEMERAL
  });

  try {
    const target = getEventAnnouncementTarget(farmEvent);

    if (target?.isTextBased()) {
      await target.send({ embeds: [helpEmbed] });
    }
  } catch (error) {
    console.error("Failed to announce Farmer Pets farmhand help:", error);
  }
}

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
