const assert = require("node:assert/strict");
const test = require("node:test");

const { createRescueHandlers } = require("../src/runtime/rescueHandlers");

const FLAGS_EPHEMERAL = 64;

function createInteraction({ userId = "farmer", displayName = "Helpful Farmer" } = {}) {
  const member = { displayName };
  const interaction = {
    user: { id: userId },
    guild: {
      members: {
        fetchCalls: [],
        fetch: async id => {
          interaction.guild.members.fetchCalls.push(id);
          return member;
        }
      }
    },
    deferReplyPayload: null,
    editReplyPayloads: [],
    replyPayloads: [],
    deferReply: async payload => {
      interaction.deferReplyPayload = payload;
    },
    editReply: async payload => {
      interaction.editReplyPayloads.push(payload);
    },
    reply: async payload => {
      interaction.replyPayloads.push(payload);
    }
  };

  return interaction;
}

function createFarmEvent(overrides = {}) {
  return {
    name: "Farm Rescue",
    players: new Set(),
    helpers: new Set(),
    isCommunity: false,
    ...overrides
  };
}

function createHandlers(overrides = {}) {
  const calls = [];
  const state = {
    farmEvent: createFarmEvent(),
    calls
  };

  const handlers = createRescueHandlers({
    announceCommunityGoalReached: async farmEvent => calls.push(["announceGoal", farmEvent.name]),
    embedBuilders: {
      buildRescueResultEmbed: payload => ({ type: "rescue", payload }),
      buildFarmHelpEmbed: payload => ({ type: "help", payload })
    },
    ensurePlayer: async (discordId, wallet) => calls.push(["ensurePlayer", discordId, wallet]),
    flagsEphemeral: FLAGS_EPHEMERAL,
    getActiveFarmEvent: () => state.farmEvent,
    getEventAnnouncementTarget: farmEvent => farmEvent.target,
    getFarmHelpBlockReason: () => null,
    getRescueBlockReason: () => null,
    getRescueReward: (farmEvent, success) => success ? 4 : 0,
    getSuccessChance: () => 1,
    getWallet: async () => "wallet.wam",
    recordCommunitySuccess: () => false,
    recordFarmHelp: (farmEvent, userId) => {
      farmEvent.helpers.add(userId);
      return false;
    },
    recordRescue: async (discordId, wallet, eventName, success, reward) => {
      calls.push(["recordRescue", discordId, wallet, eventName, success, reward]);
      return { current_rescue_streak: success ? 1 : 0, best_rescue_streak: 1 };
    },
    releaseRescueAttempt: (farmEvent, userId) => {
      calls.push(["release", userId]);
      farmEvent.players.delete(userId);
    },
    reserveRescueAttempt: (farmEvent, userId) => {
      calls.push(["reserve", userId]);
      farmEvent.players.add(userId);
    },
    updateFarmEventMessage: async farmEvent => calls.push(["updateEvent", farmEvent.name]),
    logger: { error: (...args) => calls.push(["logger.error", ...args]) },
    random: () => 0,
    ...overrides
  });

  return { handlers, state };
}

test("handleRescue replies with block reason without reserving attempt", async () => {
  const { handlers, state } = createHandlers({
    getRescueBlockReason: () => "No active farm emergency."
  });
  const interaction = createInteraction();

  await handlers.handleRescue(interaction);

  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1), "No active farm emergency.");
  assert.deepEqual(state.calls, []);
});

test("handleRescue releases reserved attempt when wallet is missing", async () => {
  const { handlers, state } = createHandlers({
    getWallet: async () => null
  });
  const interaction = createInteraction();

  await handlers.handleRescue(interaction);

  assert.deepEqual(state.calls, []);
  assert.equal(state.farmEvent.players.has("farmer"), false);
  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1), "You must verify your wallet first using `/verify`.");
});

test("handleRescue records success, updates community progress, and announces result", async () => {
  const targetMessages = [];
  const { handlers, state } = createHandlers({
    recordCommunitySuccess: farmEvent => {
      farmEvent.communitySuccesses = 1;
      return true;
    }
  });
  state.farmEvent.isCommunity = true;
  state.farmEvent.target = {
    isTextBased: () => true,
    send: async payload => targetMessages.push(payload)
  };
  const interaction = createInteraction({ displayName: "Rescuer" });

  await handlers.handleRescue(interaction);

  assert.deepEqual(state.calls, [
    ["reserve", "farmer"],
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["recordRescue", "farmer", "wallet.wam", "Farm Rescue", true, 4],
    ["updateEvent", "Farm Rescue"],
    ["announceGoal", "Farm Rescue"]
  ]);
  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1).embeds[0].type, "rescue");
  assert.equal(interaction.editReplyPayloads.at(-1).embeds[0].payload.member.displayName, "Rescuer");
  assert.equal(targetMessages.at(-1).embeds[0].type, "rescue");
});

test("handleRescue releases attempt when recording throws before completion", async () => {
  const { handlers, state } = createHandlers({
    recordRescue: async () => {
      throw new Error("db failed");
    }
  });
  const interaction = createInteraction();

  await assert.rejects(() => handlers.handleRescue(interaction), /db failed/);

  assert.equal(state.farmEvent.players.has("farmer"), false);
  assert.deepEqual(state.calls, [
    ["reserve", "farmer"],
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["release", "farmer"]
  ]);
});

test("handleRescue logs Discord permission announcement failures as concise warnings", async () => {
  const warnings = [];
  const { handlers, state } = createHandlers({
    logger: {
      warn: (...args) => warnings.push(args),
      error: (...args) => state.calls.push(["logger.error", ...args])
    }
  });
  state.farmEvent.target = {
    isTextBased: () => true,
    send: async () => {
      const error = new Error("Missing Permissions");
      error.code = 50013;
      throw error;
    }
  };

  await handlers.handleRescue(createInteraction());

  assert.equal(state.calls.some(([name]) => name === "logger.error"), false);
  assert.match(warnings[0][0], /Failed to announce Farmer Pets rescue result/);
  assert.match(warnings[0][0], /Missing Permissions/);
});

test("handleFarmHelp validates state and wallet before helping", async () => {
  const blocked = createHandlers({
    getFarmHelpBlockReason: () => "This farm emergency has already ended."
  });
  const blockedInteraction = createInteraction();

  await blocked.handlers.handleFarmHelp(blockedInteraction);

  assert.deepEqual(blockedInteraction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(blockedInteraction.editReplyPayloads.at(-1), "This farm emergency has already ended.");

  const missingWallet = createHandlers({
    getWallet: async () => null
  });
  const missingWalletInteraction = createInteraction();

  await missingWallet.handlers.handleFarmHelp(missingWalletInteraction);

  assert.deepEqual(missingWalletInteraction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(missingWalletInteraction.editReplyPayloads.at(-1), "You must verify your wallet first using `/verify`.");
});

test("handleFarmHelp requires rescue attempt before help", async () => {
  const { handlers } = createHandlers();
  const interaction = createInteraction();

  await handlers.handleFarmHelp(interaction);

  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1), "Try **Rescue Pet** first, then you can help the farm after your attempt.");
});

test("handleFarmHelp records help, updates community events, and announces embed", async () => {
  const targetMessages = [];
  const { handlers, state } = createHandlers({
    recordFarmHelp: (farmEvent, userId) => {
      state.calls.push(["recordHelp", userId]);
      farmEvent.helpers.add(userId);
      return true;
    }
  });
  state.farmEvent.isCommunity = true;
  state.farmEvent.players.add("farmer");
  state.farmEvent.target = {
    isTextBased: () => true,
    send: async payload => targetMessages.push(payload)
  };
  const interaction = createInteraction({ displayName: "Helper" });

  await handlers.handleFarmHelp(interaction);

  assert.deepEqual(state.calls, [
    ["ensurePlayer", "farmer", "wallet.wam"],
    ["recordHelp", "farmer"],
    ["updateEvent", "Farm Rescue"],
    ["announceGoal", "Farm Rescue"]
  ]);
  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1).embeds[0].type, "help");
  assert.equal(interaction.editReplyPayloads.at(-1).embeds[0].payload.member.displayName, "Helper");
  assert.equal(interaction.editReplyPayloads.at(-1).embeds[0].payload.progressAdded, true);
  assert.equal(targetMessages.at(-1).embeds[0].type, "help");
});
