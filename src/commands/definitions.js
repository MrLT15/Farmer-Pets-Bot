const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("fp-roles")
    .setDescription("Sync Farmer Pets roles"),

  new SlashCommandBuilder()
    .setName("fp-rescue")
    .setDescription("Join the current farm rescue event"),

  new SlashCommandBuilder()
    .setName("fp-stats")
    .setDescription("Show your Farmer Pets rescue stats"),

  new SlashCommandBuilder()
    .setName("fp-daily")
    .setDescription("Claim your daily Farmer Pets check-in reward"),

  new SlashCommandBuilder()
    .setName("fp-leaderboard")
    .setDescription("Show the Farmer Pets weekly leaderboard"),

  new SlashCommandBuilder()
    .setName("fp-payouts")
    .setDescription("Admin: show Farmer Pets NKFE payouts owed")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-resetpayouts")
    .setDescription("Admin: reset Farmer Pets payout balances after manual payment")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-testevent")
    .setDescription("Admin: manually start a Farmer Pets event")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

module.exports = { commands };
