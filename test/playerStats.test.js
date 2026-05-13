const assert = require("node:assert/strict");
const test = require("node:test");

const { createPlayerStatsService } = require("../src/services/playerStats");

const FLAGS_EPHEMERAL = 64;

function createInteraction({ userId = "farmer", displayName = "Daily Farmer" } = {}) {
  const member = { displayName };
  const interaction = {
    user: { id: userId },
    guild: {
      members: {
        fetchCalls: [],
        fetch: async id => {
          interaction.guild.members.fetchCalls.push(id);
          return member;
        }
      }
    },
    replyPayloads: [],
    reply: async payload => {
      interaction.replyPayloads.push(payload);
    }
  };

  return interaction;
}

function createService(overrides = {}) {
  const calls = [];
  const db = {
    ensurePlayer: async (discordId, wallet) => calls.push(["ensurePlayer", discordId, wallet]),
    getDailyCheckInState: async discordId => {
      calls.push(["getDailyCheckInState", discordId]);
      return { daily_streak: 2, last_daily_checkin_key: "2026-05-08" };
    },
    getPayoutRows: async () => [],
    getStatsRow: async discordId => {
      calls.push(["getStatsRow", discordId]);
      return { lifetime_nkfe: 9 };
    },
    getWallet: async discordId => {
      calls.push(["getWallet", discordId]);
      return "wallet.wam";
    },
    getWeeklyLeaderboardRows: async () => [],
    recordDailyCheckIn: async (discordId, reward, streak, todayKey) => {
      calls.push(["recordDailyCheckIn", discordId, reward, streak, todayKey]);
      return { daily_streak: streak, best_daily_streak: 5 };
    },
    resetWeeklyStats: async () => calls.push(["resetWeeklyStats"])
  };
  const embedBuilders = {
    buildAlreadyCheckedInEmbed: payload => ({ type: "already", payload }),
    buildDailyCheckInEmbed: payload => ({ type: "daily", payload }),
    buildStatsEmbed: payload => ({ type: "stats", payload })
  };
  const service = createPlayerStatsService({
    config: {
      FLAGS_EPHEMERAL,
      LEADERBOARD_CHANNEL: "leaderboard-channel"
    },
    db: { ...db, ...overrides.db },
    dates: {
      getPacificDateKey: () => "2026-05-09",
      getYesterdayPacificDateKey: () => "2026-05-08",
      ...overrides.dates
    },
    rewards: {
      calculateDailyReward: streak => ({ base: 3, bonus: 2, total: streak + 4 }),
      ...overrides.rewards
    },
    embedBuilders: { ...embedBuilders, ...overrides.embedBuilders }
  });

  return { calls, service };
}

test("handleDailyCheckIn prompts users without a verified wallet", async () => {
  const { calls, service } = createService({
    db: { getWallet: async discordId => {
      calls.push(["getWallet", discordId]);
      return null;
    } }
  });
  const interaction = createInteraction();

  await service.handleDailyCheckIn(interaction);

  assert.deepEqual(calls, [["getWallet", "farmer"]]);
  assert.deepEqual(interaction.replyPayloads.at(-1), {
    content: "No verified wallet found. Please verify your wallet first using `/verify`.",
    flags: FLAGS_EPHEMERAL
  });
});

test("handleDailyCheckIn replies with already-checked-in embed", async () => {
  const { calls, service } = createService({
    db: { getDailyCheckInState: async discordId => {
      calls.push(["getDailyCheckInState", discordId]);
      return { daily_streak: 4, last_daily_checkin_key: "2026-05-09" };
    } }
  });
  const interaction = createInteraction({ displayName: "Checked Farmer" });

  await service.handleDailyCheckIn(interaction);

  assert.deepEqual(calls, [
    ["getWallet", "farmer"],
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["getDailyCheckInState", "farmer"]
  ]);
  assert.equal(interaction.replyPayloads.at(-1).flags, FLAGS_EPHEMERAL);
  assert.deepEqual(interaction.replyPayloads.at(-1).embeds[0], {
    type: "already",
    payload: {
      displayName: "Checked Farmer",
      lastDailyCheckIn: "2026-05-09",
      streak: 4
    }
  });
});

test("handleDailyCheckIn records continued streak and reward", async () => {
  const { calls, service } = createService();
  const interaction = createInteraction({ displayName: "Streak Farmer" });

  await service.handleDailyCheckIn(interaction);

  assert.deepEqual(calls, [
    ["getWallet", "farmer"],
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["getDailyCheckInState", "farmer"],
    ["recordDailyCheckIn", "farmer", 7, 3, "2026-05-09"]
  ]);
  assert.equal(interaction.replyPayloads.at(-1).flags, FLAGS_EPHEMERAL);
  assert.deepEqual(interaction.replyPayloads.at(-1).embeds[0].payload, {
    displayName: "Streak Farmer",
    wallet: "wallet.wam",
    streak: 3,
    bestStreak: 5,
    reward: { base: 3, bonus: 2, total: 7 },
    todayKey: "2026-05-09"
  });
});

test("buildStatsPayload prompts missing wallets and builds stats embeds", async () => {
  const missing = createService({
    db: { getWallet: async () => null }
  });

  assert.deepEqual(await missing.service.buildStatsPayload("farmer", "Stats Farmer"), {
    content: "No verified wallet found. Please verify your wallet first using `/verify`."
  });

  const { calls, service } = createService();

  assert.deepEqual(await service.buildStatsPayload("farmer", "Stats Farmer"), {
    embeds: [{
      type: "stats",
      payload: {
        displayName: "Stats Farmer",
        row: { lifetime_nkfe: 9 },
        wallet: "wallet.wam"
      }
    }]
  });
  assert.deepEqual(calls, [
    ["getWallet", "farmer"],
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["getStatsRow", "farmer"]
  ]);
});

test("buildLeaderboardMessage formats empty and populated leaderboards", async () => {
  const empty = createService();

  assert.equal(
    await empty.service.buildLeaderboardMessage(),
    "🏆 **Farmer Pets Weekly Leaderboard**\n\nNo Farmer Pets rescue activity this week."
  );

  const populated = createService({
    db: {
      getWeeklyLeaderboardRows: async () => [
        {
          discord_id: "123",
          wallet: "wallet.wam",
          weekly_nkfe: 12,
          weekly_successes: 3,
          weekly_attempts: 4,
          lifetime_nkfe: 99
        }
      ]
    }
  });

  assert.match(await populated.service.buildLeaderboardMessage(), /1\. Discord ID 123 — \*\*12 \$NKFE\*\*/);
  assert.match(await populated.service.buildLeaderboardMessage({ mentionPlayers: true }), /1\. <@123> — \*\*12 \$NKFE\*\*/);
});

test("postWeeklyLeaderboardAndReset posts tagged weekly leaderboard, payout status, and resets weekly stats", async () => {
  const sentMessages = [];
  const { calls, service } = createService({
    db: {
      getPayoutRows: async () => [
        { payout_nkfe: 4 },
        { payout_nkfe: "6" },
        { payout_nkfe: null }
      ],
      getWeeklyLeaderboardRows: async () => [{
        discord_id: "123",
        wallet: "wallet.wam",
        weekly_nkfe: 10,
        weekly_successes: 2,
        weekly_attempts: 3,
        lifetime_nkfe: 20
      }]
    }
  });
  const client = {
    channels: {
      fetchCalls: [],
      fetch: async channelId => {
        client.channels.fetchCalls.push(channelId);
        return { send: async message => sentMessages.push(message) };
      }
    }
  };

  await service.postWeeklyLeaderboardAndReset(client);

  assert.deepEqual(client.channels.fetchCalls, ["leaderboard-channel"]);
  assert.match(sentMessages.at(-1).content, /<@123> — \*\*10 \$NKFE\*/);
  assert.match(sentMessages.at(-1).content, /Total Farmer Pets NKFE Earned This Week:\*\* 10 \$NKFE/);
  assert.match(sentMessages.at(-1).content, /Automatic \$NKFE payout service is not configured/);
  assert.deepEqual(sentMessages.at(-1).allowedMentions, { users: ["123"], roles: [], parse: [] });
  assert.deepEqual(calls, [["resetWeeklyStats"]]);
});
