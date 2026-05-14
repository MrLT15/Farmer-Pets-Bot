const { REST, Routes } = require("discord.js");
const cron = require("node-cron");

function registerClientReadyHandler({
  client,
  token,
  clientId,
  guildId,
  commands,
  initDatabase,
  scheduleEvent,
  postWeeklyLeaderboardAndReset,
  logger = console,
  exitProcess = process.exit
}) {
  client.once("clientReady", async () => {
    logger.log(`Farmer Pets Bot online as ${client.user.tag}`);

    try {
      await initDatabase();

      const rest = new REST({ version: "10" }).setToken(token);

      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );

      logger.log("Farmer Pets slash commands registered.");

      scheduleEvent();

      cron.schedule(
        "0 17 * * 0",
        async () => {
          try {
            await postWeeklyLeaderboardAndReset(client);
          } catch (error) {
            logger.error("Failed to post weekly Farmer Pets leaderboard:", error);
          }
        },
        { timezone: "America/Los_Angeles" }
      );

      logger.log("Weekly Farmer Pets leaderboard scheduled for Sundays at 5:00 PM Pacific.");
    } catch (error) {
      logger.error("Failed during Farmer Pets startup:", error);

      if (error?.code === "28000") {
        logger.error(
          "PostgreSQL authentication failed. Check DATABASE_URL on Render and ensure the database role is allowed to log in."
        );
      }

      exitProcess(1);
    }
  });
}

module.exports = { registerClientReadyHandler };
