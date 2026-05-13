const { formatPortStatus } = require("../utils/ports");

function createCommandHandlers({
  announceNewFarmerRoles,
  analyzeAssets,
  analyzeUtilityAssets = () => ({}),
  buildLeaderboardMessage,
  buildStatsPayload,
  cancelActiveFarmEvent,
  config = {},
  flagsEphemeral,
  getAssets,
  getPayoutRows,
  getPendingWithdrawalRows,
  getPlayerBalance,
  getWallet,
  getActiveFarmEvent,
  commanderEventCooldowns = new Map(),
  getRemainingEventMs = farmEvent => Math.max((farmEvent?.expires || Date.now()) - Date.now(), 0),
  handleDailyCheckIn,
  handleRescue,
  postWeeklyLeaderboardAndReset,
  requestWithdrawal,
  resetPayouts,
  startCommunityFarmEvent,
  startFarmEvent,
  syncRoles,
  uptime = () => process.uptime()
}) {
  return {
    "fp-rescue": handleRescue,
    "fp-roles": interaction => handleRolesCommand(interaction, {
      announceNewFarmerRoles,
      analyzeAssets,
      analyzeUtilityAssets,
      flagsEphemeral,
      getAssets,
      getWallet,
      syncRoles
    }),
    "fp-stats": interaction => handleStatsCommand(interaction, {
      buildStatsPayload,
      flagsEphemeral
    }),
    "fp-daily": handleDailyCheckIn,
    "fp-leaderboard": interaction => handleLeaderboardCommand(interaction, {
      buildLeaderboardMessage
    }),
    "fp-communityevent": interaction => handleCommunityEventCommand(interaction, {
      analyzeUtilityAssets,
      commanderEventCooldowns,
      flagsEphemeral,
      getActiveFarmEvent,
      getAssets,
      getWallet,
      startCommunityFarmEvent
    }),
    "fp-payouts": interaction => handlePayoutsCommand(interaction, {
      flagsEphemeral,
      getPayoutRows
    }),
    "fp-withdraw": interaction => handleWithdrawCommand(interaction, {
      flagsEphemeral,
      getPlayerBalance,
      getWallet,
      requestWithdrawal
    }),
    "fp-resetpayouts": interaction => handleResetPayoutsCommand(interaction, {
      flagsEphemeral,
      resetPayouts
    }),
    "fp-withdrawals": interaction => handleWithdrawalsCommand(interaction, {
      flagsEphemeral,
      getPendingWithdrawalRows
    }),
    "fp-testevent": interaction => handleTestEventCommand(interaction, {
      flagsEphemeral,
      getActiveFarmEvent,
      startFarmEvent
    }),
    "fp-eventstatus": interaction => handleEventStatusCommand(interaction, {
      flagsEphemeral,
      getActiveFarmEvent,
      getRemainingEventMs
    }),
    "fp-cancelevent": interaction => handleCancelEventCommand(interaction, {
      cancelActiveFarmEvent,
      flagsEphemeral,
      getActiveFarmEvent
    }),
    "fp-postleaderboard": interaction => handlePostLeaderboardCommand(interaction, {
      flagsEphemeral,
      postWeeklyLeaderboardAndReset
    }),
    "fp-health": interaction => handleHealthCommand(interaction, {
      config,
      flagsEphemeral,
      getActiveFarmEvent,
      uptime
    })
  };
}

async function handleRolesCommand(interaction, {
  announceNewFarmerRoles,
  analyzeAssets,
  analyzeUtilityAssets,
  flagsEphemeral,
  getAssets,
  getWallet,
  syncRoles
}) {
  await interaction.deferReply({ flags: flagsEphemeral });

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
  const utilityProfile = analyzeUtilityAssets([
    ...(assetData.combinedAssets || []),
    ...(assetData.utilityAssets || [])
  ]);
  const companions = utilityProfile.companions || { dog: 0, cat: 0, bunny: 0, parrot: 0 };
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
    `🛡️ Security Forces: **${utilityProfile.securityForces}**\n` +
    `🚚 NDV Utility: **${utilityProfile.ndv}** (${utilityProfile.largeNdv} large/legendary)\n` +
    `🚌 NPC Utility: **${utilityProfile.npc}**\n` +
    `👑 Commander NFTs: **${utilityProfile.commander}**\n` +
    `🐾 Companions: Dog **${companions.dog || 0}**, Cat **${companions.cat || 0}**, Bunny **${companions.bunny || 0}**, Parrot **${companions.parrot || 0}**\n` +
    `${assetData.utilityScanFailed ? "⚠️ Utility NFT scan failed; showing Farmer Pets-only utility matches.\n" : ""}\n` +
    `**Roles Added:**\n${roleResult.added.length ? roleResult.added.join("\n") : "None"}\n\n` +
    `**Roles Removed:**\n${roleResult.removed.length ? roleResult.removed.join("\n") : "None"}`
  );
}

async function handleStatsCommand(interaction, { buildStatsPayload, flagsEphemeral }) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const payload = await buildStatsPayload(interaction.user.id, member.displayName);

  await interaction.reply({
    ...payload,
    flags: flagsEphemeral
  });
}

async function handleLeaderboardCommand(interaction, { buildLeaderboardMessage }) {
  const message = await buildLeaderboardMessage({ mentionPlayers: false });

  await interaction.reply({
    content: message,
    allowedMentions: { parse: [], users: [], roles: [] }
  });
}

async function handleCommunityEventCommand(interaction, {
  analyzeUtilityAssets,
  commanderEventCooldowns,
  flagsEphemeral,
  getActiveFarmEvent,
  getAssets,
  getWallet,
  startCommunityFarmEvent
}) {
  await interaction.deferReply({ flags: flagsEphemeral });

  if (getActiveFarmEvent()) {
    await interaction.editReply("A Farmer Pets event is already active. Try again after it ends.");
    return;
  }

  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
    await interaction.editReply("You must verify your wallet first using `/verify`.");
    return;
  }

  const lastStartedAt = commanderEventCooldowns.get(interaction.user.id) || 0;
  const cooldownMs = 24 * 60 * 60 * 1000;

  if (Date.now() - lastStartedAt < cooldownMs) {
    const remainingMs = cooldownMs - (Date.now() - lastStartedAt);
    await interaction.editReply(`Commander event cooldown active. Try again in **${formatDuration(remainingMs)}**.`);
    return;
  }

  let assetData;

  try {
    assetData = await getAssets(wallet);
  } catch (error) {
    await interaction.editReply("NFT utility services are unavailable right now; no event was started.");
    return;
  }

  const profile = analyzeUtilityAssets([
    ...(assetData.combinedAssets || []),
    ...(assetData.utilityAssets || [])
  ]);

  if (!profile.commander) {
    await interaction.editReply("Commander NFT required to start a community rescue event.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const started = await startCommunityFarmEvent({
    starterId: interaction.user.id,
    starterName: member.displayName
  });

  if (!started) {
    await interaction.editReply("A Farmer Pets event is already active. Try again after it ends.");
    return;
  }

  commanderEventCooldowns.set(interaction.user.id, Date.now());
  await interaction.editReply("Commander community rescue event started in fp-general.");
}

async function handlePayoutsCommand(interaction, { flagsEphemeral, getPayoutRows }) {
  const payoutRows = await getPayoutRows();

  if (!payoutRows.length) {
    await interaction.reply({
      content: "No Farmer Pets NKFE payouts owed right now.",
      flags: flagsEphemeral
    });
    return;
  }

  const lines = payoutRows.map(row =>
    `${row.wallet} — **${row.payout_nkfe} $NKFE** — Discord ID ${row.discord_id}`
  );

  await interaction.reply({
    content:
      "💰 **Farmer Pets Manual Payout List**\n\n" +
      lines.join("\n") +
      "\n\nAfter manual payment, run `/fp-resetpayouts`.",
    flags: flagsEphemeral
  });
}


async function handleWithdrawCommand(interaction, {
  flagsEphemeral,
  getPlayerBalance,
  getWallet,
  requestWithdrawal
}) {
  await interaction.deferReply({ flags: flagsEphemeral });

  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
    await interaction.editReply("No verified wallet found. Please verify your wallet first using `/verify`.");
    return;
  }

  const balance = await getPlayerBalance(interaction.user.id);
  const available = Number(balance?.payout_nkfe || 0);

  if (!available) {
    await interaction.editReply("You do not have any withdrawable Farmer Pets $NKFE yet.");
    return;
  }

  const requestedAmount = interaction.options?.getInteger?.("amount") || available;

  if (requestedAmount > available) {
    await interaction.editReply(`You only have **${available} $NKFE** available to withdraw.`);
    return;
  }

  const result = await requestWithdrawal(interaction.user.id, wallet, requestedAmount);

  if (!result.ok) {
    await interaction.editReply(`Withdrawal request could not be created. Available balance: **${result.available || 0} $NKFE**.`);
    return;
  }

  await interaction.editReply(
    `✅ Withdrawal request **#${result.withdrawal.id}** created for **${result.withdrawal.amount_nkfe} $NKFE** to wallet **${wallet}**. ` +
    `Remaining bot balance: **${result.remaining} $NKFE**.`
  );
}

async function handleWithdrawalsCommand(interaction, { flagsEphemeral, getPendingWithdrawalRows }) {
  const rows = await getPendingWithdrawalRows();

  if (!rows.length) {
    await interaction.reply({
      content: "No pending Farmer Pets $NKFE withdrawal requests.",
      flags: flagsEphemeral
    });
    return;
  }

  const lines = rows.map(row =>
    `#${row.id} — ${row.wallet} — **${row.amount_nkfe} $NKFE** — Discord ID ${row.discord_id}`
  );

  await interaction.reply({
    content:
      "🏦 **Pending Farmer Pets $NKFE Withdrawals**\n\n" +
      lines.join("\n") +
      "\n\nProcess these from the treasury/withdrawal system; the bot has already locked these amounts out of player balances.",
    flags: flagsEphemeral,
    allowedMentions: { parse: [], users: [], roles: [] }
  });
}

async function handleResetPayoutsCommand(interaction, { flagsEphemeral, resetPayouts }) {
  await resetPayouts();

  await interaction.reply({
    content: "Farmer Pets payout balances reset to 0. Lifetime stats were preserved.",
    flags: flagsEphemeral
  });
}

async function handleTestEventCommand(interaction, {
  flagsEphemeral,
  getActiveFarmEvent,
  startFarmEvent
}) {
  await interaction.deferReply({ flags: flagsEphemeral });

  if (getActiveFarmEvent()) {
    await interaction.editReply("A Farmer Pets event is already active.");
    return;
  }

  const started = await startFarmEvent();

  await interaction.editReply(
    started
      ? "Test Farmer Pets event started."
      : "A Farmer Pets event is already active."
  );
}

async function handleEventStatusCommand(interaction, {
  flagsEphemeral,
  getActiveFarmEvent,
  commanderEventCooldowns = new Map(),
  getRemainingEventMs
}) {
  const farmEvent = getActiveFarmEvent();

  if (!farmEvent) {
    await interaction.reply({
      content: "No active Farmer Pets event.",
      flags: flagsEphemeral
    });
    return;
  }

  await interaction.reply({
    content: buildEventStatusMessage(farmEvent, getRemainingEventMs(farmEvent)),
    flags: flagsEphemeral
  });
}

async function handleCancelEventCommand(interaction, {
  cancelActiveFarmEvent,
  flagsEphemeral,
  getActiveFarmEvent
}) {
  await interaction.deferReply({ flags: flagsEphemeral });

  const farmEvent = getActiveFarmEvent();

  if (!farmEvent) {
    await interaction.editReply("No active Farmer Pets event to cancel.");
    return;
  }

  await cancelActiveFarmEvent(farmEvent);
  await interaction.editReply(`Cancelled Farmer Pets event: **${farmEvent.name}**.`);
}

async function handlePostLeaderboardCommand(interaction, {
  flagsEphemeral,
  postWeeklyLeaderboardAndReset
}) {
  await interaction.deferReply({ flags: flagsEphemeral });
  await postWeeklyLeaderboardAndReset();
  await interaction.editReply("Weekly Farmer Pets leaderboard posted and weekly stats reset.");
}

async function handleHealthCommand(interaction, {
  config,
  flagsEphemeral,
  getActiveFarmEvent,
  uptime
}) {
  const farmEvent = getActiveFarmEvent();
  const lines = [
    "🩺 **Farmer Pets Bot Health**",
    "",
    `Uptime: **${formatDuration(Math.round(uptime() * 1000))}**`,
    `Active event: **${farmEvent ? farmEvent.name : "None"}**`,
    `Farm channel: **${config.FARM_CHANNEL || "Not configured"}**`,
    `Leaderboard channel: **${config.LEADERBOARD_CHANNEL || "Not configured"}**`,
    `Health port: **${formatPortStatus(config.HEALTH_PORT)}**`
  ];

  await interaction.reply({
    content: lines.join("\n"),
    flags: flagsEphemeral
  });
}

function buildEventStatusMessage(farmEvent, remainingMs) {
  const lines = [
    `🌾 **Farmer Pets Event Status**`,
    `Event: **${farmEvent.name}**`,
    `Time remaining: **${formatDuration(remainingMs)}**`,
    `Players: **${farmEvent.players?.size || 0}**`,
    `Helpers: **${farmEvent.helpers?.size || 0}**`
  ];

  if (farmEvent.isCommunity) {
    lines.push(
      `Community progress: **${farmEvent.communitySuccesses}/${farmEvent.communityGoal}**`,
      `Community bonus: **${farmEvent.communityBonus} $NKFE**`,
      `Goal announced: **${farmEvent.goalAnnounced ? "Yes" : "No"}**`,
      `Milestone awarded: **${farmEvent.milestoneAwarded ? "Yes" : "No"}**`
    );
  }

  return lines.join("\n");
}

function formatDuration(ms) {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

module.exports = {
  buildEventStatusMessage,
  createCommandHandlers,
  formatDuration
};
