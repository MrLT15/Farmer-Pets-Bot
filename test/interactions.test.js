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
