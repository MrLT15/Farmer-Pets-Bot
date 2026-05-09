const {
  COMMUNITY_BONUS_MAX,
  COMMUNITY_BONUS_MIN,
  COMMUNITY_EVENT_CHANCE,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_GOAL_MIN,
  COMMUNITY_HELPS_PER_PROGRESS,
  FARM_EVENT_DURATION_MS
} = require("../config");
const { randomInt } = require("../utils/random");

function createFarmEvent(now = Date.now()) {
  const roll = randomInt(1, 100);

  let name = "🐛 Pest Swarm";
  let rewardMin = 1;
  let rewardMax = 5;

  if (roll <= 5) {
    name = "🌾 Legendary Harvest Crisis";
    rewardMin = 10;
    rewardMax = 25;
  } else if (roll <= 25) {
    name = "⚠️ Rare Infestation";
    rewardMin = 5;
    rewardMax = 10;
  }

  const isCommunity = randomInt(1, 100) <= COMMUNITY_EVENT_CHANCE;

  if (isCommunity) {
    name = `🤝 Co-op ${name.replace(/^\S+\s*/, "")}`;
    rewardMin += 1;
    rewardMax += 2;
  }

  return {
    name,
    rewardMin,
    rewardMax,
    expires: now + FARM_EVENT_DURATION_MS,
    players: new Set(),
    helpers: new Set(),
    timeout: null,
    channel: null,
    message: null,
    thread: null,
    isCommunity,
    communityGoal: isCommunity ? randomInt(COMMUNITY_GOAL_MIN, COMMUNITY_GOAL_MAX) : 0,
    communitySuccesses: 0,
    communityHelps: 0,
    communityBonus: isCommunity ? randomInt(COMMUNITY_BONUS_MIN, COMMUNITY_BONUS_MAX) : 0,
    goalAnnounced: false,
    milestoneAwarded: false
  };
}

function getNextFarmEventDelay() {
  return randomInt(
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000
  );
}

function getRemainingEventMs(farmEvent, now = Date.now()) {
  return Math.max(farmEvent.expires - now, 0);
}

function getEventThreadName(farmEvent) {
  return farmEvent.isCommunity
    ? `🤝 ${farmEvent.name}`
    : `🌾 ${farmEvent.name}`;
}

function getEventThreadIntro(farmEvent) {
  return farmEvent.isCommunity
    ? "🤝 Use this thread to coordinate the co-op rescue and cheer farmers on!"
    : "🌾 Rescue discussion thread is open for this farm event.";
}

function getRescueBlockReason(farmEvent, userId, now = Date.now()) {
  if (!farmEvent) return "No active farm emergency.";
  if (now > farmEvent.expires) return "This farm emergency has already ended.";
  if (farmEvent.players.has(userId)) return "You already attempted this rescue.";

  return null;
}

function reserveRescueAttempt(farmEvent, userId) {
  farmEvent.players.add(userId);
}

function releaseRescueAttempt(farmEvent, userId) {
  farmEvent.players.delete(userId);
}

function getRescueReward(farmEvent, success) {
  return success ? randomInt(farmEvent.rewardMin, farmEvent.rewardMax) : 0;
}

function recordCommunitySuccess(farmEvent) {
  if (!farmEvent.isCommunity) return false;

  farmEvent.communitySuccesses++;
  return true;
}

function getFarmHelpBlockReason(farmEvent, userId, now = Date.now()) {
  if (!farmEvent) return "No active farm emergency.";
  if (now > farmEvent.expires) return "This farm emergency has already ended.";
  if (farmEvent.helpers.has(userId)) return "You already helped the farm during this event.";

  return null;
}

function recordFarmHelp(farmEvent, userId) {
  farmEvent.helpers.add(userId);

  if (!farmEvent.isCommunity) return false;

  farmEvent.communityHelps++;

  if (
    farmEvent.communityHelps % COMMUNITY_HELPS_PER_PROGRESS === 0 &&
    farmEvent.communitySuccesses < farmEvent.communityGoal
  ) {
    farmEvent.communitySuccesses++;
    return true;
  }

  return false;
}

function shouldAnnounceCommunityGoal(farmEvent) {
  return Boolean(
    farmEvent.isCommunity &&
    !farmEvent.goalAnnounced &&
    farmEvent.communitySuccesses >= farmEvent.communityGoal
  );
}

function markCommunityGoalAnnounced(farmEvent) {
  farmEvent.goalAnnounced = true;
}

function shouldAwardCommunityMilestone(farmEvent) {
  return Boolean(
    farmEvent.isCommunity &&
    !farmEvent.milestoneAwarded &&
    farmEvent.communitySuccesses >= farmEvent.communityGoal
  );
}

function markCommunityMilestoneAwarded(farmEvent) {
  farmEvent.milestoneAwarded = true;
}

module.exports = {
  createFarmEvent,
  getEventThreadIntro,
  getEventThreadName,
  getFarmHelpBlockReason,
  getNextFarmEventDelay,
  getRemainingEventMs,
  getRescueBlockReason,
  getRescueReward,
  markCommunityGoalAnnounced,
  markCommunityMilestoneAwarded,
  recordCommunitySuccess,
  recordFarmHelp,
  releaseRescueAttempt,
  reserveRescueAttempt,
  shouldAnnounceCommunityGoal,
  shouldAwardCommunityMilestone
};
