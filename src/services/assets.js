const {
  ATOMIC_API,
  ATOMIC_ASSET_PAGE_LIMIT,
  CONTRACT_ACCOUNT,
  FARMER_PETS_API
} = require("../config");

async function getJsonSafe(url) {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status}: ${url}`);
    }

    const json = await res.json();

    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.rows)) return json.rows;

    return [];
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

async function getWalletAssets(wallet) {
  const assets = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      owner: wallet,
      collection_name: "farmerpetsgo",
      limit: String(ATOMIC_ASSET_PAGE_LIMIT),
      page: String(page)
    });

    const pageAssets = await getJsonSafe(`${ATOMIC_API}?${params.toString()}`);
    assets.push(...pageAssets);

    if (pageAssets.length < ATOMIC_ASSET_PAGE_LIMIT) break;

    page++;
  }

  return assets;
}

function makePseudoAssetFromRow(row, source) {
  const templateId =
    row.template_id ||
    row.templateId ||
    row.template ||
    row.templateid ||
    "";

  const name =
    row.name ||
    row.asset_name ||
    row.template_name ||
    row.schema_name ||
    row.type ||
    source;

  return {
    asset_id: row.asset_id || row.assetId || `${source}-${templateId}-${Math.random()}`,
    name,
    data: row,
    template: {
      template_id: String(templateId),
      immutable_data: { name }
    },
    schema: {
      schema_name: row.schema_name || row.schema || source
    },
    source
  };
}

function buildRowsUrl(table, params) {
  const query = new URLSearchParams(params).toString();

  return `${FARMER_PETS_API}/api/rows/${table}?${query}`;
}

async function getStakedAssets(wallet) {
  const urls = [
    {
      source: "tools",
      url: buildRowsUrl("tools", { scope: CONTRACT_ACCOUNT, user: wallet })
    },
    {
      source: "lands",
      url: buildRowsUrl("lands", { scope: CONTRACT_ACCOUNT, user: wallet })
    },
    {
      source: "pets",
      url: buildRowsUrl("pets", { user: wallet })
    },
    {
      source: "items",
      url: buildRowsUrl("items", { user: wallet })
    },
    {
      source: "solarpanels",
      url: buildRowsUrl("solarpanels", { user: wallet })
    }
  ];

  const stakedAssets = [];

  for (const item of urls) {
    const rows = await getJsonSafe(item.url);

    for (const row of rows) {
      stakedAssets.push(makePseudoAssetFromRow(row, item.source));
    }
  }

  return stakedAssets;
}

async function getAssets(wallet) {
  const walletAssets = await getWalletAssets(wallet);
  const stakedAssets = await getStakedAssets(wallet);

  return {
    walletAssets,
    stakedAssets,
    combinedAssets: [...walletAssets, ...stakedAssets]
  };
}

module.exports = {
  buildRowsUrl,
  getAssets,
  getJsonSafe,
  getStakedAssets,
  getWalletAssets,
  makePseudoAssetFromRow
};
