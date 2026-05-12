const assert = require("node:assert/strict");
const test = require("node:test");

const { ROLES } = require("../src/config");
const { getCurrentSeason, getSeasonBonus } = require("../src/services/seasons");

function memberWith(roleId) {
  return { roles: { cache: { has: id => id === roleId } } };
}

test("getCurrentSeason follows the two-week repeating cycle", () => {
  assert.equal(getCurrentSeason(new Date("2026-01-05T00:00:00.000Z")), "Spring");
  assert.equal(getCurrentSeason(new Date("2026-01-19T00:00:00.000Z")), "Summer");
  assert.equal(getCurrentSeason(new Date("2026-02-02T00:00:00.000Z")), "Fall");
  assert.equal(getCurrentSeason(new Date("2026-02-16T00:00:00.000Z")), "Winter");
});

test("getSeasonBonus applies matching seasonal role boosts", () => {
  assert.equal(getSeasonBonus(memberWith(ROLES.food.id), {}, { season: "Spring" }).bonus, 0.05);
  assert.equal(getSeasonBonus(memberWith(ROLES.wood.id), {}, { season: "Fall" }).bonus, 0.05);
  assert.equal(getSeasonBonus(memberWith(ROLES.silver.id), {}, { season: "Winter" }).bonus, 0.05);
  assert.equal(getSeasonBonus(memberWith(ROLES.food.id), {}, { season: "Summer", summerBoostResource: "food" }).bonus, 0.05);
});
