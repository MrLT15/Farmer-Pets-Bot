const { EmbedBuilder } = require("discord.js");

const {
  COMMUNITY_HELPS_PER_PROGRESS,
  EMBED_COLORS,
  FARM_EVENT_DURATION_MINUTES,
  COMMUNITY_EVENT_DURATION_MINUTES,
  PACIFIC_TIME_ZONE
} = require("../config");
const { formatNumber, formatPercent } = require("../utils/format");
const { makeProgressBar } = require("../utils/progress");
const { getSeasonDescription } = require("../services/seasons");
const { getCommunityEventPool, getSharedCommunityPayout } = require("../services/farmEvents");

function buildFarmEventEmbed(farmEvent) {
  const fields = [
    {
      name: "⏳ Time Limit",
      value: `${farmEvent.type === "community" ? COMMUNITY_EVENT_DURATION_MINUTES : FARM_EVENT_DURATION_MINUTES} minutes`,
      inline: true
    },
    {
      name: "💰 Rescue Reward",
      value: farmEvent.type === "community"
        ? `Shared pool up to **${farmEvent.communityPoolMax || 200} $NKFE**`
        : `${farmEvent.rewardMin}-${farmEvent.rewardMax} $NKFE`,
      inline: true
    },
    {
      name: "🎮 How to Join",
      value: "Run `/fp-rescue`, press **Rescue Pet**, or press **Help the Farm** after your attempt.",
      inline: false
    },
    {
      name: "🌍 Current Season",
      value: `${farmEvent.season || "Spring"}\n${getSeasonDescription(farmEvent.season || "Spring", farmEvent.summerBoostResource)}`,
      inline: false
    }
  ];

  if (farmEvent.type === "community") {
    fields.splice(2, 0, {
      name: "👑 Commander Event",
      value:
        `Started by: **${farmEvent.commanderStarterName || "Commander"}**\n` +
        `Shared pool: **${getCommunityEventPool(farmEvent)} $NKFE**; successful rescuers split the pool at event end.`,
      inline: false
    });
  } else if (farmEvent.isCommunity) {
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

function buildRescueResultEmbed({ member, farmEvent, success, reward, successChance, streak, bonusBreakdown }) {
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

  if (bonusBreakdown?.total) {
    fields.push({
      name: "NFT Reward Bonus",
      value: [
        bonusBreakdown.ndvBonus ? `NDV: +${bonusBreakdown.ndvBonus} $NKFE` : null,
        bonusBreakdown.parrotBonus ? `Parrot: +${bonusBreakdown.parrotBonus} $NKFE` : null
      ].filter(Boolean).join("\n"),
      inline: false
    });
  }

  if (farmEvent.isCommunity && farmEvent.type !== "community") {
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
  if (farmEvent.type === "community") return buildCommanderCommunityEventEndEmbed(farmEvent, rewardedCount);

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

function buildCommanderCommunityEventEndEmbed(farmEvent, rewardedCount) {
  const pool = getCommunityEventPool(farmEvent);
  const payout = getSharedCommunityPayout(farmEvent);
  const successCount = farmEvent.successfulRescuers?.size || 0;

  return new EmbedBuilder()
    .setColor(successCount ? EMBED_COLORS.success : EMBED_COLORS.warning)
    .setTitle(successCount ? "👑 Commander Community Rescue Complete" : "👑 Commander Community Rescue Ended")
    .setDescription(
      successCount
        ? `**${successCount}** successful rescuer(s) split the Commander event pool.`
        : "No successful rescues this time, so the shared pool was not paid out."
    )
    .addFields(
      { name: "Commander", value: `**${farmEvent.commanderStarterName || "Commander"}**`, inline: true },
      { name: "Participants", value: `**${farmEvent.players?.size || 0}**`, inline: true },
      { name: "Successful Rescuers", value: `**${successCount}**`, inline: true },
      { name: "Shared Pool", value: `**${pool} $NKFE**`, inline: true },
      { name: "Payout Each", value: payout ? `**${payout} $NKFE**` : "No payout", inline: true },
      { name: "Paid Farmers", value: `**${rewardedCount}**`, inline: true }
    )
    .setTimestamp();
}

function buildFarmHelpEmbed({ member, farmEvent, progressAdded }) {
  const fields = [
    { name: "Farmhand", value: `**${member.displayName}**`, inline: true },
    { name: "Event", value: farmEvent.name, inline: true }
  ];

  if (farmEvent.isCommunity && farmEvent.type !== "community") {
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

function buildStatsEmbed({ displayName, row, wallet }) {
  const attempts = Number(row.total_attempts || 0);
  const successes = Number(row.total_successes || 0);
  const successRate = attempts ? successes / attempts : 0;
  const weeklyAttempts = Number(row.weekly_attempts || 0);
  const weeklySuccesses = Number(row.weekly_successes || 0);
  const weeklySuccessRate = weeklyAttempts ? weeklySuccesses / weeklyAttempts : 0;

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.info)
    .setTitle("🌾 Farmer Pets Stats")
    .setDescription(`Stats for **${displayName}**`)
    .addFields(
      { name: "Wallet", value: `**${wallet}**`, inline: false },
      {
        name: "💰 NKFE",
        value: [
          `Payout Owed: **${formatNumber(row.payout_nkfe)} $NKFE**`,
          `Weekly: **${formatNumber(row.weekly_nkfe)} $NKFE**`,
          `Lifetime: **${formatNumber(row.lifetime_nkfe)} $NKFE**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🛡 Rescue Record",
        value: [
          `Attempts: **${formatNumber(attempts)}**`,
          `Successes: **${formatNumber(successes)}**`,
          `Success Rate: **${formatPercent(successRate)}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🏆 Weekly Rescue",
        value: [
          `Attempts: **${formatNumber(weeklyAttempts)}**`,
          `Successes: **${formatNumber(weeklySuccesses)}**`,
          `Success Rate: **${formatPercent(weeklySuccessRate)}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🔥 Rescue Streaks",
        value: [
          `Current: **${formatNumber(row.current_rescue_streak)}**`,
          `Best: **${formatNumber(row.best_rescue_streak)}**`
        ].join("\n"),
        inline: true
      },
      {
        name: "🌞 Daily Check-In",
        value: [
          `Current: **${formatNumber(row.daily_streak)} day(s)**`,
          `Best: **${formatNumber(row.best_daily_streak)} day(s)**`,
          `Last: **${row.last_daily_checkin_key || "Never"}**`
        ].join("\n"),
        inline: true
      }
    )
    .setFooter({ text: `Daily reset uses ${PACIFIC_TIME_ZONE}.` })
    .setTimestamp();
}

module.exports = {
  buildFarmEventEmbed,
  buildRescueResultEmbed,
  buildCommunityGoalReachedEmbed,
  buildCommunityEventEndEmbed,
  buildFarmHelpEmbed,
  buildDailyCheckInEmbed,
  buildAlreadyCheckedInEmbed,
  buildStatsEmbed
};
