const assert = require("node:assert/strict");
const test = require("node:test");

const { createPayoutService } = require("../src/services/payouts");

test("automatic payout service reports missing configuration", async () => {
  const warnings = [];
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_SYMBOL: "NKFE"
    },
    db: { clearPayoutsForDiscordIds: async () => assert.fail("should not clear payouts") },
    logger: { warn: message => warnings.push(message) }
  });

  const result = await service.sendAutomaticWeeklyPayouts([
    { discord_id: "123", wallet: "abc.wam", payout_nkfe: 5 }
  ]);

  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.missing, ["NKFE_PAYOUT_WEBHOOK_URL", "NKFE_TOKEN_CONTRACT"]);
  assert.match(warnings[0], /missing NKFE_PAYOUT_WEBHOOK_URL, NKFE_TOKEN_CONTRACT/);
  assert.match(service.formatAutomaticPayoutSummary(result), /roadisledger/);
});

test("automatic payout service posts payout batch and clears paid balances", async () => {
  const cleared = [];
  const requests = [];
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_CONTRACT: "nkfe.token",
      NKFE_TOKEN_SYMBOL: "NKFE",
      NKFE_PAYOUT_MEMO: "weekly",
      NKFE_PAYOUT_WEBHOOK_URL: "https://payout.example/weekly",
      NKFE_PAYOUT_WEBHOOK_SECRET: "secret"
    },
    db: { clearPayoutsForDiscordIds: async ids => cleared.push(ids) },
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ paidWallets: ["abc.wam"], transactionId: "tx123" })
      };
    }
  });

  const result = await service.sendAutomaticWeeklyPayouts([
    { discord_id: "123", wallet: "abc.wam", payout_nkfe: 5 },
    { discord_id: "456", wallet: "def.wam", payout_nkfe: 0 }
  ]);

  assert.equal(result.status, "paid");
  assert.equal(result.paidCount, 1);
  assert.equal(result.totalPaid, 5);
  assert.deepEqual(cleared, [["123"]]);
  assert.equal(requests[0].url, "https://payout.example/weekly");
  assert.equal(requests[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].options.body).payouts, [
    { discordId: "123", wallet: "abc.wam", amount: 5 }
  ]);
});
