const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const cron = require("node-cron");

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  FARM_CHANNEL,
  LEADERBOARD_CHANNEL,
  FARMER_VERIFIED_ROLE,
  FLAGS_EPHEMERAL
} = require("./src/config");
const { getEventAnnouncementTarget } = require("./src/utils/events");
const { buildRescueButtonRow } = require("./src/ui/buttons");
const embedBuilders = require("./src/ui/embeds");
const { getAssets } = require("./src/services/assets");
const { analyzeAssets, getSuccessChance, syncRoles } = require("./src/services/roles");
const {
  buildLeaderboardMessage,
  buildStatsPayload,
  handleDailyCheckIn,
  postWeeklyLeaderboardAndReset
} = require("./src/services/playerStats");
const { commands } = require("./src/commands/definitions");
const { createCommandHandlers } = require("./src/commands/handlers");
const { createInteractionHandler } = require("./src/interactions");
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
} = require("./src/services/farmEvents");
const {
  awardCommunityMilestoneReward,
  ensurePlayer,
  getPayoutRows,
  getWallet,
  initDatabase,
  recordRescue,
  resetPayouts
} = require("./src/db");

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

async function createEventThread(message, farmEvent) {
  try {
    if (!message?.startThread) return null;

    return await message.startThread({
      name: getEventThreadName(farmEvent),
      autoArchiveDuration: 60,
      reason: "Farmer Pets event thread"
    });
  } catch (error) {
    console.error("Failed to create Farmer Pets event thread:", error);
    return null;
  }
}

async function updateFarmEventMessage(farmEvent) {
  try {
    if (!farmEvent.message?.editable) return;

    await farmEvent.message.edit({
      content: `<@&${FARMER_VERIFIED_ROLE}>`,
      embeds: [embedBuilders.buildFarmEventEmbed(farmEvent)],
      components: [buildRescueButtonRow()]
    });
  } catch (error) {
    console.error("Failed to update Farmer Pets event message:", error);
  }
}

async function closeFarmEventMessage(farmEvent) {
  try {
    if (!farmEvent.message?.editable) return;

    await farmEvent.message.edit({
      embeds: [embedBuilders.buildFarmEventEmbed(farmEvent)],
      components: [buildRescueButtonRow(true)]
    });
  } catch (error) {
    console.error("Failed to close Farmer Pets event message:", error);
  }
}

async function announceCommunityGoalReached(farmEvent) {
  if (!shouldAnnounceCommunityGoal(farmEvent)) return;

  markCommunityGoalAnnounced(farmEvent);

  const target = getEventAnnouncementTarget(farmEvent);
  if (!target?.isTextBased()) return;

  await target.send({ embeds: [embedBuilders.buildCommunityGoalReachedEmbed(farmEvent)] });
}

async function endFarmEvent(farmEvent) {
  if (activeFarmEvent === farmEvent) {
    activeFarmEvent = null;
  }

  await closeFarmEventMessage(farmEvent);

  if (!farmEvent.isCommunity) return;

  let rewardedCount = 0;

  if (shouldAwardCommunityMilestone(farmEvent)) {
    markCommunityMilestoneAwarded(farmEvent);
    rewardedCount = await awardCommunityMilestoneReward(
      [...farmEvent.players],
      farmEvent.communityBonus
    );
  }

  const target = getEventAnnouncementTarget(farmEvent);
  if (target?.isTextBased()) {
    await target.send({ embeds: [embedBuilders.buildCommunityEventEndEmbed(farmEvent, rewardedCount)] });
  }
}

async function startFarmEvent() {
  if (activeFarmEvent) return false;

  const farmEvent = createFarmEvent();

  activeFarmEvent = farmEvent;

  try {
    const channel = await client.channels.fetch(FARM_CHANNEL);

    if (!channel?.isTextBased()) {
      throw new Error(`Farm channel ${FARM_CHANNEL} is not a text channel.`);
    }

    const pingRole = `<@&${FARMER_VERIFIED_ROLE}>`;

    farmEvent.channel = channel;
    farmEvent.message = await channel.send({
      content: pingRole,
      embeds: [embedBuilders.buildFarmEventEmbed(farmEvent)],
      components: [buildRescueButtonRow()]
    });
    farmEvent.thread = await createEventThread(farmEvent.message, farmEvent);

    if (farmEvent.thread?.isTextBased()) {
      try {
        await farmEvent.thread.send(getEventThreadIntro(farmEvent));
      } catch (error) {
        console.error("Failed to send Farmer Pets event thread intro:", error);
      }
    }

    farmEvent.timeout = setTimeout(() => {
      endFarmEvent(farmEvent)
        .catch(error => console.error("Failed to end Farmer Pets event:", error))
        .finally(() => scheduleEvent());
    }, getRemainingEventMs(farmEvent));

    return true;
  } catch (error) {
    if (activeFarmEvent === farmEvent) {
      activeFarmEvent = null;
    }

    throw error;
  }
}

function scheduleEvent() {
  const delay = getNextFarmEventDelay();

  console.log(`Next Farmer Pets event in ${Math.round(delay / 60000)} minutes.`);

  setTimeout(() => {
    startFarmEvent().catch(error => {
      console.error("Failed to start scheduled Farmer Pets event:", error);
      scheduleEvent();
    });
  }, delay);
}

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

function registerClientReadyHandler() {
  client.once("clientReady", async () => {
    console.log(`Farmer Pets Bot online as ${client.user.tag}`);

    try {
      await initDatabase();

      const rest = new REST({ version: "10" }).setToken(TOKEN);

      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );

      console.log("Farmer Pets slash commands registered.");

      scheduleEvent();

      cron.schedule(
        "0 17 * * 0",
        async () => {
          try {
            await postWeeklyLeaderboardAndReset(client);
          } catch (error) {
            console.error("Failed to post weekly Farmer Pets leaderboard:", error);
          }
        },
        { timezone: "America/Los_Angeles" }
      );

      console.log("Weekly Farmer Pets leaderboard scheduled for Sundays at 5:00 PM Pacific.");
    } catch (error) {
      console.error("Failed during Farmer Pets startup:", error);

      if (error?.code === "28000") {
        console.error(
          "PostgreSQL authentication failed. Check DATABASE_URL on Render and ensure the database role is allowed to log in."
        );
      }

      process.exit(1);
    }
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
  registerClientReadyHandler();
  registerInteractionHandler();

  return client.login(TOKEN);
}

startBot();
