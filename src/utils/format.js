function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

module.exports = { formatNumber, formatPercent };
