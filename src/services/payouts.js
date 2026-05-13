function createPayoutService({ config }) {
  function formatWeeklyLedgerSummary({ payoutRows = [] } = {}) {
    const totalAvailable = payoutRows.reduce(
      (sum, row) => sum + Number(row.payout_nkfe || 0),
      0
    );

    if (!totalAvailable) {
      return "No withdrawable $NKFE balances are currently available.";
    }

    return (
      `Withdrawable $NKFE remains in the Farmer Pets bot ledger: **${totalAvailable} ${config.NKFE_TOKEN_SYMBOL}**. ` +
      `Players can request their own withdrawal with **/fp-withdraw**; treasury source: **${config.NKFE_PAYOUT_SOURCE_WALLET}**.`
    );
  }

  return { formatWeeklyLedgerSummary };
}

module.exports = { createPayoutService };
