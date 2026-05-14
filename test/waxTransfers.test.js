const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { createWaxTransferService, internals } = require("../src/services/waxTransfers");

const PRIVATE_KEY_HEX = "0000000000000000000000000000000000000000000000000000000000000001";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function wifFromPrivateKey(hex) {
  const payload = Buffer.concat([Buffer.from([0x80]), Buffer.from(hex, "hex")]);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return internals.base58Encode(Buffer.concat([payload, checksum]));
}

test("parseWifPrivateKey decodes valid WAX private keys", () => {
  const privateKey = wifFromPrivateKey(PRIVATE_KEY_HEX);

  assert.equal(internals.parseWifPrivateKey(privateKey).toString("hex"), PRIVATE_KEY_HEX);
  assert.equal(privateKey, "5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf");
});

test("serializeTransferData encodes transfer action data", () => {
  const data = internals.serializeTransferData({
    from: "roadisledger",
    to: "abc.wam",
    amount: 1.25,
    tokenPrecision: 4,
    tokenSymbol: "NKFE",
    memo: "test"
  });

  assert.equal(data.length > 20, true);
  assert.match(data.toString("hex"), /4e4b4645/);
});

test("transfer signs and pushes a WAX token transaction", async () => {
  const requests = [];
  const service = createWaxTransferService({
    rpcUrl: "https://wax.example",
    tokenContract: "nkfe.token",
    tokenSymbol: "NKFE",
    tokenPrecision: 4,
    sourceWallet: "roadisledger",
    privateKey: wifFromPrivateKey(PRIVATE_KEY_HEX),
    fetchFn: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith("/v1/chain/get_info")) {
        return {
          ok: true,
          json: async () => ({
            chain_id: "00".repeat(32),
            head_block_time: "2026-05-13T00:00:00.000",
            last_irreversible_block_num: 123
          })
        };
      }
      if (url.endsWith("/v1/chain/get_block")) {
        return {
          ok: true,
          json: async () => ({
            block_num: 123,
            id: "00".repeat(8) + "01020304" + "00".repeat(20)
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ transaction_id: "tx123" })
      };
    }
  });

  assert.equal(service.isConfigured(), true);
  assert.deepEqual(await service.transfer({ to: "abc.wam", amount: 2 }), {
    ok: true,
    transactionId: "tx123"
  });
  assert.equal(requests[2].url, "https://wax.example/v1/chain/push_transaction");
  assert.match(requests[2].body.signatures[0], /^SIG_K1_/);
  assert.equal(typeof requests[2].body.packed_trx, "string");
});
