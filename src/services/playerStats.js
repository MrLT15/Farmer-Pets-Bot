const defaultConfig = require("../config");
const defaultDb = require("../db");
const defaultDates = require("../utils/dates");
const defaultRewards = require("../utils/rewards");
const defaultEmbedBuilders = require("../ui/embeds");

function createPlayerStatsService({
  config = defaultConfig,
  db = defaultDb,
  dates = defaultDates,
  rewards = defaultRewards,
  embedBuilders = defaultEmbedBuilders
} = {}) {
  async function handleDailyCheckIn(interaction) {
    const wallet = await db.getWallet(interaction.user.id);

    if (!wallet) {
      await interaction.reply({
        content: "No verified wallet found. Please verify your wallet first using `/verify`.",
        flags: config.FLAGS_EPHEMERAL
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const todayKey = dates.getPacificDateKey();
    const yesterdayKey = dates.getYesterdayPacificDateKey();

    await db.ensurePlayer(interaction.user.id, wallet);

    const fpDailyCheckInState = await db.getDailyCheckInState(interaction.user.id);
    const fpDailyLastCheckInKey = fpDailyCheckInState.last_daily_checkin_key;

    if (fpDailyLastCheckInKey === todayKey) {
      await interaction.reply({
        embeds: [embedBuilders.buildAlreadyCheckedInEmbed({
          displayName: member.displayName,
          lastDailyCheckIn: fpDailyLastCheckInKey,
          streak: Number(fpDailyCheckInState.daily_streak || 0)
        })],
        flags: config.FLAGS_EPHEMERAL
      });
      return;
    }

    const streak = fpDailyLastCheckInKey === yesterdayKey
      ? Number(fpDailyCheckInState.daily_streak || 0) + 1
      : 1;
    const reward = rewards.calculateDailyReward(streak);

    const updated = await db.recordDailyCheckIn(interaction.user.id, reward.total, streak, todayKey);

    await interaction.reply({
      embeds: [embedBuilders.buildDailyCheckInEmbed({
        displayName: member.displayName,
        wallet,
        streak: Number(updated.daily_streak || 0),
        bestStreak: Number(updated.best_daily_streak || 0),
        reward,
        todayKey
      })],
      flags: config.FLAGS_EPHEMERAL
    });
  }

  async function buildStatsPayload(discordId, displayName) {
    const wallet = await db.getWallet(discordId);

    if (!wallet) {
      return {
        content: "No verified wallet found. Please verify your wallet first using `/verify`."
      };
    }

    await db.ensurePlayer(discordId, wallet);

    const row = await db.getStatsRow(discordId);

    return { embeds: [embedBuilders.buildStatsEmbed({ displayName, row, wallet })] };
  }

  async function buildLeaderboardMessage() {
    const rows = await db.getWeeklyLeaderboardRows();

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
    const channel = await client.channels.fetch(config.LEADERBOARD_CHANNEL);
    const leaderboard = await buildLeaderboardMessage();

    const payoutRows = await db.getPayoutRows();

    const totalPayout = payoutRows.reduce(
      (sum, row) => sum + Number(row.payout_nkfe || 0),
      0
    );

    await channel.send(
      `${leaderboard}\n\n` +
      `💰 **Total Farmer Pets NKFE Owed:** ${totalPayout} $NKFE\n\n` +
      `Use **/fp-payouts** for the manual payout list.`
    );

    await db.resetWeeklyStats();
  }

  return {
    buildLeaderboardMessage,
    buildStatsPayload,
    handleDailyCheckIn,
    postWeeklyLeaderboardAndReset
  };
}

const playerStatsService = createPlayerStatsService();

module.exports = {
  createPlayerStatsService,
  ...playerStatsService
};
