const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateDailyReward } = require("../src/utils/rewards");

test("calculateDailyReward returns base reward in configured range", () => {
  for (let index = 0; index < 20; index++) {
    const reward = calculateDailyReward(1);

    assert.ok(reward.base >= 1 && reward.base <= 3, `base ${reward.base} should be in range`);
    assert.equal(reward.streakBonus, 0);
    assert.equal(reward.total, reward.base);
  }
});

test("calculateDailyReward adds seven-day streak bonus", () => {
  const reward = calculateDailyReward(7);

  assert.ok(reward.base >= 1 && reward.base <= 3, `base ${reward.base} should be in range`);
  assert.equal(reward.streakBonus, 5);
  assert.equal(reward.total, reward.base + 5);
});

test("calculateDailyReward does not add bonus for zero or non-milestone streaks", () => {
  assert.equal(calculateDailyReward(0).streakBonus, 0);
  assert.equal(calculateDailyReward(6).streakBonus, 0);
  assert.equal(calculateDailyReward(8).streakBonus, 0);
});
