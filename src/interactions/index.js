const {
  FLAGS_EPHEMERAL,
  HELP_FARM_BUTTON_CUSTOM_ID,
  RESCUE_BUTTON_CUSTOM_ID
} = require("../config");
const { isUnknownInteractionError, logUnknownInteractionWarning } = require("../utils/discordErrors");

function createInteractionHandler({ commandHandlers, handleFarmHelp, handleRescue }) {
  return async interaction => {
    try {
      if (interaction.isButton()) {
        await handleButtonInteraction(interaction, { handleFarmHelp, handleRescue });
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      const handler = commandHandlers[interaction.commandName];
      if (!handler) return;

      if (interaction.commandName === "fp-withdraw") {
        const acknowledged = await safelyDeferInteraction(interaction);
        if (!acknowledged) return;
      }

      await handler(interaction);
    } catch (error) {
      await handleInteractionError(interaction, error);
    }
  };
}

async function safelyDeferInteraction(interaction, { logger = console } = {}) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply({ flags: FLAGS_EPHEMERAL });
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logUnknownInteractionWarning(logger, "Could not acknowledge /fp-withdraw before Discord expired the interaction.");
      return false;
    }

    throw error;
  }
}

async function handleButtonInteraction(interaction, { handleFarmHelp, handleRescue }) {
  if (interaction.customId === RESCUE_BUTTON_CUSTOM_ID) {
    await handleRescue(interaction);
    return;
  }

  if (interaction.customId === HELP_FARM_BUTTON_CUSTOM_ID) {
    await handleFarmHelp(interaction);
  }
}

async function handleInteractionError(interaction, error) {
  if (isUnknownInteractionError(error)) {
    logUnknownInteractionWarning(console);
    return;
  }

  console.error(error);

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Something went wrong.");
    } else {
      await interaction.reply({
        content: "Something went wrong.",
        flags: FLAGS_EPHEMERAL
      });
    }
  } catch {
    console.log("Could not send error reply to interaction.");
  }
}

module.exports = { createInteractionHandler, safelyDeferInteraction };
