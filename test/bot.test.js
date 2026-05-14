const assert = require("node:assert/strict");
const test = require("node:test");

const { createBotApp, getMissingRuntimeConfig } = require("../src/bot");

function createFakeClient() {
  const client = {
    events: [],
    destroyCalls: 0,
    loginCalls: [],
    sentMessages: [],
    channels: {
      fetchCalls: [],
      fetch: async channelId => {
        client.channels.fetchCalls.push(channelId);
        return {
          isTextBased: () => true,
          send: async message => client.sentMessages.push(message)
        };
      }
    },
    on(eventName, handler) {
      this.events.push(["on", eventName, handler]);
    },
    once(eventName, handler) {
      this.events.push(["once", eventName, handler]);
    },
    async destroy() {
      this.destroyCalls++;
    },
    login(token) {
      this.loginCalls.push(token);
      return Promise.resolve("logged-in");
    }
  };

  return client;
}

function createFakeProcess() {
  return {
    exitCodes: [],
    handlers: {},
    exit(code) {
      this.exitCodes.push(code);
    },
    once(signal, handler) {
      this.handlers[signal] = handler;
    }
  };
}

function createBotAppFixture({ config: configOverrides = {}, db: dbOverrides = {} } = {}) {
  const calls = [];
  const captures = {};
  const logs = [];
  const client = createFakeClient();
  const processLike = createFakeProcess();

  const app = createBotApp({
    client,
    config: {
      TOKEN: "discord-token",
      CLIENT_ID: "client-id",
      GUILD_ID: "guild-id",
      DATABASE_URL: "postgres://user:password@host/db",
      HEALTH_PORT: "8080",
      ENABLE_EVENT_THREADS: true,
      FARM_CHANNEL: "farm-channel",
      LEADERBOARD_CHANNEL: "leaderboard-channel",
      FARMER_VERIFIED_ROLE: "verified-role",
      FLAGS_EPHEMERAL: 64,
      ...configOverrides
    },
    commandDefinitions: [{ name: "fp-test" }],
    db: {
      awardCommunityMilestoneReward: async () => {},
      close: async () => calls.push(["db.close"]),
      ensurePlayer: async () => {},
      getPayoutRows: async () => [],
      getWallet: async () => "wallet.wam",
      initDatabase: async () => {},
      acquireInstanceLock: async () => true,
      recordRescue: async () => ({}),
      resetPayouts: async () => {},
      ...dbOverrides
    },
    eventService: {
      createFarmEvent: () => ({}),
      getEventThreadIntro: () => "intro",
      getEventThreadName: () => "thread",
      getFarmHelpBlockReason: () => null,
      getNextFarmEventDelay: () => 1,
      getRemainingEventMs: () => 1,
      getRescueBlockReason: () => null,
      getRescueReward: () => 1,
      markCommunityGoalAnnounced: () => {},
      markCommunityMilestoneAwarded: () => {},
      recordCommunitySuccess: () => false,
      recordFarmHelp: () => false,
      releaseRescueAttempt: () => {},
      reserveRescueAttempt: () => {},
      shouldAnnounceCommunityGoal: () => false,
      shouldAwardCommunityMilestone: () => false
    },
    roleService: {
      analyzeAssets: () => ({}),
      getSuccessChance: () => 1,
      syncRoles: async () => ({ added: [], removed: [] })
    },
    playerStatsService: {
      buildLeaderboardMessage: async () => "leaderboard",
      buildStatsPayload: async () => ({}),
      handleDailyCheckIn: async () => {},
      postWeeklyLeaderboardAndReset: async () => {}
    },
    assetService: { getAssets: async () => ({ combinedAssets: [] }) },
    ui: {
      buildRescueButtonRow: () => ({}),
      embedBuilders: {}
    },
    utils: { getEventAnnouncementTarget: () => null },
    processLike,
    logger: {
      error: (...args) => logs.push(["error", ...args]),
      log: (...args) => logs.push(["log", ...args])
    },
    runtimes: {
      createCommandHandlers: options => {
        captures.commandHandlerOptions = options;
        return { "fp-test": async () => {} };
      },
      createHealthServer: options => {
        captures.healthServerOptions = options;
        return {
          start: async port => calls.push(["health.start", port]),
          stop: async () => calls.push(["health.stop"])
        };
      },
      createFarmEventDiscordRuntime: options => {
        captures.farmEventOptions = options;
        return {
          announceCommunityGoalReached: async () => calls.push("announceGoal"),
          endFarmEvent: async farmEvent => calls.push(["endEvent", farmEvent.name]),
          scheduleEvent: () => calls.push("scheduleEvent"),
          startFarmEvent: async () => true,
          updateFarmEventMessage: async () => calls.push("updateEvent")
        };
      },
      createInteractionHandler: options => {
        captures.interactionHandlerOptions = options;
        return async () => {};
      },
      createRescueHandlers: options => {
        captures.rescueHandlerOptions = options;
        return {
          handleFarmHelp: async () => calls.push("farmHelp"),
          handleRescue: async () => calls.push("rescue")
        };
      },
      registerClientReadyHandler: options => {
        captures.readyHandlerOptions = options;
        options.client.once("clientReady", async () => {});
      }
    }
  });

  return { app, calls, captures, client, logs, processLike };
}



test("getMissingRuntimeConfig reports all missing deployment settings", () => {
  assert.deepEqual(getMissingRuntimeConfig({}), [
    "DISCORD_TOKEN",
    "CLIENT_ID",
    "GUILD_ID",
    "DATABASE_URL"
  ]);
});

test("startBot fails before registering handlers when deployment settings are missing", async () => {
  const { app, client } = createBotAppFixture({
    config: { TOKEN: undefined }
  });

  await assert.rejects(
    () => app.startBot(),
    /Missing required Farmer Pets configuration: DISCORD_TOKEN/
  );
  assert.deepEqual(client.loginCalls, []);
  assert.deepEqual(client.events, []);
});

test("createBotApp wires runtime dependencies and logs in with configured token", async () => {
  const { app, calls, captures, client, processLike } = createBotAppFixture();

  const loginResult = await app.startBot();

  assert.equal(loginResult, "logged-in");
  assert.deepEqual(client.loginCalls, ["discord-token"]);
  assert.deepEqual(calls, [["health.start", "8080"]]);
  assert.equal(captures.readyHandlerOptions.clientId, "client-id");
  assert.equal(captures.readyHandlerOptions.guildId, "guild-id");
  assert.deepEqual(captures.readyHandlerOptions.commands, [{ name: "fp-test" }]);
  assert.equal(typeof captures.readyHandlerOptions.acquireInstanceLock, "function");
  assert.equal(captures.farmEventOptions.farmChannelId, "farm-channel");
  assert.equal(captures.farmEventOptions.farmerVerifiedRoleId, "verified-role");
  assert.equal(captures.farmEventOptions.enableEventThreads, true);
  assert.equal(captures.healthServerOptions.getActiveFarmEvent(), null);
  assert.equal(captures.rescueHandlerOptions.flagsEphemeral, 64);
  assert.equal(captures.commandHandlerOptions.flagsEphemeral, 64);
  assert.equal(captures.interactionHandlerOptions.handleRescue, captures.commandHandlerOptions.handleRescue);
  assert.deepEqual(client.events.map(([method, eventName]) => [method, eventName]), [
    ["once", "clientReady"],
    ["on", "interactionCreate"]
  ]);
  assert.deepEqual(Object.keys(processLike.handlers).sort(), ["SIGINT", "SIGTERM"]);
});



test("cancelActiveFarmEvent ends active events, clears timers, and schedules the next event", async () => {
  const { app, calls, captures } = createBotAppFixture();
  const timeout = setTimeout(() => {}, 1000);
  const farmEvent = { name: "Pest Swarm", timeout };

  captures.farmEventOptions.setActiveFarmEvent(farmEvent);

  assert.equal(app.getActiveFarmEvent(), farmEvent);
  assert.equal(await app.cancelActiveFarmEvent(), true);
  assert.equal(farmEvent.timeout, null);
  assert.deepEqual(calls, [["endEvent", "Pest Swarm"], "scheduleEvent"]);

  assert.equal(await app.cancelActiveFarmEvent(null), false);
});

test("announceNewFarmerRoles sends role unlock messages to the configured leaderboard channel", async () => {
  const { app, client } = createBotAppFixture();

  await app.announceNewFarmerRoles(
    { displayName: "Alice" },
    "alice.wam",
    ["🥫 Pet Food Producer", "🚜 Working Farm"]
  );

  assert.deepEqual(client.channels.fetchCalls, ["leaderboard-channel"]);
  assert.match(client.sentMessages.at(-1), /Alice/);
  assert.match(client.sentMessages.at(-1), /alice\.wam/);
  assert.match(client.sentMessages.at(-1), /Pet Food Producer/);
  assert.match(client.sentMessages.at(-1), /Working Farm/);
});

test("announceNewFarmerRoles skips empty role updates", async () => {
  const { app, client } = createBotAppFixture();

  await app.announceNewFarmerRoles({ displayName: "Alice" }, "alice.wam", []);

  assert.deepEqual(client.channels.fetchCalls, []);
  assert.deepEqual(client.sentMessages, []);
});


test("stop destroys the Discord client and closes the database once", async () => {
  const { app, calls, client, logs } = createBotAppFixture();

  await app.stop({ signal: "SIGTERM" });
  await app.stop({ signal: "SIGINT" });

  assert.equal(client.destroyCalls, 1);
  assert.deepEqual(calls, [["health.stop"], ["db.close"]]);
  assert.deepEqual(logs, [
    ["log", "Received SIGTERM; shutting down Farmer Pets Bot."],
    ["log", "Farmer Pets Bot shutdown complete."]
  ]);
});

test("shutdown signal handler stops resources and exits cleanly", async () => {
  const { app, calls, client, processLike } = createBotAppFixture();

  app.registerShutdownHandlers();
  app.registerShutdownHandlers();

  assert.deepEqual(Object.keys(processLike.handlers).sort(), ["SIGINT", "SIGTERM"]);

  await processLike.handlers.SIGTERM();

  assert.equal(client.destroyCalls, 1);
  assert.deepEqual(calls, [["health.stop"], ["db.close"]]);
  assert.deepEqual(processLike.exitCodes, [0]);
});
