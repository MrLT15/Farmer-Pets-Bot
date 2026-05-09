const http = require("node:http");

function createHealthServer({
  getActiveFarmEvent,
  logger = console,
  now = () => new Date(),
  uptime = () => process.uptime()
}) {
  let server = null;

  function buildHealthPayload() {
    const farmEvent = getActiveFarmEvent?.();

    return {
      ok: true,
      service: "farmer-pets-discord-bot",
      uptimeSeconds: Math.round(uptime()),
      checkedAt: now().toISOString(),
      activeFarmEvent: farmEvent ? {
        name: farmEvent.name,
        isCommunity: Boolean(farmEvent.isCommunity),
        players: farmEvent.players?.size || 0,
        helpers: farmEvent.helpers?.size || 0
      } : null
    };
  }

  function requestHandler(req, res) {
    if (req.method !== "GET" || !["/", "/health"].includes(req.url)) {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }

    sendJson(res, 200, buildHealthPayload());
  }

  async function start(port) {
    if (port === undefined || port === null || port === "") return null;
    if (server) return server;

    server = http.createServer(requestHandler);

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(port), () => {
        server.off("error", reject);
        logger.log(`Farmer Pets health server listening on port ${port}.`);
        resolve();
      });
    });

    return server;
  }

  async function stop() {
    if (!server) return;

    const serverToClose = server;
    server = null;

    await new Promise((resolve, reject) => {
      serverToClose.close(error => {
        if (error) {
          reject(error);
          return;
        }

        logger.log("Farmer Pets health server stopped.");
        resolve();
      });
    });
  }

  return {
    buildHealthPayload,
    requestHandler,
    start,
    stop
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

module.exports = { createHealthServer };
