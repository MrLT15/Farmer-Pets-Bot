function normalizePort(port) {
  if (port === undefined || port === null || port === "") return null;

  const portText = String(port).trim();

  if (!/^\d+$/.test(portText)) return null;

  const normalizedPort = Number(portText);

  if (!Number.isInteger(normalizedPort) || normalizedPort < 0 || normalizedPort > 65535) {
    return null;
  }

  return normalizedPort;
}

function formatPortStatus(port) {
  if (port === undefined || port === null || port === "") return "Disabled";

  const normalizedPort = normalizePort(port);

  return normalizedPort === null ? `Invalid (${port})` : String(normalizedPort);
}

module.exports = { formatPortStatus, normalizePort };
