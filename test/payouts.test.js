const assert = require("node:assert/strict");
const test = require("node:test");

const {
  calculateFeeUnits,
  createPayoutService,
  formatTokenAmount,
  formatTokenAmountFixed,
  toUnits
} = require("../src/services/payouts");

test("weekly payout summary points players to self-service withdrawals", () => {
  const service = createPayoutService({
    config: {
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
});

test("token unit helpers format decimals and fees", () => {
  const gross = toUnits(4, 8);
  const fee = calculateFeeUnits(gross, 0.03);

  assert.equal(gross, 400000000n);
  assert.equal(fee, 12000000n);
  assert.equal(formatTokenAmount(gross - fee, 8), "3.88");
  assert.equal(formatTokenAmountFixed(gross - fee, 8), "3.88000000");
});

test("executeNkfePayout reports missing payout API URL", async () => {
  const service = createPayoutService({ config: {} });

  await assert.rejects(
    () => service.executeNkfePayout({
      withdrawalId: 1,
      toWallet: "abc.wam",
      netUnits: 1n,
      grossUnits: 1n,
      feeUnits: 0n,
      discordId: "123"
    }),
    /NKFE_PAYOUT_API_URL/
  );
});

test("executeNkfePayout posts RoA-style payload and returns transaction id", async () => {
  const requests = [];
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_API_URL: "https://payout.example/nkfe",
      NKFE_PAYOUT_API_KEY: "secret",
      NKFE_PAYOUT_TIMEOUT_MS: 5000,
      NKFE_TOKEN_DECIMALS: 8
    },
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ tx_id: "wax-tx-123" })
      };
    }
  });

  const result = await service.executeNkfePayout({
    withdrawalId: 42,
    toWallet: "abc.wam",
    netUnits: 388000000n,
    grossUnits: 400000000n,
    feeUnits: 12000000n,
    discordId: "discord-1"
  });

  assert.deepEqual(result, {
    ok: true,
    transactionId: "wax-tx-123",
    response: { tx_id: "wax-tx-123" }
  });
  assert.equal(requests[0].url, "https://payout.example/nkfe");
  assert.equal(requests[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    toWallet: "abc.wam",
    amountUnits: "388000000",
    amount: "3.88000000",
    tokenIdentifier: "NKFE",
    memo: "Farmer Pets NKFE Withdrawal #42",
    metadata: {
      withdrawalId: 42,
      discordId: "discord-1",
      grossUnits: "400000000",
      feeUnits: "12000000",
      source: "farmer_pets"
    }
  });
});
