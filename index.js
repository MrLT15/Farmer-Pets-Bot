const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

const cron = require("node-cron");

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
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
  COMMUNITY_EVENT_CHANCE,
  COMMUNITY_GOAL_MIN,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_BONUS_MIN,
  COMMUNITY_BONUS_MAX,
  COMMUNITY_HELPS_PER_PROGRESS,
  ROLES
} = require("./src/config");
const { randomInt } = require("./src/utils/random");
const { getPacificDateKey, getYesterdayPacificDateKey } = require("./src/utils/dates");
const { calculateDailyReward } = require("./src/utils/rewards");
const { getEventAnnouncementTarget } = require("./src/utils/events");
const { buildRescueButtonRow } = require("./src/ui/buttons");
const {
  buildAlreadyCheckedInEmbed,
  buildCommunityEventEndEmbed,
  buildCommunityGoalReachedEmbed,
  buildDailyCheckInEmbed,
  buildFarmEventEmbed,
  buildFarmHelpEmbed,
  buildRescueResultEmbed,
  buildStatsEmbed
} = require("./src/ui/embeds");
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

// ASSETS

async function getJsonSafe(url) {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status}: ${url}`);
    }

    const json = await res.json();

    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.rows)) return json.rows;

    return [];
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

async function getWalletAssets(wallet) {
  const assets = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      owner: wallet,
      collection_name: "farmerpetsgo",
      limit: String(ATOMIC_ASSET_PAGE_LIMIT),
      page: String(page)
    });

    const pageAssets = await getJsonSafe(`${ATOMIC_API}?${params.toString()}`);
    assets.push(...pageAssets);

    if (pageAssets.length < ATOMIC_ASSET_PAGE_LIMIT) break;

    page++;
  }

  return assets;
}

function makePseudoAssetFromRow(row, source) {
  const templateId =
    row.template_id ||
    row.templateId ||
    row.template ||
    row.templateid ||
    "";

  const name =
    row.name ||
    row.asset_name ||
    row.template_name ||
    row.schema_name ||
    row.type ||
    source;

  return {
    asset_id: row.asset_id || row.assetId || `${source}-${templateId}-${Math.random()}`,
    name,
    data: row,
    template: {
      template_id: String(templateId),
      immutable_data: { name }
    },
    schema: {
      schema_name: row.schema_name || row.schema || source
    },
    source
  };
}

function buildRowsUrl(table, params) {
  const query = new URLSearchParams(params).toString();

  return `${FARMER_PETS_API}/api/rows/${table}?${query}`;
}

async function getStakedAssets(wallet) {
  const urls = [
    {
      source: "tools",
      url: buildRowsUrl("tools", { scope: CONTRACT_ACCOUNT, user: wallet })
    },
    {
      source: "lands",
      url: buildRowsUrl("lands", { scope: CONTRACT_ACCOUNT, user: wallet })
    },
    {
      source: "pets",
      url: buildRowsUrl("pets", { user: wallet })
    },
    {
      source: "items",
      url: buildRowsUrl("items", { user: wallet })
    },
    {
      source: "solarpanels",
      url: buildRowsUrl("solarpanels", { user: wallet })
    }
  ];

  const stakedAssets = [];

  for (const item of urls) {
    const rows = await getJsonSafe(item.url);

    for (const row of rows) {
      stakedAssets.push(makePseudoAssetFromRow(row, item.source));
    }
  }

  return stakedAssets;
}

async function getAssets(wallet) {
  const walletAssets = await getWalletAssets(wallet);
  const stakedAssets = await getStakedAssets(wallet);

  return {
    walletAssets,
    stakedAssets,
    combinedAssets: [...walletAssets, ...stakedAssets]
  };
}

// ROLE LOGIC

function analyzeAssets(assets) {
  let food = 0;
  let wood = 0;
  let silver = 0;
  let tool = 0;

  for (const asset of assets) {
    const searchable =
      `${asset.name || ""} ` +
      `${asset.data?.name || ""} ` +
      `${asset.data?.asset_name || ""} ` +
      `${asset.data?.template_name || ""} ` +
      `${asset.data?.type || ""} ` +
      `${asset.template?.immutable_data?.name || ""} ` +
      `${asset.schema?.schema_name || ""} ` +
      `${asset.source || ""}`;

    const lower = searchable.toLowerCase();

    if (lower.includes("food") || lower.includes("feed")) food++;
    if (lower.includes("wood") || lower.includes("lumber")) wood++;
    if (lower.includes("silver")) silver++;

    if (
      lower.includes("tool") ||
      lower.includes("axe") ||
      lower.includes("pickaxe") ||
      lower.includes("shovel") ||
      lower.includes("hammer") ||
      lower.includes("saw")
    ) {
      tool++;
    }
  }

  const production = food + wood + silver;

  return {
    total: assets.length,
    food,
    wood,
    silver,
    tool,
    verified: assets.length > 0,
    workingFarm: production >= 2,
    fullFarm: food > 0 && wood > 0 && silver > 0
  };
}

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

async function syncRoles(member, analysis, wallet, announce = true) {
  const checks = [
    ["verified", analysis.verified],
    ["food", analysis.food > 0],
    ["wood", analysis.wood > 0],
    ["silver", analysis.silver > 0],
    ["tool", analysis.tool > 0],
    ["workingFarm", analysis.workingFarm],
    ["fullFarm", analysis.fullFarm]
  ];

  const added = [];
  const removed = [];

  for (const [key, shouldHave] of checks) {
    const role = ROLES[key];
    const hasRole = member.roles.cache.has(role.id);

    if (shouldHave && !hasRole) {
      await member.roles.add(role.id);
      added.push(role.name);
    }

    if (!shouldHave && hasRole) {
      await member.roles.remove(role.id);
      removed.push(role.name);
    }
  }

  if (announce && added.length) {
    await announceNewFarmerRoles(member, wallet, added);
  }

  return { added, removed };
}

function getSuccessChance(member) {
  let chance = 0.4;

  if (member.roles.cache.has(ROLES.food.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.wood.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.silver.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.tool.id)) chance += 0.10;
  if (member.roles.cache.has(ROLES.fullFarm.id)) chance += 0.15;

  return Math.min(chance, 0.75);
}

function buildFarmEventEmbed(farmEvent) {
  const fields = [
    {
      name: "⏳ Time Limit",
      value: "5 minutes",
      inline: true
    },
    {
      name: "💰 Rescue Reward",
      value: `${farmEvent.rewardMin}-${farmEvent.rewardMax} $NKFE`,
      inline: true
    },
    {
      name: "🎮 How to Join",
      value: "Run `/fp-rescue`, press **Rescue Pet**, or press **Help the Farm** after your attempt.",
      inline: false
    }
  ];

  if (farmEvent.isCommunity) {
    fields.splice(2, 0, {
      name: "🤝 Community Goal",
      value:
        `${makeProgressBar(farmEvent.communitySuccesses, farmEvent.communityGoal)} ` +
        `**${farmEvent.communitySuccesses}/${farmEvent.communityGoal}** successful rescues\n` +
        `Farmhand Help: **${farmEvent.communityHelps || 0}** help(s); every ` +
        `**${COMMUNITY_HELPS_PER_PROGRESS}** helps adds +1 progress.\n` +
        `Server milestone reward: **${farmEvent.communityBonus} $NKFE** for every verified participant if the goal is met.`,
      inline: false
    });
  }

  return new EmbedBuilder()
    .setColor(farmEvent.isCommunity ? EMBED_COLORS.info : EMBED_COLORS.farm)
    .setTitle(farmEvent.name)
    .setDescription(
      farmEvent.isCommunity
        ? "🤝 A co-op Farm Emergency has started! Work together to hit the server goal."
        : "🚨 A Farm Emergency has started!"
    )
    .addFields(fields)
    .setFooter({ text: "Farmer Pets Rescue Event" })
    .setTimestamp();
}

function buildRescueResultEmbed({ member, farmEvent, success, reward, successChance, streak }) {
  const currentStreak = Number(streak?.current_rescue_streak || 0);
  const bestStreak = Number(streak?.best_rescue_streak || 0);
  const fields = [
    { name: "Farmer", value: `**${member.displayName}**`, inline: true },
    { name: "Event", value: farmEvent.name, inline: true },
    { name: "Success Chance", value: formatPercent(successChance), inline: true },
    { name: "Reward", value: `${reward} $NKFE`, inline: true },
    { name: "Current Streak", value: `${currentStreak}`, inline: true },
    { name: "Best Streak", value: `${bestStreak}`, inline: true }
  ];

  if (farmEvent.isCommunity) {
    fields.push({
      name: "🤝 Co-op Progress",
      value:
        `${makeProgressBar(farmEvent.communitySuccesses, farmEvent.communityGoal)} ` +
        `**${farmEvent.communitySuccesses}/${farmEvent.communityGoal}** successful rescues\n` +
        `Farmhand Help: **${farmEvent.communityHelps || 0}** help(s)`,
      inline: false
    });
  }

  return new EmbedBuilder()
    .setColor(success ? EMBED_COLORS.success : EMBED_COLORS.danger)
    .setTitle(success ? "🌾 Farm Rescue Success!" : "🛡 Rescue Failed")
    .setDescription(
      success
        ? `${member.displayName} rescued a pet and earned **${reward} $NKFE**.`
        : `${member.displayName} could not complete this rescue.`
    )
    .addFields(fields)
    .setTimestamp();
}

function buildCommunityGoalReachedEmbed(farmEvent) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle("🎉 Community Goal Reached!")
    .setDescription(
      `Farmers hit **${farmEvent.communitySuccesses}/${farmEvent.communityGoal}** successful rescues for **${farmEvent.name}**!`
    )
    .addFields({
      name: "Server Milestone Reward",
      value: `Every verified participant will receive **${farmEvent.communityBonus} $NKFE** when the event ends.`,
      inline: false
    })
    .setTimestamp();
}

function buildCommunityEventEndEmbed(farmEvent, rewardedCount) {
  const goalMet = farmEvent.communitySuccesses >= farmEvent.communityGoal;

  return new EmbedBuilder()
    .setColor(goalMet ? EMBED_COLORS.success : EMBED_COLORS.warning)
    .setTitle(goalMet ? "🏆 Co-op Farm Event Complete" : "🌾 Co-op Farm Event Ended")
    .setDescription(
      goalMet
        ? `The server completed **${farmEvent.name}** and unlocked the milestone reward!`
        : `The server made progress on **${farmEvent.name}**, but the milestone goal was not reached this time.`
    )
    .addFields(
      {
        name: "Final Progress",
        value:
          `${makeProgressBar(farmEvent.communitySuccesses, farmEvent.communityGoal)} ` +
          `**${farmEvent.communitySuccesses}/${farmEvent.communityGoal}** successful rescues\n` +
          `Farmhand Help: **${farmEvent.communityHelps || 0}** help(s)`,
        inline: false
      },
      {
        name: "Participants",
        value: `**${farmEvent.players.size}** verified farmer(s) joined`,
        inline: true
      },
      {
        name: "Milestone Reward",
        value: goalMet
          ? `**${rewardedCount}** farmer(s) received **${farmEvent.communityBonus} $NKFE**.`
          : "No milestone reward this time.",
        inline: true
      }
    )
    .setTimestamp();
}

function buildFarmHelpEmbed({ member, farmEvent, progressAdded }) {
  const fields = [
    { name: "Farmhand", value: `**${member.displayName}**`, inline: true },
    { name: "Event", value: farmEvent.name, inline: true }
  ];

  if (farmEvent.isCommunity) {
    fields.push(
      {
        name: "Farmhand Help",
        value:
          `Total Helps: **${farmEvent.communityHelps || 0}**\n` +
          `Every **${COMMUNITY_HELPS_PER_PROGRESS}** helps adds +1 community progress.`,
        inline: true
      },
      {
        name: "Community Progress",
        value:
          `${makeProgressBar(farmEvent.communitySuccesses, farmEvent.communityGoal)} ` +
          `**${farmEvent.communitySuccesses}/${farmEvent.communityGoal}** successful rescues`,
        inline: false
      }
    );
  }

  return new EmbedBuilder()
    .setColor(progressAdded ? EMBED_COLORS.success : EMBED_COLORS.info)
    .setTitle(progressAdded ? "🧑‍🌾 Farmhand Help Added Progress!" : "🧑‍🌾 Farmhand Help Added!")
    .setDescription(
      progressAdded
        ? `${member.displayName} helped the farm and added **+1** community progress!`
        : `${member.displayName} helped gather supplies, repair fences, and rally the farm.`
    )
    .addFields(fields)
    .setTimestamp();
}

function buildDailyCheckInEmbed({ displayName, wallet, streak, bestStreak, reward, todayKey }) {
  const bonusLine = reward.streakBonus
    ? `\n🔥 7-day streak bonus: **${reward.streakBonus} $NKFE**`
    : "";

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.success)
    .setTitle("🌞 Daily Farm Check-In Complete")
    .setDescription(
      `**${displayName}** checked in for **${todayKey}** and earned **${reward.total} $NKFE**.` +
      bonusLine
    )
    .addFields(
      { name: "Wallet", value: `**${wallet}**`, inline: false },
      { name: "Daily Streak", value: `${streak} day(s)`, inline: true },
      { name: "Best Daily Streak", value: `${bestStreak} day(s)`, inline: true },
      { name: "Base Reward", value: `${reward.base} $NKFE`, inline: true }
    )
    .setFooter({ text: `Daily reset uses ${PACIFIC_TIME_ZONE}.` })
    .setTimestamp();
}

function buildAlreadyCheckedInEmbed({ displayName, lastDailyCheckIn, streak }) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setTitle("🌞 Daily Farm Check-In Already Claimed")
    .setDescription(
      `**${displayName}**, you already checked in today (${lastDailyCheckIn}). Come back tomorrow!`
    )
    .addFields({ name: "Current Daily Streak", value: `${streak} day(s)`, inline: true })
    .setFooter({ text: `Daily reset uses ${PACIFIC_TIME_ZONE}.` })
    .setTimestamp();
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
      embeds: [buildFarmEventEmbed(farmEvent)],
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
      embeds: [buildFarmEventEmbed(farmEvent)],
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

  await target.send({ embeds: [buildCommunityGoalReachedEmbed(farmEvent)] });
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
    await target.send({ embeds: [buildCommunityEventEndEmbed(farmEvent, rewardedCount)] });
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
      embeds: [buildFarmEventEmbed(farmEvent)],
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

    const resultEmbed = buildRescueResultEmbed({
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
      content: "No verified wallet found. Please verify your wallet first using `/verify`.",
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

  const helpEmbed = buildFarmHelpEmbed({
    member: farmHelpMember,
    farmEvent,
    progressAdded
  });

  const updated = updateRes.rows[0];

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
      embeds: [buildAlreadyCheckedInEmbed({
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
    embeds: [buildDailyCheckInEmbed({
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

  return { embeds: [buildStatsEmbed({ displayName, row, wallet })] };
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

      const roleResult = await syncRoles(member, analysis, wallet, true);

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
