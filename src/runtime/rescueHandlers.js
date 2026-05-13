const { logDiscordPermissionWarning } = require("../utils/discordErrors");

function createRescueHandlers({
  announceCommunityGoalReached,
  embedBuilders,
  ensurePlayer,
  flagsEphemeral,
  getActiveFarmEvent,
  getEventAnnouncementTarget,
  getFarmHelpBlockReason,
  getAssets = async () => ({ combinedAssets: [], utilityAssets: [] }),
  getRescueBlockReason,
  getRescueReward,
  getRewardBonus = () => ({ total: 0 }),
  getSuccessChance,
  analyzeAssets = () => ({}),
  analyzeUtilityAssets = () => ({}),
  getWallet,
  recordCommunitySuccess,
  recordFarmHelp,
  recordRescue,
  releaseRescueAttempt,
  reserveRescueAttempt,
  updateFarmEventMessage,
  logger = console,
  random = Math.random
}) {
  async function handleRescue(interaction) {
    await interaction.deferReply({ flags: flagsEphemeral });

    const farmEvent = getActiveFarmEvent();

    if (!farmEvent) {
      await interaction.editReply("No active farm emergency.");
      return;
    }

    let attemptRecorded = false;

    try {
      const wallet = await getWallet(interaction.user.id);

      if (!wallet) {
        await interaction.editReply("You must verify your wallet first using `/verify`.");
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const profile = await buildRescueProfile(wallet);
      const rescueBlockReason = getRescueBlockReason(farmEvent, interaction.user.id, Date.now(), profile);

      if (rescueBlockReason) {
        await interaction.editReply(rescueBlockReason);
        return;
      }

      reserveRescueAttempt(farmEvent, interaction.user.id);

      await ensurePlayer(interaction.user.id, wallet);

      const successChance = getSuccessChance(member, profile, farmEvent);
      const success = random() < successChance;
      const reward = getRescueReward(farmEvent, success, profile);
      const bonusBreakdown = success ? getRewardBonus(profile) : { total: 0 };

      const streak = await recordRescue(
        interaction.user.id,
        wallet,
        farmEvent.name,
        success,
        reward
      );

      if (success && recordCommunitySuccess(farmEvent, interaction.user.id, wallet)) {
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
        streak,
        bonusBreakdown
      });

      await interaction.editReply({
        embeds: [resultEmbed]
      });

      await announceEmbedToEventTarget(farmEvent, resultEmbed, "Failed to announce Farmer Pets rescue result:");
    } catch (error) {
      if (!attemptRecorded) {
        releaseRescueAttempt(farmEvent, interaction.user.id);
      }

      throw error;
    }
  }

  async function buildRescueProfile(wallet) {
    try {
      const assetData = await getAssets(wallet);
      return {
        ...analyzeAssets(assetData.combinedAssets || []),
        ...analyzeUtilityAssets([
          ...(assetData.combinedAssets || []),
          ...(assetData.utilityAssets || [])
        ])
      };
    } catch (error) {
      logger.warn?.(`Farmer Pets rescue NFT profile scan skipped: ${error.message}`);
      return {};
    }
  }

  async function handleFarmHelp(interaction) {
    await interaction.deferReply({ flags: flagsEphemeral });

    const farmEvent = getActiveFarmEvent();

    const helpBlockReason = getFarmHelpBlockReason(farmEvent, interaction.user.id);

    if (helpBlockReason) {
      await interaction.editReply(helpBlockReason);
      return;
    }

    const farmHelpWallet = await getWallet(interaction.user.id);

    if (!farmHelpWallet) {
      await interaction.editReply("You must verify your wallet first using `/verify`.");
      return;
    }

    if (!farmEvent.players?.has(interaction.user.id)) {
      await interaction.editReply("Try **Rescue Pet** first, then you can help the farm after your attempt.");
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

    await interaction.editReply({
      embeds: [helpEmbed]
    });

    await announceEmbedToEventTarget(farmEvent, helpEmbed, "Failed to announce Farmer Pets farmhand help:");
  }

  async function announceEmbedToEventTarget(farmEvent, embed, errorMessage) {
    try {
      const target = getEventAnnouncementTarget(farmEvent);

      if (target?.isTextBased()) {
        await target.send({ embeds: [embed] });
      }
    } catch (error) {
      if (!logDiscordPermissionWarning(logger, errorMessage, error)) {
        logger.error(errorMessage, error);
      }
    }
  }

  return { handleFarmHelp, handleRescue };
}

module.exports = { createRescueHandlers };
