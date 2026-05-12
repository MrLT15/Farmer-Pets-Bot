const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createFarmEvent,
  getEventThreadIntro,
  getEventThreadName,
  getFarmHelpBlockReason,
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
} = require("../src/services/farmEvents");
const {
  COMMUNITY_HELPS_PER_PROGRESS,
  FARM_EVENT_DURATION_MINUTES,
  FARM_EVENT_DURATION_MS
} = require("../src/config");

function makeEvent(overrides = {}) {
  return {
    name: "🐛 Pest Swarm",
    rewardMin: 1,
    rewardMax: 5,
    expires: 1_000,
    players: new Set(),
    helpers: new Set(),
    isCommunity: false,
    communityGoal: 0,
    communitySuccesses: 0,
    communityHelps: 0,
    communityBonus: 0,
    goalAnnounced: false,
    milestoneAwarded: false,
    ...overrides
  };
}

test("createFarmEvent returns initialized event state", () => {
  const now = 10_000;
  const farmEvent = createFarmEvent(now);

  assert.equal(FARM_EVENT_DURATION_MINUTES, 5);
  assert.equal(FARM_EVENT_DURATION_MS, 5 * 60 * 1000);
  assert.equal(farmEvent.expires, now + FARM_EVENT_DURATION_MS);
  assert.ok(farmEvent.players instanceof Map);
  assert.ok(farmEvent.helpers instanceof Set);
  assert.equal(farmEvent.players.size, 0);
  assert.equal(farmEvent.helpers.size, 0);
  assert.equal(farmEvent.goalAnnounced, false);
  assert.equal(farmEvent.milestoneAwarded, false);
  assert.equal(getRemainingEventMs(farmEvent, now), FARM_EVENT_DURATION_MS);
});

test("rescue validation blocks missing, expired, and duplicate attempts", () => {
  assert.equal(getRescueBlockReason(null, "user"), "No active farm emergency.");

  const expired = makeEvent({ expires: 100 });
  assert.equal(getRescueBlockReason(expired, "user", 101), "This farm emergency has already ended.");

  const attempted = makeEvent();
  reserveRescueAttempt(attempted, "user");
  assert.equal(getRescueBlockReason(attempted, "user", 999), "You already attempted this rescue.");

  releaseRescueAttempt(attempted, "user");
  assert.equal(getRescueBlockReason(attempted, "user", 999), null);
});

test("thread labels and intros reflect community state", () => {
  const solo = makeEvent({ name: "Solo Rescue", isCommunity: false });
  const community = makeEvent({ name: "Co-op Rescue", isCommunity: true });

  assert.equal(getEventThreadName(solo), "🌾 Solo Rescue");
  assert.equal(getEventThreadName(community), "🤝 Co-op Rescue");
  assert.match(getEventThreadIntro(solo), /Rescue discussion thread/);
  assert.match(getEventThreadIntro(community), /coordinate the co-op rescue/);
});

test("rescue rewards are zero on failure and in event range on success", () => {
  const farmEvent = makeEvent({ rewardMin: 2, rewardMax: 4 });

  assert.equal(getRescueReward(farmEvent, false), 0);

  for (let index = 0; index < 20; index++) {
    const reward = getRescueReward(farmEvent, true);
    assert.ok(reward >= 2 && reward <= 4, `reward ${reward} should be in range`);
  }
});

test("community progress and milestone state transitions are explicit", () => {
  const community = makeEvent({ isCommunity: true, communityGoal: 2 });
  const solo = makeEvent({ isCommunity: false });

  assert.equal(recordCommunitySuccess(solo), false);
  assert.equal(recordCommunitySuccess(community), true);
  assert.equal(community.communitySuccesses, 1);
  assert.equal(shouldAnnounceCommunityGoal(community), false);

  recordCommunitySuccess(community);
  assert.equal(shouldAnnounceCommunityGoal(community), true);
  markCommunityGoalAnnounced(community);
  assert.equal(shouldAnnounceCommunityGoal(community), false);

  assert.equal(shouldAwardCommunityMilestone(community), true);
  markCommunityMilestoneAwarded(community);
  assert.equal(shouldAwardCommunityMilestone(community), false);
});

test("farm help tracks helpers and adds progress at configured interval", () => {
  const community = makeEvent({ isCommunity: true, communityGoal: 10 });

  assert.equal(getFarmHelpBlockReason(null, "helper"), "No active farm emergency.");
  assert.equal(getFarmHelpBlockReason(makeEvent({ expires: 100 }), "helper", 101), "This farm emergency has already ended.");

  let progressAdded = false;
  for (let index = 1; index <= COMMUNITY_HELPS_PER_PROGRESS; index++) {
    progressAdded = recordFarmHelp(community, `helper-${index}`);
  }

  assert.equal(community.helpers.size, COMMUNITY_HELPS_PER_PROGRESS);
  assert.equal(community.communityHelps, COMMUNITY_HELPS_PER_PROGRESS);
  assert.equal(progressAdded, true);
  assert.equal(community.communitySuccesses, 1);
  assert.equal(getFarmHelpBlockReason(community, "helper-1", 999), "You already helped the farm during this event.");
});
