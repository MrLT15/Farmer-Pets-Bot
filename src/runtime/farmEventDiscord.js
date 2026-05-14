const { logDiscordPermissionWarning } = require("../utils/discordErrors");
const { getSharedCommunityPayout } = require("../services/farmEvents");

function createFarmEventDiscordRuntime({
  client,
  farmChannelId,
  farmerVerifiedRoleId,
  enableEventThreads = true,
  enableVerifiedMemberDms = true,
  awardCommunityEventPayouts = async () => 0,
  awardCommunityMilestoneReward,
  buildRescueButtonRow,
  createFarmEvent,
  createCommanderCommunityEvent,
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

  async function dmVerifiedMembers(farmEvent) {
    if (!enableVerifiedMemberDms || !farmEvent.message?.guild) return 0;

    try {
      const guild = farmEvent.message.guild;
      const members = await guild.members.fetch();
      const verifiedMembers = [...members.values()].filter(member =>
        !member.user?.bot && member.roles?.cache?.has(farmerVerifiedRoleId)
      );
      const message =
        `🐾 A new Farmer Pets rescue is available: **${farmEvent.name}**. ` +
        `Head to <#${farmChannelId}> to help before it expires!`;
      let sentCount = 0;

      for (const member of verifiedMembers) {
        try {
          await member.send(message);
          sentCount += 1;
        } catch (error) {
          warnDiscordPermission(`Could not DM verified Farmer Pets member ${member.id}.`, error);
        }
      }

      return sentCount;
    } catch (error) {
      if (!warnDiscordPermission("Could not fetch verified Farmer Pets members for event DMs.", error)) {
        logger.error("Failed to DM verified Farmer Pets members:", error);
      }
      return 0;
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

    if (farmEvent.type === "community") {
      const payout = getSharedCommunityPayout(farmEvent);
      const entries = [...(farmEvent.successfulRescuers || new Map()).entries()]
        .map(([discordId, wallet]) => ({ discordId, wallet }));

      rewardedCount = await awardCommunityEventPayouts(entries, payout, farmEvent.name);

      await sendEmbedToEventTarget(
        farmEvent,
        embedBuilders.buildCommunityEventEndEmbed(farmEvent, rewardedCount),
        "Could not announce Farmer Pets community event end."
      );
      return;
    }

    if (shouldAwardCommunityMilestone(farmEvent)) {
      markCommunityMilestoneAwarded(farmEvent);
      rewardedCount = await awardCommunityMilestoneReward(
        [...farmEvent.players.keys()],
        farmEvent.communityBonus
      );
    }

    await sendEmbedToEventTarget(
      farmEvent,
      embedBuilders.buildCommunityEventEndEmbed(farmEvent, rewardedCount),
      "Could not announce Farmer Pets community event end."
    );
  }

  async function startCommunityFarmEvent(starter) {
    if (getActiveFarmEvent()) return false;

    const farmEvent = createCommanderCommunityEvent(starter);
    return startPreparedFarmEvent(farmEvent);
  }

  async function startFarmEvent() {
    if (getActiveFarmEvent()) return false;

    const farmEvent = createFarmEvent();

    return startPreparedFarmEvent(farmEvent);
  }

  async function startPreparedFarmEvent(farmEvent) {
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
      dmVerifiedMembers(farmEvent)
        .catch(error => logger.error("Failed to send Farmer Pets event DMs:", error));

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
    dmVerifiedMembers,
    endFarmEvent,
    scheduleEvent,
    startCommunityFarmEvent,
    startFarmEvent,
    updateFarmEventMessage
  };
}

module.exports = { createFarmEventDiscordRuntime };
