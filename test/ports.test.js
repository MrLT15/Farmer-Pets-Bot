const assert = require("node:assert/strict");
const test = require("node:test");

const { formatPortStatus, normalizePort } = require("../src/utils/ports");

test("normalizePort accepts whole-number TCP port values", () => {
  assert.equal(normalizePort(0), 0);
  assert.equal(normalizePort("3000"), 3000);
  assert.equal(normalizePort(" 8080 "), 8080);
  assert.equal(normalizePort(65535), 65535);
});

test("normalizePort rejects missing, malformed, and out-of-range ports", () => {
  assert.equal(normalizePort(undefined), null);
  assert.equal(normalizePort(""), null);
  assert.equal(normalizePort("HEALTH_PORT=3000"), null);
  assert.equal(normalizePort("3000/tcp"), null);
  assert.equal(normalizePort("65536"), null);
});

test("formatPortStatus distinguishes disabled, valid, and invalid ports", () => {
  assert.equal(formatPortStatus(undefined), "Disabled");
  assert.equal(formatPortStatus("3000"), "3000");
  assert.equal(formatPortStatus("HEALTH_PORT=3000"), "Invalid (HEALTH_PORT=3000)");
});
