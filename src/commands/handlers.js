function createCommandHandlers({
  announceNewFarmerRoles,
  analyzeAssets,
  buildLeaderboardMessage,
  buildStatsPayload,
  cancelActiveFarmEvent,
  config = {},
  flagsEphemeral,
  getAssets,
  getPayoutRows,
  getWallet,
  getActiveFarmEvent,
  getRemainingEventMs = farmEvent => Math.max((farmEvent?.expires || Date.now()) - Date.now(), 0),
  handleDailyCheckIn,
  handleRescue,
  postWeeklyLeaderboardAndReset,
  resetPayouts,
  startFarmEvent,
  syncRoles,
  uptime = () => process.uptime()
}) {
  return {
    "fp-rescue": handleRescue,
    "fp-roles": interaction => handleRolesCommand(interaction, {
      announceNewFarmerRoles,
      analyzeAssets,
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
    "fp-payouts": interaction => handlePayoutsCommand(interaction, {
      flagsEphemeral,
      getPayoutRows
    }),
    "fp-resetpayouts": interaction => handleResetPayoutsCommand(interaction, {
      flagsEphemeral,
      resetPayouts
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
  const message = await buildLeaderboardMessage();

  await interaction.reply({
    content: message
  });
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
    `${row.wallet} — **${row.payout_nkfe} $NKFE** — <@${row.discord_id}>`
  );

  await interaction.reply({
    content:
      "💰 **Farmer Pets Manual Payout List**\n\n" +
      lines.join("\n") +
      "\n\nAfter manual payment, run `/fp-resetpayouts`.",
    flags: flagsEphemeral
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
    `Health port: **${config.HEALTH_PORT || "Disabled"}**`
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
