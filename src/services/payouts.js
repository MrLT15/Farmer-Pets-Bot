const { createWaxTransferService } = require("./waxTransfers");

const DIRECT_WITHDRAWAL_CONFIG = [
  ["WAX_RPC_URL", "WAX_RPC_URL"],
  ["NKFE_TOKEN_CONTRACT", "NKFE_TOKEN_CONTRACT"],
  ["NKFE_PAYOUT_SOURCE_WALLET", "NKFE_PAYOUT_SOURCE_WALLET"],
  ["NKFE_TREASURY_PRIVATE_KEY", "NKFE_TREASURY_PRIVATE_KEY"]
];

function getMissingDirectWithdrawalConfig(config = {}) {
  return DIRECT_WITHDRAWAL_CONFIG
    .filter(([, key]) => !config[key])
    .map(([name]) => name);
}

function formatWithdrawalNotConfiguredError(config = {}) {
  const missingDirectConfig = getMissingDirectWithdrawalConfig(config);
  const directConfigHint = missingDirectConfig.length
    ? ` For direct WAX withdrawals, set missing env var(s): ${missingDirectConfig.join(", ")}.`
    : "";

  return (
    "Automatic $NKFE withdrawals are not configured yet." +
    directConfigHint +
    " Alternatively, set NKFE_WITHDRAWAL_WEBHOOK_URL to use an external payout provider."
  );
}

function createPayoutService({
  config,
  fetchFn = globalThis.fetch,
  waxTransferService = createWaxTransferService({
    rpcUrl: config.WAX_RPC_URL,
    tokenContract: config.NKFE_TOKEN_CONTRACT,
    tokenSymbol: config.NKFE_TOKEN_SYMBOL,
    tokenPrecision: config.NKFE_TOKEN_PRECISION,
    sourceWallet: config.NKFE_PAYOUT_SOURCE_WALLET,
    privateKey: config.NKFE_TREASURY_PRIVATE_KEY,
    memo: config.NKFE_WITHDRAWAL_MEMO,
    fetchFn
  })
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
    return Boolean(waxTransferService?.isConfigured?.() || config.NKFE_WITHDRAWAL_WEBHOOK_URL);
  }

  async function sendWithdrawal({ discordId, wallet, amount }) {
    if (waxTransferService?.isConfigured?.()) {
      try {
        return await waxTransferService.transfer({ to: wallet, amount });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    if (!config.NKFE_WITHDRAWAL_WEBHOOK_URL) {
      return {
        ok: false,
        error: formatWithdrawalNotConfiguredError(config)
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

module.exports = {
  createPayoutService,
  formatWithdrawalNotConfiguredError,
  getMissingDirectWithdrawalConfig
};
