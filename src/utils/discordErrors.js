const DISCORD_PERMISSION_ERROR_CODES = new Set([50001, 50013]);

function isDiscordPermissionError(error) {
  return DISCORD_PERMISSION_ERROR_CODES.has(error?.code);
}

function getDiscordPermissionHint(error) {
  if (error?.code === 50001) {
    return "Missing Access: grant the bot View Channel access to the configured channel/message and Create Public Threads if event threads are enabled.";
  }

  if (error?.code === 50013) {
    return "Missing Permissions: grant the bot Send Messages, Embed Links, Create Public Threads, and Send Messages in Threads in the configured farm channel.";
  }

  return null;
}

function logDiscordPermissionWarning(logger, message, error) {
  const hint = getDiscordPermissionHint(error);

  if (!hint) return false;

  const log = logger.warn || logger.log || logger.error;
  log.call(logger, `${message} ${hint}`);
  return true;
}

module.exports = {
  getDiscordPermissionHint,
  isDiscordPermissionError,
  logDiscordPermissionWarning
};
