const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeUtilityAssets,
  getMaxRescueAttempts,
  getRewardBonus
} = require("../src/services/utilityProfile");

test("analyzeUtilityAssets detects rescue utility NFTs by keyword fallback", () => {
  const profile = analyzeUtilityAssets([
    { name: "Security Forces SGT" },
    { name: "Large NDV Delivery Vehicle" },
    { name: "NPC Personnel Carrier" },
    { name: "Commander Badge" },
    { name: "Dog Loyalty Tag" },
    { name: "Parrot Melody Feather" }
  ]);

  assert.equal(profile.securityForces, 1);
  assert.equal(profile.ndv, 1);
  assert.equal(profile.largeNdv, 1);
  assert.equal(profile.npc, 1);
  assert.equal(profile.commander, 1);
  assert.equal(profile.companions.dog, 1);
  assert.equal(profile.companions.parrot, 1);
});

test("utility helpers expose rescue attempts and reward bonuses", () => {
  assert.equal(getMaxRescueAttempts({ npc: 0 }), 1);
  assert.equal(getMaxRescueAttempts({ npc: 1 }), 2);
  assert.deepEqual(getRewardBonus({ ndv: 1, largeNdv: 0, companions: { parrot: 1 } }), {
    ndvBonus: 1,
    parrotBonus: 1,
    total: 2
  });
  assert.deepEqual(getRewardBonus({ ndv: 1, largeNdv: 1, companions: {} }), {
    ndvBonus: 2,
    parrotBonus: 0,
    total: 2
  });
});
