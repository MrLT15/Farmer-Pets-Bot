const DISCORD_PERMISSION_ERROR_CODES = new Set([50001, 50013]);
let lastUnknownInteractionWarningAt = 0;

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

function isUnknownInteractionError(error) {
  return error?.code === 10062 || error?.rawError?.code === 10062;
}

function logUnknownInteractionWarning(
  logger,
  message = "Discord interaction expired before acknowledgement.",
  { now = Date.now(), throttleMs = 60_000 } = {}
) {
  if (throttleMs > 0 && now - lastUnknownInteractionWarningAt < throttleMs) return false;

  lastUnknownInteractionWarningAt = now;
  const log = logger.warn || logger.log || logger.error;
  log.call(
    logger,
    `${message} This usually means Discord's 3-second acknowledgement window was missed, the command was retried from a stale client interaction, or another bot instance handled the same interaction first.`
  );
  return true;
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
  isUnknownInteractionError,
  logDiscordPermissionWarning,
  logUnknownInteractionWarning
};
