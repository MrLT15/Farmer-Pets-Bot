const assert = require("node:assert/strict");
const test = require("node:test");

const { createPayoutService } = require("../src/services/payouts");

test("weekly payout summary keeps NKFE in the bot ledger for player withdrawals", () => {
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

  assert.match(summary, /bot ledger/);
  assert.match(summary, /12 NKFE/);
  assert.match(summary, /\/fp-withdraw/);
  assert.match(summary, /roadisledger/);
});

test("weekly payout summary handles empty withdrawable balances", () => {
  const service = createPayoutService({
    config: {
      NKFE_PAYOUT_SOURCE_WALLET: "roadisledger",
      NKFE_TOKEN_SYMBOL: "NKFE"
    }
  });

  assert.equal(
    service.formatWeeklyLedgerSummary({ payoutRows: [] }),
    "No withdrawable $NKFE balances are currently available."
  );
});
