const { PACIFIC_TIME_ZONE } = require("../config");

function getPacificDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getYesterdayPacificDateKey() {
  return getPacificDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

module.exports = { getPacificDateKey, getYesterdayPacificDateKey };
