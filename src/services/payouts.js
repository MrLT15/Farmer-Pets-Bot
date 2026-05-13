function toUnits(amount, decimals = 8) {
  const value = String(amount ?? "0").trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid NKFE amount.");

  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(paddedFraction || "0");
}

function formatTokenAmount(units, decimals = 8) {
  const value = BigInt(units || 0);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function fromUnits(units, decimals = 8) {
  return Number(formatTokenAmount(units, decimals));
}

function calculateFeeUnits(grossUnits, feePercent = 0) {
  const percent = String(feePercent ?? "0").trim();
  if (!percent || percent.startsWith("-")) return 0n;

  const [whole, fraction = ""] = percent.split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(fraction)) return 0n;

  const scale = 1_000_000_000n;
  const numerator = BigInt(whole || "0") * scale + BigInt(fraction.padEnd(9, "0").slice(0, 9) || "0");
  if (numerator <= 0n) return 0n;

  return (BigInt(grossUnits) * numerator) / scale;
}

function getPayoutTransactionId(result = {}) {
  return result.txId || result.transactionId || result.tx_id || result.transaction_id || null;
}

function normalizePayoutError(error) {
  if (error?.name === "AbortError") return "NKFE payout API timed out.";
  return error?.message || "NKFE payout API request failed.";
}

function createPayoutService({
  config,
  fetchFn = globalThis.fetch,
  AbortControllerClass = globalThis.AbortController
}) {
  const tokenDecimals = Number(config.NKFE_TOKEN_DECIMALS ?? config.NKFE_TOKEN_PRECISION ?? 8);

  function formatWeeklyLedgerSummary({ payoutRows = [] } = {}) {
    const totalAvailable = payoutRows.reduce(
      (sum, row) => sum + Number(row.payout_nkfe || 0),
      0
    );

    if (!totalAvailable) {
      return "No withdrawable $NKFE balances are currently available.";
    }

    return (
      `Withdrawable $NKFE remains in the Farmer Pets bot ledger: **${totalAvailable} ${config.NKFE_TOKEN_SYMBOL || "NKFE"}**. ` +
      "Players can withdraw to their verified wallets with **/fp-withdraw**."
    );
  }

  function isWithdrawalConfigured() {
    return Boolean(
      config.NKFE_SYSTEM_ENABLED !== false &&
      config.NKFE_WITHDRAWALS_ENABLED !== false &&
      config.NKFE_PAYOUTS_ENABLED !== false &&
      config.NKFE_PAYOUT_API_URL
    );
  }

  async function executeNkfePayout({ withdrawalId, toWallet, netUnits, grossUnits, feeUnits, discordId }) {
    if (config.NKFE_SYSTEM_ENABLED === false) throw new Error("NKFE system is disabled.");
    if (config.NKFE_WITHDRAWALS_ENABLED === false) throw new Error("NKFE withdrawals are disabled.");
    if (config.NKFE_PAYOUTS_ENABLED === false) throw new Error("NKFE payouts are disabled.");
    if (!config.NKFE_PAYOUT_API_URL) {
      throw new Error("NKFE payout API is not configured. Set NKFE_PAYOUT_API_URL in Render.");
    }
    if (typeof fetchFn !== "function") throw new Error("NKFE payout API cannot run because fetch is unavailable.");

    const controller = AbortControllerClass ? new AbortControllerClass() : null;
    const timeoutMs = Number(config.NKFE_PAYOUT_TIMEOUT_MS || 15000);
    const timeout = controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    const body = {
      toWallet,
      amountUnits: netUnits.toString(),
      amount: formatTokenAmount(netUnits, tokenDecimals),
      tokenIdentifier: "NKFE",
      memo: `Farmer Pets NKFE Withdrawal #${withdrawalId}`,
      metadata: {
        withdrawalId,
        discordId,
        grossUnits: grossUnits.toString(),
        feeUnits: feeUnits.toString(),
        source: "farmer_pets"
      }
    };

    try {
      const response = await fetchFn(config.NKFE_PAYOUT_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.NKFE_PAYOUT_API_KEY ? { authorization: `Bearer ${config.NKFE_PAYOUT_API_KEY}` } : {})
        },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {})
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || `NKFE payout API returned HTTP ${response.status}.`);
      }
      if (result.ok === false) {
        throw new Error(result.error || result.message || "NKFE payout API rejected the withdrawal.");
      }

      return { ok: true, transactionId: getPayoutTransactionId(result), response: result };
    } catch (error) {
      throw new Error(normalizePayoutError(error));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function sendWithdrawal({ discordId, wallet, amount }) {
    const grossUnits = toUnits(amount, tokenDecimals);
    const feeUnits = calculateFeeUnits(grossUnits, config.NKFE_WITHDRAWAL_FEE_PERCENT);
    return executeNkfePayout({
      withdrawalId: "legacy",
      toWallet: wallet,
      netUnits: grossUnits - feeUnits,
      grossUnits,
      feeUnits,
      discordId
    });
  }

  return {
    executeNkfePayout,
    formatWeeklyLedgerSummary,
    isWithdrawalConfigured,
    sendWithdrawal
  };
}

module.exports = {
  calculateFeeUnits,
  createPayoutService,
  formatTokenAmount,
  fromUnits,
  getPayoutTransactionId,
  toUnits
};
