const assert = require("node:assert/strict");
const test = require("node:test");

const { analyzeAssets, getSuccessChance, syncRoles } = require("../src/services/roles");
const { ROLES } = require("../src/config");

function makeMember(roleIds = []) {
  const cache = new Set(roleIds);
  const added = [];
  const removed = [];

  return {
    roles: {
      cache: {
        has: roleId => cache.has(roleId)
      },
      add: async roleId => {
        cache.add(roleId);
        added.push(roleId);
      },
      remove: async roleId => {
        cache.delete(roleId);
        removed.push(roleId);
      }
    },
    added,
    removed,
    hasRole: roleId => cache.has(roleId)
  };
}

test("analyzeAssets classifies Farmer Pets resources and farm completeness", () => {
  const analysis = analyzeAssets([
    { name: "Pet Food Bag" },
    { data: { asset_name: "Lumber Wood Stack" } },
    { template: { immutable_data: { name: "Silver Mine" } } },
    { schema: { schema_name: "farm tool" } },
    { data: { type: "pickaxe" } }
  ]);

  assert.equal(analysis.total, 5);
  assert.equal(analysis.food, 1);
  assert.equal(analysis.wood, 1);
  assert.equal(analysis.silver, 1);
  assert.equal(analysis.tool, 2);
  assert.equal(analysis.verified, true);
  assert.equal(analysis.workingFarm, true);
  assert.equal(analysis.fullFarm, true);
});

test("analyzeAssets handles empty asset lists", () => {
  const analysis = analyzeAssets([]);

  assert.deepEqual(analysis, {
    total: 0,
    food: 0,
    wood: 0,
    silver: 0,
    tool: 0,
    verified: false,
    workingFarm: false,
    fullFarm: false
  });
});

test("getSuccessChance applies role bonuses and caps chance", () => {
  const baseMember = makeMember();
  assert.equal(getSuccessChance(baseMember, {}, { season: "Spring" }), 0.35);

  const boostedMember = makeMember([
    ROLES.food.id,
    ROLES.wood.id,
    ROLES.silver.id,
    ROLES.tool.id,
    ROLES.fullFarm.id
  ]);
  assert.equal(getSuccessChance(boostedMember, { securityForces: 20, companions: { dog: 1 } }, { season: "Spring" }), 0.81);
});

test("syncRoles adds and removes Discord roles from an asset analysis", async () => {
  const member = makeMember([ROLES.wood.id, ROLES.fullFarm.id]);
  const result = await syncRoles(member, {
    verified: true,
    food: 1,
    wood: 0,
    silver: 0,
    tool: 1,
    workingFarm: false,
    fullFarm: false
  });

  assert.deepEqual(result.added, [ROLES.verified.name, ROLES.food.name, ROLES.tool.name]);
  assert.deepEqual(result.removed, [ROLES.wood.name, ROLES.fullFarm.name]);
  assert.equal(member.hasRole(ROLES.verified.id), true);
  assert.equal(member.hasRole(ROLES.food.id), true);
  assert.equal(member.hasRole(ROLES.tool.id), true);
  assert.equal(member.hasRole(ROLES.wood.id), false);
  assert.equal(member.hasRole(ROLES.fullFarm.id), false);
});
