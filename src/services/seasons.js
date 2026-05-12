const { ROLES } = require("../config");

const SEASON_ORDER = ["Spring", "Summer", "Fall", "Winter"];
const SEASON_RESOURCE = {
  Spring: "food",
  Fall: "wood",
  Winter: "silver"
};
const SEASON_ROLE_KEY = {
  Spring: "food",
  Fall: "wood",
  Winter: "silver"
};
const SUMMER_RESOURCES = ["food", "wood", "silver"];
const SEASON_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SEASON_ANCHOR_MS = Date.UTC(2026, 0, 5); // Monday anchor for stable two-week seasons.

function getCurrentSeason(now = new Date()) {
  const elapsedWeeks = Math.max(Math.floor((Number(now) - SEASON_ANCHOR_MS) / SEASON_WEEK_MS), 0);
  const seasonIndex = Math.floor(elapsedWeeks / 2) % SEASON_ORDER.length;

  return SEASON_ORDER[seasonIndex];
}

function getSummerBoostResource(random = Math.random) {
  return SUMMER_RESOURCES[Math.floor(random() * SUMMER_RESOURCES.length)] || "food";
}

function getSeasonBoostResource(farmEvent = {}, now = new Date()) {
  const season = farmEvent.season || getCurrentSeason(now);

  return season === "Summer" ? farmEvent.summerBoostResource : SEASON_RESOURCE[season];
}

function memberHasRole(member, roleKey) {
  const role = ROLES[roleKey];
  return Boolean(role && member?.roles?.cache?.has(role.id));
}

function getSeasonBonus(member, analysis = {}, farmEvent = {}, now = new Date()) {
  const season = farmEvent.season || getCurrentSeason(now);
  const resource = getSeasonBoostResource(farmEvent, now);
  const roleKey = season === "Summer" ? resource : SEASON_ROLE_KEY[season];
  const applies = Boolean(roleKey && (memberHasRole(member, roleKey) || analysis?.[roleKey] > 0));

  return {
    season,
    resource,
    applies,
    bonus: applies ? 0.05 : 0,
    description: getSeasonDescription(season, resource)
  };
}

function getSeasonDescription(season, resource) {
  if (season === "Spring") return "🌱 Spring Bonus: Pet Food Producers receive +5% rescue success chance.";
  if (season === "Fall") return "🍂 Fall Bonus: Wood Gatherers receive +5% rescue success chance.";
  if (season === "Winter") return "❄️ Winter Bonus: Silver Miners receive +5% rescue success chance.";

  const resourceName = resource || "food";
  return `☀️ Summer Bonus: ${resourceName[0].toUpperCase()}${resourceName.slice(1)} farmers receive +5% rescue success chance.`;
}

module.exports = {
  getCurrentSeason,
  getSeasonBonus,
  getSeasonBoostResource,
  getSeasonDescription,
  getSummerBoostResource
};
