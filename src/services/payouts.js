function createPayoutService({
  config,
  fetchFn = globalThis.fetch
}) {
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
      `Players can withdraw to their verified wallets with **/fp-withdraw**; treasury source: **${config.NKFE_PAYOUT_SOURCE_WALLET}**.`
    );
  }

  function isWithdrawalConfigured() {
    return Boolean(config.NKFE_WITHDRAWAL_WEBHOOK_URL);
  }

  async function sendWithdrawal({ discordId, wallet, amount }) {
    if (!isWithdrawalConfigured()) {
      return {
        ok: false,
        error: "Automatic $NKFE withdrawals are not configured yet."
      };
    }

    if (typeof fetchFn !== "function") {
      return {
        ok: false,
        error: "Automatic $NKFE withdrawals cannot run because fetch is unavailable."
      };
    }

    const response = await fetchFn(config.NKFE_WITHDRAWAL_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.NKFE_WITHDRAWAL_WEBHOOK_SECRET
          ? { authorization: `Bearer ${config.NKFE_WITHDRAWAL_WEBHOOK_SECRET}` }
          : {})
      },
      body: JSON.stringify({
        sourceWallet: config.NKFE_PAYOUT_SOURCE_WALLET,
        tokenSymbol: config.NKFE_TOKEN_SYMBOL,
        memo: config.NKFE_WITHDRAWAL_MEMO,
        withdrawal: {
          discordId,
          wallet,
          amount
        }
      })
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Withdrawal provider returned HTTP ${response.status}.`
      };
    }

    const result = await response.json().catch(() => ({}));

    if (result.ok === false) {
      return {
        ok: false,
        error: result.error || "Withdrawal provider rejected the transfer."
      };
    }

    return {
      ok: true,
      transactionId: result.transactionId || result.txid || result.transaction_id || null
    };
  }

  return {
    formatWeeklyLedgerSummary,
    isWithdrawalConfigured,
    sendWithdrawal
  };
}

module.exports = { createPayoutService };
