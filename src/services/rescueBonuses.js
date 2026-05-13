const { ROLES } = require("../config");
const { getSeasonBonus } = require("./seasons");

const BASE_RESCUE_CHANCE = 0.35;
const MAX_RESCUE_CHANCE = 0.85;
const SECURITY_FORCE_BONUS_CAP = 0.15;
const ROLE_BONUSES = {
  food: 0.03,
  wood: 0.03,
  silver: 0.03,
  tool: 0.05,
  workingFarm: 0.05,
  fullFarm: 0.07
};

function memberHasRole(member, roleKey) {
  const role = ROLES[roleKey];
  return Boolean(role && member?.roles?.cache?.has(role.id));
}

function getSuccessChance(member, analysis = {}, farmEvent = {}) {
  const breakdown = getSuccessChanceBreakdown(member, analysis, farmEvent);
  return breakdown.total;
}

function getSuccessChanceBreakdown(member, analysis = {}, farmEvent = {}) {
  const roleBonus = Object.entries(ROLE_BONUSES).reduce((total, [roleKey, bonus]) => {
    return total + (memberHasRole(member, roleKey) ? bonus : 0);
  }, 0);
  const securityBonus = Math.min((analysis.securityForces || 0) * 0.01, SECURITY_FORCE_BONUS_CAP);
  const dogBonus = analysis.companions?.dog > 0 ? 0.05 : 0;
  const season = getSeasonBonus(member, analysis, farmEvent);
  const uncapped = BASE_RESCUE_CHANCE + roleBonus + securityBonus + dogBonus + season.bonus;

  return {
    base: BASE_RESCUE_CHANCE,
    roleBonus,
    securityBonus,
    dogBonus,
    seasonBonus: season.bonus,
    season,
    uncapped,
    total: Number(Math.min(uncapped, MAX_RESCUE_CHANCE).toFixed(4))
  };
}

module.exports = {
  BASE_RESCUE_CHANCE,
  MAX_RESCUE_CHANCE,
  ROLE_BONUSES,
  getSuccessChance,
  getSuccessChanceBreakdown
};
