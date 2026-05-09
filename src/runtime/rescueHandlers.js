const { logDiscordPermissionWarning } = require("../utils/discordErrors");

function createRescueHandlers({
  announceCommunityGoalReached,
  embedBuilders,
  ensurePlayer,
  flagsEphemeral,
  getActiveFarmEvent,
  getEventAnnouncementTarget,
  getFarmHelpBlockReason,
  getRescueBlockReason,
  getRescueReward,
  getSuccessChance,
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
    const farmEvent = getActiveFarmEvent();

    const rescueBlockReason = getRescueBlockReason(farmEvent, interaction.user.id);

    if (rescueBlockReason) {
      await interaction.reply({
        content: rescueBlockReason,
        flags: flagsEphemeral
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
          flags: flagsEphemeral
        });
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      await ensurePlayer(interaction.user.id, wallet);

      const successChance = getSuccessChance(member);
      const success = random() < successChance;
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
        flags: flagsEphemeral
      });

      await announceEmbedToEventTarget(farmEvent, resultEmbed, "Failed to announce Farmer Pets rescue result:");
    } catch (error) {
      if (!attemptRecorded) {
        releaseRescueAttempt(farmEvent, interaction.user.id);
      }

      throw error;
    }
  }

  async function handleFarmHelp(interaction) {
    const farmEvent = getActiveFarmEvent();

    const helpBlockReason = getFarmHelpBlockReason(farmEvent, interaction.user.id);

    if (helpBlockReason) {
      await interaction.reply({
        content: helpBlockReason,
        flags: flagsEphemeral
      });
      return;
    }

    const farmHelpWallet = await getWallet(interaction.user.id);

    if (!farmHelpWallet) {
      await interaction.reply({
        content: "You must verify your wallet first using `/verify`.",
        flags: flagsEphemeral
      });
      return;
    }

    if (!farmEvent.players.has(interaction.user.id)) {
      await interaction.reply({
        content: "Try **Rescue Pet** first, then you can help the farm after your attempt.",
        flags: flagsEphemeral
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
      flags: flagsEphemeral
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
