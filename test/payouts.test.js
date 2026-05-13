const assert = require("node:assert/strict");
const test = require("node:test");

const { createPayoutService } = require("../src/services/payouts");

test("weekly payout summary points players to self-service withdrawals", () => {
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_SYMBOL: "NKFE"
    }
  });

  const summary = service.formatWeeklyLedgerSummary({
    payoutRows: [
      { payout_nkfe: 5 },
      { payout_nkfe: "7" }
    ]
  });

  assert.match(summary, /12 NKFE/);
  assert.match(summary, /\/fp-withdraw/);
  assert.match(summary, /roadisledger/);
});

test("sendWithdrawal reports missing provider configuration", async () => {
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_SYMBOL: "NKFE"
    }
  });

  assert.equal(service.isWithdrawalConfigured(), false);
  assert.deepEqual(await service.sendWithdrawal({ wallet: "abc.wam", amount: 3 }), {
    ok: false,
    error: "Automatic $NKFE withdrawals are not configured yet."
  });
});

test("sendWithdrawal posts to configured provider and returns transaction id", async () => {
  const requests = [];
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_SYMBOL: "NKFE",
      NKFE_WITHDRAWAL_WEBHOOK_URL: "https://withdraw.example",
      NKFE_WITHDRAWAL_WEBHOOK_SECRET: "secret",
      NKFE_WITHDRAWAL_MEMO: "withdraw memo"
    },
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ transactionId: "tx123" })
      };
    }
  });

  assert.equal(service.isWithdrawalConfigured(), true);
  assert.deepEqual(
    await service.sendWithdrawal({ discordId: "123", wallet: "abc.wam", amount: 4 }),
    { ok: true, transactionId: "tx123" }
  );
  assert.equal(requests[0].url, "https://withdraw.example");
  assert.equal(requests[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    sourceWallet: "roadisledger",
    tokenSymbol: "NKFE",
    memo: "withdraw memo",
    withdrawal: { discordId: "123", wallet: "abc.wam", amount: 4 }
  });
});
