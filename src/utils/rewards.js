const { randomInt } = require("./random");

function calculateDailyReward(streak) {
  const base = randomInt(1, 3);
  const streakBonus = streak > 0 && streak % 7 === 0 ? 5 : 0;

  return {
    base,
    streakBonus,
    total: base + streakBonus
  };
}

module.exports = { calculateDailyReward };
