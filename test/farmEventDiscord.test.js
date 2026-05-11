const assert = require("node:assert/strict");
const test = require("node:test");

const { createFarmEventDiscordRuntime } = require("../src/runtime/farmEventDiscord");

function createRuntime(overrides = {}) {
  const calls = [];
  const warnings = [];
  let activeFarmEvent = null;
  const farmEvent = {
    name: "Pest Swarm",
    players: new Set(),
    isCommunity: true,
    communityBonus: 2,
    message: { editable: false },
    thread: null,
    channel: null
  };

  const runtime = createFarmEventDiscordRuntime({
    client: {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async payload => {
            calls.push(["channel.send", payload]);
            return {
              editable: true,
              startThread: async options => {
                calls.push(["startThread", options]);
                return {
                  isTextBased: () => true,
                  send: async content => calls.push(["thread.send", content])
                };
              }
            };
          }
        })
      }
    },
    farmChannelId: "farm-channel",
    farmerVerifiedRoleId: "verified-role",
    awardCommunityMilestoneReward: async players => {
      calls.push(["award", players]);
      return players.length;
    },
    buildRescueButtonRow: disabled => ({ disabled: Boolean(disabled) }),
    createFarmEvent: () => farmEvent,
    embedBuilders: {
      buildFarmEventEmbed: event => ({ type: "event", name: event.name }),
      buildCommunityGoalReachedEmbed: event => ({ type: "goal", name: event.name }),
      buildCommunityEventEndEmbed: (event, rewardedCount) => ({
        type: "end",
        name: event.name,
        rewardedCount
      })
    },
    getActiveFarmEvent: () => activeFarmEvent,
    getEventAnnouncementTarget: event => event.thread || event.channel,
    getEventThreadIntro: event => `intro ${event.name}`,
    getEventThreadName: event => `thread ${event.name}`,
    getNextFarmEventDelay: () => 1_000,
    getRemainingEventMs: () => 1_000,
    markCommunityGoalAnnounced: event => {
      event.goalAnnounced = true;
    },
    markCommunityMilestoneAwarded: event => {
      event.milestoneAwarded = true;
    },
    setActiveFarmEvent: event => {
      activeFarmEvent = event;
    },
    shouldAnnounceCommunityGoal: () => true,
    shouldAwardCommunityMilestone: () => false,
    logger: {
      log: (...args) => calls.push(["log", ...args]),
      warn: (...args) => warnings.push(args),
      error: (...args) => calls.push(["error", ...args])
    },
    setTimeoutFn: (callback, ms) => {
      calls.push(["timeout", ms]);
      return { callback, ms };
    },
    ...overrides
  });

  return { calls, farmEvent, runtime, warnings };
}

test("startFarmEvent can disable event thread creation", async () => {
  const { calls, farmEvent, runtime } = createRuntime({ enableEventThreads: false });

  assert.equal(await runtime.startFarmEvent(), true);

  assert.equal(farmEvent.thread, null);
  assert.equal(calls.some(([name]) => name === "startThread"), false);
  assert.equal(calls.some(([name]) => name === "thread.send"), false);
});

test("createEventThread logs Discord permission failures as concise warnings", async () => {
  const { calls, runtime, warnings } = createRuntime();
  const message = {
    startThread: async () => {
      const error = new Error("Missing Access");
      error.code = 50001;
      throw error;
    }
  };

  const thread = await runtime.createEventThread(message, { name: "Pest Swarm" });

  assert.equal(thread, null);
  assert.equal(calls.some(([name]) => name === "error"), false);
  assert.match(warnings[0][0], /Could not create Farmer Pets event thread/);
  assert.match(warnings[0][0], /Missing Access/);
});

test("community announcements swallow Discord permission failures with warnings", async () => {
  const target = {
    isTextBased: () => true,
    send: async () => {
      const error = new Error("Missing Permissions");
      error.code = 50013;
      throw error;
    }
  };
  const { calls, farmEvent, runtime, warnings } = createRuntime({
    getEventAnnouncementTarget: () => target
  });

  await runtime.announceCommunityGoalReached(farmEvent);

  assert.equal(farmEvent.goalAnnounced, true);
  assert.equal(calls.some(([name]) => name === "error"), false);
  assert.match(warnings[0][0], /community goal/);
  assert.match(warnings[0][0], /Missing Permissions/);
});
