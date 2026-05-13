const SECURITY_FORCE_KEYWORDS = [
  "security", "forces", "pvt", "pfc", "lcpl", "cpl", "sgt", "mtber",
  "shari", "susie", "alex", "jeff", "luna"
];
const NDV_KEYWORDS = ["ndv", "delivery vehicle", "large ndv", "medium ndv", "small ndv"];
const NPC_KEYWORDS = ["npc", "personnel carrier", "large npc", "medium npc", "small npc"];
const COMMANDER_KEYWORDS = ["commander"];
const COMPANION_KEYWORDS = {
  dog: ["dog", "loyalty tag"],
  cat: ["cat", "furball"],
  bunny: ["bunny", "lucky footprint"],
  parrot: ["parrot", "melody feather"]
};

function getAssetSearchText(asset = {}) {
  return [
    asset.name,
    asset.collection?.collection_name,
    asset.collection_name,
    asset.data?.name,
    asset.data?.asset_name,
    asset.data?.template_name,
    asset.data?.type,
    asset.template?.immutable_data?.name,
    asset.template?.template_id,
    asset.schema?.schema_name,
    asset.source
  ].filter(Boolean).join(" ").toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

function analyzeUtilityAssets(assets = []) {
  const profile = {
    securityForces: 0,
    ndv: 0,
    largeNdv: 0,
    npc: 0,
    commander: 0,
    companions: {
      dog: 0,
      cat: 0,
      bunny: 0,
      parrot: 0
    }
  };

  for (const asset of assets) {
    const text = getAssetSearchText(asset);

    if (includesAny(text, SECURITY_FORCE_KEYWORDS)) profile.securityForces++;

    if (includesAny(text, NDV_KEYWORDS)) {
      profile.ndv++;
      if (text.includes("large") || text.includes("legendary")) profile.largeNdv++;
    }

    if (includesAny(text, NPC_KEYWORDS)) profile.npc++;
    if (includesAny(text, COMMANDER_KEYWORDS)) profile.commander++;

    for (const [companion, keywords] of Object.entries(COMPANION_KEYWORDS)) {
      if (includesAny(text, keywords)) profile.companions[companion]++;
    }
  }

  return profile;
}

function mergeUtilityProfile(...profiles) {
  const merged = analyzeUtilityAssets([]);

  for (const profile of profiles.filter(Boolean)) {
    merged.securityForces += profile.securityForces || 0;
    merged.ndv += profile.ndv || 0;
    merged.largeNdv += profile.largeNdv || 0;
    merged.npc += profile.npc || 0;
    merged.commander += profile.commander || 0;

    for (const companion of Object.keys(merged.companions)) {
      merged.companions[companion] += profile.companions?.[companion] || 0;
    }
  }

  return merged;
}

function getMaxRescueAttempts(profile = {}) {
  return profile.npc > 0 ? 2 : 1;
}

function getRewardBonus(profile = {}) {
  const ndvBonus = profile.largeNdv > 0 ? 2 : profile.ndv > 0 ? 1 : 0;
  const parrotBonus = profile.companions?.parrot > 0 ? 1 : 0;

  return {
    ndvBonus,
    parrotBonus,
    total: ndvBonus + parrotBonus
  };
}

module.exports = {
  analyzeUtilityAssets,
  getAssetSearchText,
  getMaxRescueAttempts,
  getRewardBonus,
  mergeUtilityProfile
};
