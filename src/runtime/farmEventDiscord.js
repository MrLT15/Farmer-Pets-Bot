const { logDiscordPermissionWarning } = require("../utils/discordErrors");

function createFarmEventDiscordRuntime({
  client,
  farmChannelId,
  farmerVerifiedRoleId,
  enableEventThreads = true,
  awardCommunityMilestoneReward,
  buildRescueButtonRow,
  createFarmEvent,
  embedBuilders,
  getActiveFarmEvent,
  getEventAnnouncementTarget,
  getEventThreadIntro,
  getEventThreadName,
  getNextFarmEventDelay,
  getRemainingEventMs,
  markCommunityGoalAnnounced,
  markCommunityMilestoneAwarded,
  setActiveFarmEvent,
  shouldAnnounceCommunityGoal,
  shouldAwardCommunityMilestone,
  logger = console,
  setTimeoutFn = setTimeout
}) {
  function warnDiscordPermission(message, error) {
    return logDiscordPermissionWarning(logger, message, error);
  }

  async function sendEmbedToEventTarget(farmEvent, embed, errorMessage) {
    try {
      const target = getEventAnnouncementTarget(farmEvent);

      if (target?.isTextBased()) {
        await target.send({ embeds: [embed] });
      }
    } catch (error) {
      if (!warnDiscordPermission(errorMessage, error)) {
        logger.error(errorMessage, error);
      }
    }
  }

  async function createEventThread(message, farmEvent) {
    try {
      if (!enableEventThreads || !message?.startThread) return null;

      return await message.startThread({
        name: getEventThreadName(farmEvent),
        autoArchiveDuration: 60,
        reason: "Farmer Pets event thread"
      });
    } catch (error) {
      if (!warnDiscordPermission("Could not create Farmer Pets event thread.", error)) {
        logger.error("Failed to create Farmer Pets event thread:", error);
      }
      return null;
    }
  }

  async function updateFarmEventMessage(farmEvent) {
    try {
      if (!farmEvent.message?.editable) return;

      await farmEvent.message.edit({
        content: `<@&${farmerVerifiedRoleId}>`,
        embeds: [embedBuilders.buildFarmEventEmbed(farmEvent)],
        components: [buildRescueButtonRow()]
      });
    } catch (error) {
      logger.error("Failed to update Farmer Pets event message:", error);
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
      logger.error("Failed to close Farmer Pets event message:", error);
    }
  }

  async function announceCommunityGoalReached(farmEvent) {
    if (!shouldAnnounceCommunityGoal(farmEvent)) return;

    markCommunityGoalAnnounced(farmEvent);

    await sendEmbedToEventTarget(
      farmEvent,
      embedBuilders.buildCommunityGoalReachedEmbed(farmEvent),
      "Could not announce Farmer Pets community goal."
    );
  }

  async function endFarmEvent(farmEvent) {
    if (getActiveFarmEvent() === farmEvent) {
      setActiveFarmEvent(null);
    }

    await closeFarmEventMessage(farmEvent);

    if (!farmEvent.isCommunity) return;

    let rewardedCount = 0;

    if (shouldAwardCommunityMilestone(farmEvent)) {
      markCommunityMilestoneAwarded(farmEvent);
      rewardedCount = await awardCommunityMilestoneReward(
        [...farmEvent.players],
        farmEvent.communityBonus
      );
    }

    await sendEmbedToEventTarget(
      farmEvent,
      embedBuilders.buildCommunityEventEndEmbed(farmEvent, rewardedCount),
      "Could not announce Farmer Pets community event end."
    );
  }

  async function startFarmEvent() {
    if (getActiveFarmEvent()) return false;

    const farmEvent = createFarmEvent();

    setActiveFarmEvent(farmEvent);

    try {
      const channel = await client.channels.fetch(farmChannelId);

      if (!channel?.isTextBased()) {
        throw new Error(`Farm channel ${farmChannelId} is not a text channel.`);
      }

      const pingRole = `<@&${farmerVerifiedRoleId}>`;

      farmEvent.channel = channel;
      farmEvent.message = await channel.send({
        content: pingRole,
        embeds: [embedBuilders.buildFarmEventEmbed(farmEvent)],
        components: [buildRescueButtonRow()]
      });
      farmEvent.thread = await createEventThread(farmEvent.message, farmEvent);

      if (farmEvent.thread?.isTextBased()) {
        try {
          await farmEvent.thread.send(getEventThreadIntro(farmEvent));
        } catch (error) {
          if (!warnDiscordPermission("Could not send Farmer Pets event thread intro.", error)) {
            logger.error("Failed to send Farmer Pets event thread intro:", error);
          }
        }
      }

      farmEvent.timeout = setTimeoutFn(() => {
        endFarmEvent(farmEvent)
          .catch(error => logger.error("Failed to end Farmer Pets event:", error))
          .finally(() => scheduleEvent());
      }, getRemainingEventMs(farmEvent));

      return true;
    } catch (error) {
      if (getActiveFarmEvent() === farmEvent) {
        setActiveFarmEvent(null);
      }

      throw error;
    }
  }

  function scheduleEvent() {
    const delay = getNextFarmEventDelay();

    logger.log(`Next Farmer Pets event in ${Math.round(delay / 60000)} minutes.`);

    setTimeoutFn(() => {
      startFarmEvent().catch(error => {
        logger.error("Failed to start scheduled Farmer Pets event:", error);
        scheduleEvent();
      });
    }, delay);
  }

  return {
    announceCommunityGoalReached,
    closeFarmEventMessage,
    createEventThread,
    endFarmEvent,
    scheduleEvent,
    startFarmEvent,
    updateFarmEventMessage
  };
}

module.exports = { createFarmEventDiscordRuntime };
