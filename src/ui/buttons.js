const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const {
  HELP_FARM_BUTTON_CUSTOM_ID,
  RESCUE_BUTTON_CUSTOM_ID
} = require("../config");

function buildRescueButtonRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESCUE_BUTTON_CUSTOM_ID)
      .setLabel(disabled ? "Event Ended" : "Rescue Pet")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🌾")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(HELP_FARM_BUTTON_CUSTOM_ID)
      .setLabel(disabled ? "Help Closed" : "Help the Farm")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🧑‍🌾")
      .setDisabled(disabled)
  );
}

module.exports = { buildRescueButtonRow };
