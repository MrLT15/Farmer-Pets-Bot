const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const cron = require("node-cron");

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  FARM_CHANNEL,
  LEADERBOARD_CHANNEL,
  FARMER_VERIFIED_ROLE,
  FLAGS_EPHEMERAL,
  FARM_EVENT_DURATION_MS,
  RESCUE_BUTTON_CUSTOM_ID,
  HELP_FARM_BUTTON_CUSTOM_ID,
  COMMUNITY_EVENT_CHANCE,
  COMMUNITY_GOAL_MIN,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_BONUS_MIN,
  COMMUNITY_BONUS_MAX,
  COMMUNITY_HELPS_PER_PROGRESS
} = require("./src/config");
const { randomInt } = require("./src/utils/random");
const { getPacificDateKey, getYesterdayPacificDateKey } = require("./src/utils/dates");
const { calculateDailyReward } = require("./src/utils/rewards");
const { getEventAnnouncementTarget } = require("./src/utils/events");
const { buildRescueButtonRow } = require("./src/ui/buttons");
const embedBuilders = require("./src/ui/embeds");
const { getAssets } = require("./src/services/assets");
const { analyzeAssets, getSuccessChance, syncRoles } = require("./src/services/roles");
const {
  awardCommunityMilestoneReward,
  ensurePlayer,
  getDailyCheckInState,
  getPayoutRows,
  getStatsRow,
  getWallet,
  initDatabase,
  recordDailyCheckIn,
  recordRescue,
  resetPayouts,
  resetWeeklyStats,
  getWeeklyLeaderboardRows
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
      name: farmEvent.isCommunity
        ? `🤝 ${farmEvent.name}`
        : `🌾 ${farmEvent.name}`,
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
  if (!farmEvent.isCommunity || farmEvent.goalAnnounced) return;
  if (farmEvent.communitySuccesses < farmEvent.communityGoal) return;

  farmEvent.goalAnnounced = true;

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

  if (farmEvent.communitySuccesses >= farmEvent.communityGoal && !farmEvent.milestoneAwarded) {
    farmEvent.milestoneAwarded = true;
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

  const roll = randomInt(1, 100);

  let name = "🐛 Pest Swarm";
  let min = 1;
  let max = 5;

  if (roll <= 5) {
    name = "🌾 Legendary Harvest Crisis";
    min = 10;
    max = 25;
  } else if (roll <= 25) {
    name = "⚠️ Rare Infestation";
    min = 5;
    max = 10;
  }

  const isCommunity = randomInt(1, 100) <= COMMUNITY_EVENT_CHANCE;

  if (isCommunity) {
    name = `🤝 Co-op ${name.replace(/^\S+\s*/, "")}`;
    min += 1;
    max += 2;
  }

  const farmEvent = {
    name,
    rewardMin: min,
    rewardMax: max,
    expires: Date.now() + FARM_EVENT_DURATION_MS,
    players: new Set(),
    helpers: new Set(),
    timeout: null,
    channel: null,
    message: null,
    thread: null,
    isCommunity,
    communityGoal: isCommunity ? randomInt(COMMUNITY_GOAL_MIN, COMMUNITY_GOAL_MAX) : 0,
    communitySuccesses: 0,
    communityHelps: 0,
    communityBonus: isCommunity ? randomInt(COMMUNITY_BONUS_MIN, COMMUNITY_BONUS_MAX) : 0,
    goalAnnounced: false,
    milestoneAwarded: false
  };

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
        await farmEvent.thread.send(
          farmEvent.isCommunity
            ? "🤝 Use this thread to coordinate the co-op rescue and cheer farmers on!"
            : "🌾 Rescue discussion thread is open for this farm event."
        );
      } catch (error) {
        console.error("Failed to send Farmer Pets event thread intro:", error);
      }
    }

    farmEvent.timeout = setTimeout(() => {
      endFarmEvent(farmEvent)
        .catch(error => console.error("Failed to end Farmer Pets event:", error))
        .finally(() => scheduleEvent());
    }, FARM_EVENT_DURATION_MS);

    return true;
  } catch (error) {
    if (activeFarmEvent === farmEvent) {
      activeFarmEvent = null;
    }

    throw error;
  }
}

function scheduleEvent() {
  const delay = randomInt(
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000
  );

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

  if (!farmEvent) {
    await interaction.reply({
      content: "No active farm emergency.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (Date.now() > farmEvent.expires) {
    await interaction.reply({
      content: "This farm emergency has already ended.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (farmEvent.players.has(interaction.user.id)) {
    await interaction.reply({
      content: "You already attempted this rescue.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  farmEvent.players.add(interaction.user.id);

  let attemptRecorded = false;

  try {
    const wallet = await getWallet(interaction.user.id);

    if (!wallet) {
      farmEvent.players.delete(interaction.user.id);

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
    const reward = success
      ? randomInt(farmEvent.rewardMin, farmEvent.rewardMax)
      : 0;

    const streak = await recordRescue(
      interaction.user.id,
      wallet,
      farmEvent.name,
      success,
      reward
    );

    if (farmEvent.isCommunity && success) {
      farmEvent.communitySuccesses++;
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
      farmEvent.players.delete(interaction.user.id);
    }

    throw error;
  }
}


async function handleFarmHelp(interaction) {
  const farmEvent = activeFarmEvent;

  if (!farmEvent) {
    await interaction.reply({
      content: "No active farm emergency.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (Date.now() > farmEvent.expires) {
    await interaction.reply({
      content: "This farm emergency has already ended.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (farmEvent.helpers.has(interaction.user.id)) {
    await interaction.reply({
      content: "You already helped the farm during this event.",
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

  farmEvent.helpers.add(interaction.user.id);

  let progressAdded = false;

  if (farmEvent.isCommunity) {
    farmEvent.communityHelps++;

    if (
      farmEvent.communityHelps % COMMUNITY_HELPS_PER_PROGRESS === 0 &&
      farmEvent.communitySuccesses < farmEvent.communityGoal
    ) {
      farmEvent.communitySuccesses++;
      progressAdded = true;
    }

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

// STATS / LEADERBOARD

async function handleDailyCheckIn(interaction) {
  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
    await interaction.reply({
      content: "No verified wallet found. Please verify your wallet first using `/verify`.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const todayKey = getPacificDateKey();
  const yesterdayKey = getYesterdayPacificDateKey();

  await ensurePlayer(interaction.user.id, wallet);

  const fpDailyCheckInState = await getDailyCheckInState(interaction.user.id);
  const fpDailyLastCheckInKey = fpDailyCheckInState.last_daily_checkin_key;

  if (fpDailyLastCheckInKey === todayKey) {
    await interaction.reply({
      embeds: [embedBuilders.buildAlreadyCheckedInEmbed({
        displayName: member.displayName,
        lastDailyCheckIn: fpDailyLastCheckInKey,
        streak: Number(fpDailyCheckInState.daily_streak || 0)
      })],
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  const streak = fpDailyLastCheckInKey === yesterdayKey
    ? Number(fpDailyCheckInState.daily_streak || 0) + 1
    : 1;
  const reward = calculateDailyReward(streak);

  const updated = await recordDailyCheckIn(interaction.user.id, reward.total, streak, todayKey);

  await interaction.reply({
    embeds: [embedBuilders.buildDailyCheckInEmbed({
      displayName: member.displayName,
      wallet,
      streak: Number(updated.daily_streak || 0),
      bestStreak: Number(updated.best_daily_streak || 0),
      reward,
      todayKey
    })],
    flags: FLAGS_EPHEMERAL
  });
}

async function buildStatsPayload(discordId, displayName) {
  const wallet = await getWallet(discordId);

  if (!wallet) {
    return {
      content: "No verified wallet found. Please verify your wallet first using `/verify`."
    };
  }

  await ensurePlayer(discordId, wallet);

  const row = await getStatsRow(discordId);

  return { embeds: [embedBuilders.buildStatsEmbed({ displayName, row, wallet })] };
}

async function buildLeaderboardMessage() {
  const rows = await getWeeklyLeaderboardRows();

  if (!rows.length) {
    return "🏆 **Farmer Pets Weekly Leaderboard**\n\nNo Farmer Pets rescue activity this week.";
  }

  const lines = rows.map((row, index) => {
    return (
      `${index + 1}. <@${row.discord_id}> — ` +
      `**${row.weekly_nkfe} $NKFE** | ` +
      `${row.weekly_successes}/${row.weekly_attempts} successful | ` +
      `Lifetime: ${row.lifetime_nkfe} $NKFE | Wallet: **${row.wallet}**`
    );
  });

  return "🏆 **Farmer Pets Weekly Leaderboard**\n\n" + lines.join("\n");
}

async function postWeeklyLeaderboardAndReset() {
  const channel = await client.channels.fetch(LEADERBOARD_CHANNEL);
  const leaderboard = await buildLeaderboardMessage();

  const payoutRows = await getPayoutRows();

  const totalPayout = payoutRows.reduce(
    (sum, row) => sum + Number(row.payout_nkfe || 0),
    0
  );

  await channel.send(
    `${leaderboard}\n\n` +
    `💰 **Total Farmer Pets NKFE Owed:** ${totalPayout} $NKFE\n\n` +
    `Use **/fp-payouts** for the manual payout list.`
  );

  await resetWeeklyStats();
}

// COMMANDS

const commands = [
  new SlashCommandBuilder()
    .setName("fp-roles")
    .setDescription("Sync Farmer Pets roles"),

  new SlashCommandBuilder()
    .setName("fp-rescue")
    .setDescription("Join the current farm rescue event"),

  new SlashCommandBuilder()
    .setName("fp-stats")
    .setDescription("Show your Farmer Pets rescue stats"),

  new SlashCommandBuilder()
    .setName("fp-daily")
    .setDescription("Claim your daily Farmer Pets check-in reward"),

  new SlashCommandBuilder()
    .setName("fp-leaderboard")
    .setDescription("Show the Farmer Pets weekly leaderboard"),

  new SlashCommandBuilder()
    .setName("fp-payouts")
    .setDescription("Admin: show Farmer Pets NKFE payouts owed")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-resetpayouts")
    .setDescription("Admin: reset Farmer Pets payout balances after manual payment")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-testevent")
    .setDescription("Admin: manually start a Farmer Pets event")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

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
          await postWeeklyLeaderboardAndReset();
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

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === RESCUE_BUTTON_CUSTOM_ID) {
        await handleRescue(interaction);
        return;
      }

      if (interaction.customId === HELP_FARM_BUTTON_CUSTOM_ID) {
        await handleFarmHelp(interaction);
        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "fp-rescue") {
      await handleRescue(interaction);
      return;
    }

    if (interaction.commandName === "fp-roles") {
      await interaction.deferReply({ flags: FLAGS_EPHEMERAL });

      const wallet = await getWallet(interaction.user.id);

      if (!wallet) {
        await interaction.editReply("Verify your wallet first using `/verify`.");
        return;
      }

      let assetData;

      try {
        assetData = await getAssets(wallet);
      } catch (error) {
        console.error("Failed to fetch Farmer Pets assets:", error);
        await interaction.editReply(
          "Farmer Pets asset services are unavailable right now. No roles were changed; please try again later."
        );
        return;
      }

      const analysis = analyzeAssets(assetData.combinedAssets);
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const roleResult = await syncRoles(member, analysis);

      if (roleResult.added.length) {
        await announceNewFarmerRoles(member, wallet, roleResult.added);
      }

      await interaction.editReply(
        `🌾 **Farmer Pets Role Scan Complete**\n\n` +
        `Wallet: **${wallet}**\n\n` +
        `Wallet NFTs Found: **${assetData.walletAssets.length}**\n` +
        `Staked/In-Game Assets Found: **${assetData.stakedAssets.length}**\n` +
        `Total Assets Evaluated: **${analysis.total}**\n\n` +
        `🥫 Food Assets: **${analysis.food}**\n` +
        `🪵 Wood Assets: **${analysis.wood}**\n` +
        `🥈 Silver Assets: **${analysis.silver}**\n` +
        `🛠️ Tool Assets: **${analysis.tool}**\n\n` +
        `**Roles Added:**\n${roleResult.added.length ? roleResult.added.join("\n") : "None"}\n\n` +
        `**Roles Removed:**\n${roleResult.removed.length ? roleResult.removed.join("\n") : "None"}`
      );
      return;
    }

    if (interaction.commandName === "fp-stats") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const payload = await buildStatsPayload(interaction.user.id, member.displayName);

      await interaction.reply({
        ...payload,
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-daily") {
      await handleDailyCheckIn(interaction);
      return;
    }

    if (interaction.commandName === "fp-leaderboard") {
      const message = await buildLeaderboardMessage();

      await interaction.reply({
        content: message
      });
      return;
    }

    if (interaction.commandName === "fp-payouts") {
      const payoutRows = await getPayoutRows();

      if (!payoutRows.length) {
        await interaction.reply({
          content: "No Farmer Pets NKFE payouts owed right now.",
          flags: FLAGS_EPHEMERAL
        });
        return;
      }

      const lines = payoutRows.map(row =>
        `${row.wallet} — **${row.payout_nkfe} $NKFE** — <@${row.discord_id}>`
      );

      await interaction.reply({
        content:
          "💰 **Farmer Pets Manual Payout List**\n\n" +
          lines.join("\n") +
          "\n\nAfter manual payment, run `/fp-resetpayouts`.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-resetpayouts") {
      await resetPayouts();

      await interaction.reply({
        content: "Farmer Pets payout balances reset to 0. Lifetime stats were preserved.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-testevent") {
      await interaction.deferReply({ flags: FLAGS_EPHEMERAL });

      if (activeFarmEvent) {
        await interaction.editReply("A Farmer Pets event is already active.");
        return;
      }

      const started = await startFarmEvent();

      await interaction.editReply(
        started
          ? "Test Farmer Pets event started."
          : "A Farmer Pets event is already active."
      );
      return;
    }
  } catch (error) {
    console.error(error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Something went wrong.");
      } else {
        await interaction.reply({
          content: "Something went wrong.",
          flags: FLAGS_EPHEMERAL
        });
      }
    } catch {
      console.log("Could not send error reply to interaction.");
    }
  }
});

client.login(TOKEN);
