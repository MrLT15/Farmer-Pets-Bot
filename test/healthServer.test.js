const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { createHealthServer } = require("../src/runtime/healthServer");

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, hostname: "127.0.0.1" }, res => {
      let body = "";

      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
      });
    });

    req.on("error", reject);
  });
}

test("buildHealthPayload includes uptime and active farm event summary", () => {
  const server = createHealthServer({
    getActiveFarmEvent: () => ({
      name: "Barn Fire",
      isCommunity: true,
      players: new Set(["a", "b"]),
      helpers: new Set(["c"])
    }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    uptime: () => 12.4
  });

  assert.deepEqual(server.buildHealthPayload(), {
    ok: true,
    service: "farmer-pets-discord-bot",
    uptimeSeconds: 12,
    checkedAt: "2026-05-09T12:00:00.000Z",
    activeFarmEvent: {
      name: "Barn Fire",
      isCommunity: true,
      players: 2,
      helpers: 1
    }
  });
});

test("health server serves /health and / and rejects unknown paths", async () => {
  const logs = [];
  const server = createHealthServer({
    getActiveFarmEvent: () => null,
    logger: { log: message => logs.push(message) },
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    uptime: () => 3
  });

  const httpServer = await server.start(0);
  const port = httpServer.address().port;

  try {
    const health = await requestJson(port, "/health");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.activeFarmEvent, null);

    const root = await requestJson(port, "/");
    assert.equal(root.statusCode, 200);
    assert.equal(root.body.service, "farmer-pets-discord-bot");

    const missing = await requestJson(port, "/missing");
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.body, { ok: false, error: "Not found" });
  } finally {
    await server.stop();
  }

  assert.equal(logs.some(message => /listening/.test(message)), true);
  assert.equal(logs.at(-1), "Farmer Pets health server stopped.");
});

test("health server ignores invalid port values instead of crashing startup", async () => {
  const warnings = [];
  const server = createHealthServer({
    getActiveFarmEvent: () => null,
    logger: {
      log: () => {},
      warn: message => warnings.push(message)
    }
  });

  assert.equal(await server.start("HEALTH_PORT=3000"), null);
  assert.match(warnings[0], /Invalid HEALTH_PORT\/PORT value/);
});

test("health server start is optional and idempotent", async () => {
  const server = createHealthServer({ getActiveFarmEvent: () => null, logger: { log: () => {} } });

  assert.equal(await server.start(undefined), null);

  const first = await server.start(0);
  const second = await server.start(0);

  assert.equal(first, second);
  await server.stop();
  await server.stop();
});
