const assert = require("node:assert/strict");
const test = require("node:test");

const { createInteractionHandler } = require("../src/interactions");
const {
  FLAGS_EPHEMERAL,
  HELP_FARM_BUTTON_CUSTOM_ID,
  RESCUE_BUTTON_CUSTOM_ID
} = require("../src/config");

function createChatInteraction(commandName) {
  const interaction = {
    commandName,
    isButton: () => false,
    isChatInputCommand: () => true,
    replied: false,
    deferred: false,
    replyPayloads: [],
    editReplyPayloads: [],
    reply: async payload => {
      interaction.replied = true;
      interaction.replyPayloads.push(payload);
    },
    editReply: async payload => {
      interaction.editReplyPayloads.push(payload);
    }
  };

  return interaction;
}

test("button interactions route to rescue and farm help handlers", async () => {
  const calls = [];
  const handler = createInteractionHandler({
    commandHandlers: {},
    handleFarmHelp: async interaction => calls.push(["help", interaction.customId]),
    handleRescue: async interaction => calls.push(["rescue", interaction.customId])
  });

  const rescueInteraction = {
    customId: RESCUE_BUTTON_CUSTOM_ID,
    isButton: () => true,
    isChatInputCommand: () => false
  };
  const helpInteraction = {
    customId: HELP_FARM_BUTTON_CUSTOM_ID,
    isButton: () => true,
    isChatInputCommand: () => false
  };

  await handler(rescueInteraction);
  await handler(helpInteraction);

  assert.deepEqual(calls, [
    ["rescue", RESCUE_BUTTON_CUSTOM_ID],
    ["help", HELP_FARM_BUTTON_CUSTOM_ID]
  ]);
});

test("chat command interactions dispatch to matching command handler", async () => {
  const calls = [];
  const handler = createInteractionHandler({
    commandHandlers: {
      "fp-stats": async interaction => calls.push(interaction.commandName)
    },
    handleFarmHelp: async () => calls.push("help"),
    handleRescue: async () => calls.push("rescue")
  });

  await handler(createChatInteraction("fp-stats"));
  await handler(createChatInteraction("unknown"));

  assert.deepEqual(calls, ["fp-stats"]);
});

test("interaction errors reply or edit with a generic failure", async t => {
  t.mock.method(console, "error", () => {});

  const handler = createInteractionHandler({
    commandHandlers: {
      "fp-boom": async () => {
        throw new Error("boom");
      }
    },
    handleFarmHelp: async () => {},
    handleRescue: async () => {}
  });

  const freshInteraction = createChatInteraction("fp-boom");
  await handler(freshInteraction);

  assert.deepEqual(freshInteraction.replyPayloads.at(-1), {
    content: "Something went wrong.",
    flags: FLAGS_EPHEMERAL
  });

  const deferredInteraction = createChatInteraction("fp-boom");
  deferredInteraction.deferred = true;
  await handler(deferredInteraction);

  assert.equal(deferredInteraction.editReplyPayloads.at(-1), "Something went wrong.");
});

test("fp-withdraw is acknowledged before dispatching withdrawal work", async () => {
  const calls = [];
  const interaction = createChatInteraction("fp-withdraw");
  interaction.deferReply = async payload => {
    interaction.deferred = true;
    interaction.deferReplyPayload = payload;
    calls.push(["defer", payload]);
  };

  const handler = createInteractionHandler({
    commandHandlers: {
      "fp-withdraw": async commandInteraction => calls.push(["handler", commandInteraction.deferred])
    },
    handleFarmHelp: async () => {},
    handleRescue: async () => {}
  });

  await handler(interaction);

  assert.deepEqual(calls, [
    ["defer", { flags: FLAGS_EPHEMERAL }],
    ["handler", true]
  ]);
});

test("expired withdraw interactions are logged without retrying an invalid token", async t => {
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  const calls = [];
  const interaction = createChatInteraction("fp-withdraw");
  interaction.deferReply = async () => {
    const error = new Error("Unknown interaction");
    error.code = 10062;
    throw error;
  };

  const handler = createInteractionHandler({
    commandHandlers: {
      "fp-withdraw": async () => calls.push("handler")
    },
    handleFarmHelp: async () => {},
    handleRescue: async () => {}
  });

  await handler(interaction);

  assert.deepEqual(calls, []);
  assert.match(warnings.at(-1), /Could not acknowledge \/fp-withdraw/);
});
