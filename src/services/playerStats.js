const { FLAGS_EPHEMERAL, LEADERBOARD_CHANNEL } = require("../config");
const {
  ensurePlayer,
  getDailyCheckInState,
  getPayoutRows,
  getStatsRow,
  getWallet,
  getWeeklyLeaderboardRows,
  recordDailyCheckIn,
  resetWeeklyStats
} = require("../db");
const { getPacificDateKey, getYesterdayPacificDateKey } = require("../utils/dates");
const { calculateDailyReward } = require("../utils/rewards");
const embedBuilders = require("../ui/embeds");

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

async function postWeeklyLeaderboardAndReset(client) {
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

module.exports = {
  buildLeaderboardMessage,
  buildStatsPayload,
  handleDailyCheckIn,
  postWeeklyLeaderboardAndReset
};
