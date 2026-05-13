function createPayoutService({
  config,
  db,
  logger = console,
  fetchFn = globalThis.fetch
}) {
  function getAutomaticPayoutConfigStatus() {
    const missing = [];

    if (!config.NKFE_PAYOUT_WEBHOOK_URL) missing.push("NKFE_PAYOUT_WEBHOOK_URL");
    if (!config.NKFE_TOKEN_CONTRACT) missing.push("NKFE_TOKEN_CONTRACT");

    return {
      enabled: missing.length === 0,
      missing,
      sourceWallet: config.NKFE_PAYOUT_SOURCE_WALLET,
      tokenContract: config.NKFE_TOKEN_CONTRACT,
      tokenSymbol: config.NKFE_TOKEN_SYMBOL
    };
  }

  async function sendAutomaticWeeklyPayouts(payoutRows) {
    const rows = payoutRows.filter(row => Number(row.payout_nkfe || 0) > 0);

    if (!rows.length) {
      return { status: "empty", paidCount: 0, totalPaid: 0, failedCount: 0 };
    }

    const status = getAutomaticPayoutConfigStatus();

    if (!status.enabled) {
      logger.warn(
        `Automatic Farmer Pets NKFE payouts skipped; missing ${status.missing.join(", ")}.`
      );
      return {
        status: "not_configured",
        paidCount: 0,
        totalPaid: 0,
        failedCount: rows.length,
        missing: status.missing
      };
    }

    if (typeof fetchFn !== "function") {
      throw new Error("Automatic payout webhook is configured, but fetch is unavailable.");
    }

    const payload = {
      sourceWallet: config.NKFE_PAYOUT_SOURCE_WALLET,
      tokenContract: config.NKFE_TOKEN_CONTRACT,
      tokenSymbol: config.NKFE_TOKEN_SYMBOL,
      memo: config.NKFE_PAYOUT_MEMO,
      payouts: rows.map(row => ({
        discordId: row.discord_id,
        wallet: row.wallet,
        amount: Number(row.payout_nkfe || 0)
      }))
    };

    const response = await fetchFn(config.NKFE_PAYOUT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.NKFE_PAYOUT_WEBHOOK_SECRET
          ? { authorization: `Bearer ${config.NKFE_PAYOUT_WEBHOOK_SECRET}` }
          : {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Automatic payout webhook failed with HTTP ${response.status}.`);
    }

    const result = await response.json().catch(() => ({}));
    const paidWallets = Array.isArray(result.paidWallets)
      ? result.paidWallets
      : rows.map(row => row.wallet);
    const paidRows = rows.filter(row => paidWallets.includes(row.wallet));
    const paidDiscordIds = paidRows.map(row => row.discord_id);
    const totalPaid = paidRows.reduce((sum, row) => sum + Number(row.payout_nkfe || 0), 0);

    if (paidDiscordIds.length) {
      await db.clearPayoutsForDiscordIds(paidDiscordIds);
    }

    return {
      status: "paid",
      paidCount: paidDiscordIds.length,
      totalPaid,
      failedCount: rows.length - paidDiscordIds.length,
      transactionId: result.transactionId || null
    };
  }

  function formatAutomaticPayoutSummary(result) {
    if (!result || result.status === "empty") {
      return "No $NKFE payouts were owed this week.";
    }

    if (result.status === "not_configured") {
      return `Automatic $NKFE payouts from **${config.NKFE_PAYOUT_SOURCE_WALLET}** are not configured yet. Missing: ${result.missing.join(", ")}.`;
    }

    if (result.status === "paid") {
      return (
        `Automatic $NKFE payouts sent from **${config.NKFE_PAYOUT_SOURCE_WALLET}**: ` +
        `**${result.totalPaid} ${config.NKFE_TOKEN_SYMBOL}** to **${result.paidCount}** wallet(s)` +
        `${result.failedCount ? `; **${result.failedCount}** payout(s) still need review` : ""}` +
        `${result.transactionId ? ` (tx: ${result.transactionId})` : ""}.`
      );
    }

    return "Automatic $NKFE payout status is unknown.";
  }

  return {
    formatAutomaticPayoutSummary,
    getAutomaticPayoutConfigStatus,
    sendAutomaticWeeklyPayouts
  };
}

module.exports = { createPayoutService };
