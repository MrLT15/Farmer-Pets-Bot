const assert = require("node:assert/strict");
const test = require("node:test");

const { createCommandHandlers } = require("../src/commands/handlers");

const FLAGS_EPHEMERAL = 64;

function createMockInteraction({ userId = "discord-user", displayName = "Test Farmer" } = {}) {
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
    deferred: false,
    replied: false,
    deferReplyPayload: null,
    editReplyPayloads: [],
    replyPayloads: [],
    deferReply: async payload => {
      interaction.deferred = true;
      interaction.deferReplyPayload = payload;
    },
    editReply: async payload => {
      interaction.editReplyPayloads.push(payload);
    },
    reply: async payload => {
      interaction.replied = true;
      interaction.replyPayloads.push(payload);
    }
  };

  return interaction;
}

function createHandlers(overrides = {}) {
  return createCommandHandlers({
    announceNewFarmerRoles: async () => {},
    analyzeAssets: assets => ({
      total: assets.length,
      food: 0,
      wood: 0,
      silver: 0,
      tool: 0
    }),
    buildLeaderboardMessage: async () => "leaderboard",
    buildStatsPayload: async () => ({ content: "stats" }),
    flagsEphemeral: FLAGS_EPHEMERAL,
    getAssets: async () => ({ walletAssets: [], stakedAssets: [], combinedAssets: [] }),
    getPayoutRows: async () => [],
    getWallet: async () => "wallet.wam",
    getActiveFarmEvent: () => null,
    handleDailyCheckIn: async interaction => interaction.reply({ content: "daily" }),
    handleRescue: async interaction => interaction.reply({ content: "rescue" }),
    resetPayouts: async () => {},
    startFarmEvent: async () => true,
    syncRoles: async () => ({ added: [], removed: [] }),
    ...overrides
  });
}

test("fp-roles prompts users without a verified wallet", async () => {
  let getAssetsCalled = false;
  const handlers = createHandlers({
    getWallet: async () => null,
    getAssets: async () => {
      getAssetsCalled = true;
      return { walletAssets: [], stakedAssets: [], combinedAssets: [] };
    }
  });
  const interaction = createMockInteraction();

  await handlers["fp-roles"](interaction);

  assert.deepEqual(interaction.deferReplyPayload, { flags: FLAGS_EPHEMERAL });
  assert.equal(interaction.editReplyPayloads.at(-1), "Verify your wallet first using `/verify`.");
  assert.equal(getAssetsCalled, false);
});

test("fp-roles reports asset service failures without syncing roles", async t => {
  t.mock.method(console, "error", () => {});

  let syncRolesCalled = false;
  const handlers = createHandlers({
    getAssets: async () => {
      throw new Error("asset service unavailable");
    },
    syncRoles: async () => {
      syncRolesCalled = true;
      return { added: [], removed: [] };
    }
  });
  const interaction = createMockInteraction();

  await handlers["fp-roles"](interaction);

  assert.match(interaction.editReplyPayloads.at(-1), /asset services are unavailable/);
  assert.equal(syncRolesCalled, false);
});

test("fp-roles analyzes assets, syncs roles, announces new roles, and edits summary", async () => {
  const calls = [];
  const handlers = createHandlers({
    getWallet: async discordId => {
      calls.push(["getWallet", discordId]);
      return "farmer.wam";
    },
    getAssets: async wallet => {
      calls.push(["getAssets", wallet]);
      return {
        walletAssets: [{ name: "food" }],
        stakedAssets: [{ name: "wood" }],
        combinedAssets: [{ name: "food" }, { name: "wood" }]
      };
    },
    analyzeAssets: assets => {
      calls.push(["analyzeAssets", assets.length]);
      return { total: 2, food: 1, wood: 1, silver: 0, tool: 0 };
    },
    syncRoles: async (member, analysis) => {
      calls.push(["syncRoles", member.displayName, analysis.total]);
      return { added: ["Food Role"], removed: ["Old Role"] };
    },
    announceNewFarmerRoles: async (member, wallet, roles) => {
      calls.push(["announce", member.displayName, wallet, roles]);
    }
  });
  const interaction = createMockInteraction({ displayName: "Alice" });

  await handlers["fp-roles"](interaction);

  assert.deepEqual(calls, [
    ["getWallet", "discord-user"],
    ["getAssets", "farmer.wam"],
    ["analyzeAssets", 2],
    ["syncRoles", "Alice", 2],
    ["announce", "Alice", "farmer.wam", ["Food Role"]]
  ]);
  assert.match(interaction.editReplyPayloads.at(-1), /Wallet NFTs Found: \*\*1\*\*/);
  assert.match(interaction.editReplyPayloads.at(-1), /Food Role/);
  assert.match(interaction.editReplyPayloads.at(-1), /Old Role/);
});

test("fp-stats replies with an ephemeral stats payload", async () => {
  const handlers = createHandlers({
    buildStatsPayload: async (discordId, displayName) => ({
      content: `${discordId}:${displayName}`
    })
  });
  const interaction = createMockInteraction({ displayName: "Stats Farmer" });

  await handlers["fp-stats"](interaction);

  assert.deepEqual(interaction.replyPayloads.at(-1), {
    content: "discord-user:Stats Farmer",
    flags: FLAGS_EPHEMERAL
  });
});

test("fp-payouts handles empty and populated payout lists", async () => {
  const emptyHandlers = createHandlers();
  const emptyInteraction = createMockInteraction();

  await emptyHandlers["fp-payouts"](emptyInteraction);

  assert.deepEqual(emptyInteraction.replyPayloads.at(-1), {
    content: "No Farmer Pets NKFE payouts owed right now.",
    flags: FLAGS_EPHEMERAL
  });

  const populatedHandlers = createHandlers({
    getPayoutRows: async () => [
      { wallet: "wallet1", payout_nkfe: 7, discord_id: "123" },
      { wallet: "wallet2", payout_nkfe: 3, discord_id: "456" }
    ]
  });
  const populatedInteraction = createMockInteraction();

  await populatedHandlers["fp-payouts"](populatedInteraction);

  const payload = populatedInteraction.replyPayloads.at(-1);
  assert.equal(payload.flags, FLAGS_EPHEMERAL);
  assert.match(payload.content, /wallet1 — \*\*7 \$NKFE\*\* — <@123>/);
  assert.match(payload.content, /wallet2 — \*\*3 \$NKFE\*\* — <@456>/);
});

test("fp-resetpayouts resets balances and replies ephemerally", async () => {
  let resetCalled = false;
  const handlers = createHandlers({
    resetPayouts: async () => {
      resetCalled = true;
    }
  });
  const interaction = createMockInteraction();

  await handlers["fp-resetpayouts"](interaction);

  assert.equal(resetCalled, true);
  assert.deepEqual(interaction.replyPayloads.at(-1), {
    content: "Farmer Pets payout balances reset to 0. Lifetime stats were preserved.",
    flags: FLAGS_EPHEMERAL
  });
});

test("fp-testevent blocks active events and starts when idle", async () => {
  let startCalls = 0;
  const activeHandlers = createHandlers({
    getActiveFarmEvent: () => ({ name: "active" }),
    startFarmEvent: async () => {
      startCalls++;
      return true;
    }
  });
  const activeInteraction = createMockInteraction();

  await activeHandlers["fp-testevent"](activeInteraction);

  assert.equal(startCalls, 0);
  assert.equal(activeInteraction.editReplyPayloads.at(-1), "A Farmer Pets event is already active.");

  const idleHandlers = createHandlers({
    startFarmEvent: async () => {
      startCalls++;
      return true;
    }
  });
  const idleInteraction = createMockInteraction();

  await idleHandlers["fp-testevent"](idleInteraction);

  assert.equal(startCalls, 1);
  assert.equal(idleInteraction.editReplyPayloads.at(-1), "Test Farmer Pets event started.");
});
