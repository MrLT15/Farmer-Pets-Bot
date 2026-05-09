const assert = require("node:assert/strict");
const test = require("node:test");

const { createAssetService, stableStringify } = require("../src/services/assets");

const TEST_CONFIG = {
  ATOMIC_API: "https://atomic.example.test/assets",
  ATOMIC_ASSET_PAGE_LIMIT: 2,
  CONTRACT_ACCOUNT: "farmerpetssc",
  FARMER_PETS_API: "https://pets.example.test"
};

function createFetch(responses) {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const response = responses.shift();

    if (response instanceof Error) {
      throw response;
    }

    return {
      ok: response?.ok ?? true,
      status: response?.status ?? 200,
      json: async () => response?.json
    };
  };

  fetchFn.calls = calls;
  return fetchFn;
}

test("getJsonSafe normalizes array, data, rows, and empty response shapes", async () => {
  const fetchFn = createFetch([
    { json: ["array"] },
    { json: { data: ["data"] } },
    { json: { rows: ["rows"] } },
    { json: { other: true } }
  ]);
  const service = createAssetService({ config: TEST_CONFIG, fetchFn });

  assert.deepEqual(await service.getJsonSafe("https://example.test/array"), ["array"]);
  assert.deepEqual(await service.getJsonSafe("https://example.test/data"), ["data"]);
  assert.deepEqual(await service.getJsonSafe("https://example.test/rows"), ["rows"]);
  assert.deepEqual(await service.getJsonSafe("https://example.test/empty"), []);
});

test("getJsonSafe wraps failed HTTP and fetch errors with URL context", async () => {
  const serviceWithHttpFailure = createAssetService({
    config: TEST_CONFIG,
    fetchFn: createFetch([{ ok: false, status: 503, json: {} }])
  });

  await assert.rejects(
    () => serviceWithHttpFailure.getJsonSafe("https://example.test/down"),
    /Failed to fetch https:\/\/example\.test\/down: Fetch failed 503/
  );

  const serviceWithNetworkFailure = createAssetService({
    config: TEST_CONFIG,
    fetchFn: createFetch([new Error("network offline")])
  });

  await assert.rejects(
    () => serviceWithNetworkFailure.getJsonSafe("https://example.test/offline"),
    /Failed to fetch https:\/\/example\.test\/offline: network offline/
  );
});

test("getWalletAssets paginates AtomicAssets until a short page", async () => {
  const fetchFn = createFetch([
    { json: { data: [{ asset_id: "1" }, { asset_id: "2" }] } },
    { json: { data: [{ asset_id: "3" }] } }
  ]);
  const service = createAssetService({ config: TEST_CONFIG, fetchFn });

  const assets = await service.getWalletAssets("farmer.wam");

  assert.deepEqual(assets.map(asset => asset.asset_id), ["1", "2", "3"]);
  assert.equal(fetchFn.calls.length, 2);
  assert.match(fetchFn.calls[0], /owner=farmer\.wam/);
  assert.match(fetchFn.calls[0], /limit=2/);
  assert.match(fetchFn.calls[0], /page=1/);
  assert.match(fetchFn.calls[1], /page=2/);
});

test("getStakedAssets fetches Farmer Pets rows and converts pseudo assets", async () => {
  const fetchFn = createFetch([
    { json: { rows: [{ template_id: 123, asset_name: "Iron Tool" }] } },
    { json: { rows: [{ assetId: "land-asset", name: "Starter Land", schema: "lands" }] } },
    { json: { rows: [] } },
    { json: { rows: [{ type: "Pet Food" }] } },
    { json: { rows: [] } }
  ]);
  const service = createAssetService({ config: TEST_CONFIG, fetchFn });

  const assets = await service.getStakedAssets("farmer.wam");

  assert.deepEqual(fetchFn.calls, [
    "https://pets.example.test/api/rows/tools?scope=farmerpetssc&user=farmer.wam",
    "https://pets.example.test/api/rows/lands?scope=farmerpetssc&user=farmer.wam",
    "https://pets.example.test/api/rows/pets?user=farmer.wam",
    "https://pets.example.test/api/rows/items?user=farmer.wam",
    "https://pets.example.test/api/rows/solarpanels?user=farmer.wam"
  ]);
  assert.equal(assets.length, 3);
  assert.equal(assets[0].asset_id, "tools-123");
  assert.equal(assets[0].name, "Iron Tool");
  assert.equal(assets[0].template.template_id, "123");
  assert.equal(assets[0].schema.schema_name, "tools");
  assert.equal(assets[1].asset_id, "land-asset");
  assert.equal(assets[2].source, "items");
  assert.match(assets[2].asset_id, /^items-[a-z0-9]+$/);
});

test("getAssets combines wallet and staked assets", async () => {
  const fetchFn = createFetch([
    { json: { data: [{ asset_id: "wallet-1" }] } },
    { json: { rows: [{ template_id: "tool-1", name: "Tool" }] } },
    { json: { rows: [] } },
    { json: { rows: [] } },
    { json: { rows: [] } },
    { json: { rows: [] } }
  ]);
  const service = createAssetService({ config: TEST_CONFIG, fetchFn });

  const assets = await service.getAssets("farmer.wam");

  assert.deepEqual(assets.walletAssets, [{ asset_id: "wallet-1" }]);
  assert.equal(assets.stakedAssets.length, 1);
  assert.deepEqual(assets.combinedAssets.map(asset => asset.asset_id), ["wallet-1", "tools-tool-1"]);
});

test("stableStringify emits deterministic output for sorted object keys", () => {
  assert.equal(
    stableStringify({ z: 1, a: { c: true, b: [2, 1] } }),
    '{"a":{"b":[2,1],"c":true},"z":1}'
  );
});
