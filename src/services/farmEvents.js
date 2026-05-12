const {
  COMMUNITY_BONUS_MAX,
  COMMUNITY_BONUS_MIN,
  COMMUNITY_EVENT_CHANCE,
  COMMUNITY_EVENT_DURATION_MS,
  COMMUNITY_GOAL_MAX,
  COMMUNITY_GOAL_MIN,
  COMMUNITY_HELPS_PER_PROGRESS,
  FARM_EVENT_DURATION_MS
} = require("../config");
const { randomInt } = require("../utils/random");
const { getCurrentSeason, getSummerBoostResource } = require("./seasons");
const { getMaxRescueAttempts } = require("./utilityProfile");

function createFarmEvent(now = Date.now(), { random = Math.random, hasCatBoost = false } = {}) {
  const roll = randomInt(1, 100);
  const catUpgrade = hasCatBoost && random() < 0.05;

  let name = "🐛 Pest Swarm";
  let rewardMin = 1;
  let rewardMax = 5;

  if (roll <= 5) {
    name = "🌾 Legendary Harvest Crisis";
    rewardMin = 10;
    rewardMax = 25;
  } else if (roll <= 25 || catUpgrade) {
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

  return createBaseEvent({
    name,
    rewardMin,
    rewardMax,
    expires: now + FARM_EVENT_DURATION_MS,
    type: "normal",
    isCommunity,
    season: getCurrentSeason(new Date(now)),
    summerBoostResource: getSummerBoostResource(random),
    communityGoal: isCommunity ? randomInt(COMMUNITY_GOAL_MIN, COMMUNITY_GOAL_MAX) : 0,
    communityBonus: isCommunity ? randomInt(COMMUNITY_BONUS_MIN, COMMUNITY_BONUS_MAX) : 0
  });
}

function createCommanderCommunityEvent({ starterId, starterName, now = Date.now(), random = Math.random } = {}) {
  return createBaseEvent({
    name: "🤝 Commander-Led Farm Rescue",
    rewardMin: 0,
    rewardMax: 0,
    expires: now + COMMUNITY_EVENT_DURATION_MS,
    type: "community",
    isCommunity: true,
    season: getCurrentSeason(new Date(now)),
    summerBoostResource: getSummerBoostResource(random),
    communityGoal: 0,
    communityBonus: 0,
    commanderStarterId: starterId,
    commanderStarterName: starterName || "Commander",
    successfulRescuers: new Map(),
    communityPoolBase: 50,
    communityPoolPerParticipant: 5,
    communityPoolMax: 200
  });
}

function createBaseEvent(overrides) {
  return {
    players: new Map(),
    helpers: new Set(),
    timeout: null,
    channel: null,
    message: null,
    thread: null,
    communitySuccesses: 0,
    communityHelps: 0,
    goalAnnounced: false,
    milestoneAwarded: false,
    ...overrides
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
  if (farmEvent.type === "community") {
    return "🤝 Commander community rescue is live. Coordinate rescues and bring the farm home together!";
  }

  return farmEvent.isCommunity
    ? "🤝 Use this thread to coordinate the co-op rescue and cheer farmers on!"
    : "🌾 Rescue discussion thread is open for this farm event.";
}

function getRescueBlockReason(farmEvent, userId, now = Date.now(), profile = {}) {
  if (!farmEvent) return "No active farm emergency.";

  const hasBunnyGrace = profile.companions?.bunny > 0 && now <= farmEvent.expires + 60_000;
  if (now > farmEvent.expires && !hasBunnyGrace) return "This farm emergency has already ended.";

  const attemptsUsed = getRescueAttemptsUsed(farmEvent, userId);
  const maxAttempts = getMaxRescueAttempts(profile);
  if (attemptsUsed >= maxAttempts) return "You already attempted this rescue.";

  return null;
}

function getRescueAttemptsUsed(farmEvent, userId) {
  if (farmEvent.players instanceof Map) return farmEvent.players.get(userId) || 0;
  return farmEvent.players?.has(userId) ? 1 : 0;
}

function hasRescueAttempt(farmEvent, userId) {
  return getRescueAttemptsUsed(farmEvent, userId) > 0;
}

function reserveRescueAttempt(farmEvent, userId) {
  if (!(farmEvent.players instanceof Map)) {
    farmEvent.players = new Map([...farmEvent.players || []].map(id => [id, 1]));
  }

  farmEvent.players.set(userId, getRescueAttemptsUsed(farmEvent, userId) + 1);
}

function releaseRescueAttempt(farmEvent, userId) {
  const attempts = getRescueAttemptsUsed(farmEvent, userId);

  if (attempts <= 1) {
    farmEvent.players.delete(userId);
    return;
  }

  farmEvent.players.set(userId, attempts - 1);
}

function getRescueReward(farmEvent, success, profile = {}) {
  if (!success || farmEvent.type === "community") return 0;

  const baseReward = randomInt(farmEvent.rewardMin, farmEvent.rewardMax);
  const ndvBonus = profile.largeNdv > 0 ? 2 : profile.ndv > 0 ? 1 : 0;
  const parrotBonus = profile.companions?.parrot > 0 ? 1 : 0;

  return baseReward + ndvBonus + parrotBonus;
}

function recordCommunitySuccess(farmEvent, userId, wallet) {
  if (!farmEvent.isCommunity) return false;

  farmEvent.communitySuccesses++;

  if (farmEvent.type === "community" && userId && wallet) {
    farmEvent.successfulRescuers.set(userId, wallet);
  }

  return true;
}

function getCommunityEventPool(farmEvent) {
  const participants = farmEvent.players?.size || 0;
  const base = farmEvent.communityPoolBase || 50;
  const perParticipant = farmEvent.communityPoolPerParticipant || 5;
  const max = farmEvent.communityPoolMax || 200;

  return Math.min(base + participants * perParticipant, max);
}

function getSharedCommunityPayout(farmEvent) {
  const successCount = farmEvent.successfulRescuers?.size || 0;
  if (!successCount) return 0;

  return Math.floor(getCommunityEventPool(farmEvent) / successCount);
}

function getFarmHelpBlockReason(farmEvent, userId, now = Date.now()) {
  if (!farmEvent) return "No active farm emergency.";
  if (now > farmEvent.expires) return "This farm emergency has already ended.";
  if (farmEvent.helpers.has(userId)) return "You already helped the farm during this event.";

  return null;
}

function recordFarmHelp(farmEvent, userId) {
  farmEvent.helpers.add(userId);

  if (!farmEvent.isCommunity || farmEvent.type === "community") return false;

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
    farmEvent.type !== "community" &&
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
    farmEvent.type !== "community" &&
    farmEvent.isCommunity &&
    !farmEvent.milestoneAwarded &&
    farmEvent.communitySuccesses >= farmEvent.communityGoal
  );
}

function markCommunityMilestoneAwarded(farmEvent) {
  farmEvent.milestoneAwarded = true;
}

module.exports = {
  createCommanderCommunityEvent,
  createFarmEvent,
  getCommunityEventPool,
  getEventThreadIntro,
  getEventThreadName,
  getFarmHelpBlockReason,
  getNextFarmEventDelay,
  getRemainingEventMs,
  getRescueAttemptsUsed,
  getRescueBlockReason,
  getRescueReward,
  getSharedCommunityPayout,
  hasRescueAttempt,
  markCommunityGoalAnnounced,
  markCommunityMilestoneAwarded,
  recordCommunitySuccess,
  recordFarmHelp,
  releaseRescueAttempt,
  reserveRescueAttempt,
  shouldAnnounceCommunityGoal,
  shouldAwardCommunityMilestone
};
