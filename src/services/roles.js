const { ROLES } = require("../config");

function analyzeAssets(assets) {
  let food = 0;
  let wood = 0;
  let silver = 0;
  let tool = 0;

  for (const asset of assets) {
    const searchable =
      `${asset.name || ""} ` +
      `${asset.data?.name || ""} ` +
      `${asset.data?.asset_name || ""} ` +
      `${asset.data?.template_name || ""} ` +
      `${asset.data?.type || ""} ` +
      `${asset.template?.immutable_data?.name || ""} ` +
      `${asset.schema?.schema_name || ""} ` +
      `${asset.source || ""}`;

    const lower = searchable.toLowerCase();

    if (lower.includes("food") || lower.includes("feed")) food++;
    if (lower.includes("wood") || lower.includes("lumber")) wood++;
    if (lower.includes("silver")) silver++;

    if (
      lower.includes("tool") ||
      lower.includes("axe") ||
      lower.includes("pickaxe") ||
      lower.includes("shovel") ||
      lower.includes("hammer") ||
      lower.includes("saw")
    ) {
      tool++;
    }
  }

  const production = food + wood + silver;

  return {
    total: assets.length,
    food,
    wood,
    silver,
    tool,
    verified: assets.length > 0,
    workingFarm: production >= 2,
    fullFarm: food > 0 && wood > 0 && silver > 0
  };
}

async function syncRoles(member, analysis) {
  const checks = [
    ["verified", analysis.verified],
    ["food", analysis.food > 0],
    ["wood", analysis.wood > 0],
    ["silver", analysis.silver > 0],
    ["tool", analysis.tool > 0],
    ["workingFarm", analysis.workingFarm],
    ["fullFarm", analysis.fullFarm]
  ];

  const added = [];
  const removed = [];

  for (const [key, shouldHave] of checks) {
    const role = ROLES[key];
    const hasRole = member.roles.cache.has(role.id);

    if (shouldHave && !hasRole) {
      await member.roles.add(role.id);
      added.push(role.name);
    }

    if (!shouldHave && hasRole) {
      await member.roles.remove(role.id);
      removed.push(role.name);
    }
  }

  return { added, removed };
}

function getSuccessChance(member) {
  let chance = 0.4;

  if (member.roles.cache.has(ROLES.food.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.wood.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.silver.id)) chance += 0.05;
  if (member.roles.cache.has(ROLES.tool.id)) chance += 0.10;
  if (member.roles.cache.has(ROLES.fullFarm.id)) chance += 0.15;

  return Math.min(chance, 0.75);
}

module.exports = {
  analyzeAssets,
  getSuccessChance,
  syncRoles
};
