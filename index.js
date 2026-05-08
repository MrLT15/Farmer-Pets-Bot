const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { Pool } = require("pg");
const cron = require("node-cron");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const FARM_CHANNEL = "1270948980615938109";
const LEADERBOARD_CHANNEL = "1499255526054170825";
const FARMER_VERIFIED_ROLE = "1499240994397356112";

const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";
const FARMER_PETS_API = "https://pets-api-main.herokuapp.com";
const CONTRACT_ACCOUNT = "farmerpetssc";

const FLAGS_EPHEMERAL = 64;
const FARM_EVENT_DURATION_MS = 5 * 60 * 1000;
const ATOMIC_ASSET_PAGE_LIMIT = 1000;
const RESCUE_BUTTON_CUSTOM_ID = "fp-rescue-button";

const ROLES = {
  verified: { id: "1499240994397356112", name: "🌱 Farmer Pets Verified" },
  food: { id: "1499241227097477171", name: "🥫 Pet Food Producer" },
  wood: { id: "1499241359146487838", name: "🪵 Wood Gatherer" },
  silver: { id: "1499241567016189972", name: "🥈 Silver Miner" },
  tool: { id: "1499240639655579881", name: "🛠️ Farm Tool Holder" },
  workingFarm: { id: "1499242211928182905", name: "🚜 Working Farm" },
  fullFarm: { id: "1499242342937399508", name: "🏭 Full Farm Operator" }
};

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let activeFarmEvent = null;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// DATABASE

async function initDatabase() {
  await validateRequiredTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS farmerpets_balances (
      discord_id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      payout_nkfe INTEGER NOT NULL DEFAULT 0,
      lifetime_nkfe INTEGER NOT NULL DEFAULT 0,
      total_successes INTEGER NOT NULL DEFAULT 0,
      total_attempts INTEGER NOT NULL DEFAULT 0,
      weekly_nkfe INTEGER NOT NULL DEFAULT 0,
      weekly_successes INTEGER NOT NULL DEFAULT 0,
      weekly_attempts INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS farmerpets_logs (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      event_name TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      reward INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Farmer Pets database tables ready.");
}

async function validateRequiredTables() {
  const tableRes = await pool.query(
    "SELECT to_regclass('public.verified_wallets') AS verified_wallets"
  );

  if (!tableRes.rows[0]?.verified_wallets) {
    throw new Error(
      "Missing required table public.verified_wallets. This bot depends on an existing wallet verification table with discord_id and wallet columns."
    );
  }

  const columnRes = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'verified_wallets'
      AND column_name = ANY($1::text[]);
  `, [["discord_id", "wallet"]]);

  const columns = new Set(columnRes.rows.map(row => row.column_name));
  const missingColumns = ["discord_id", "wallet"].filter(
    column => !columns.has(column)
  );

  if (missingColumns.length) {
    throw new Error(
      `Table public.verified_wallets is missing required column(s): ${missingColumns.join(", ")}.`
    );
  }
}

async function getWallet(discordId) {
  const res = await pool.query(
    "SELECT wallet FROM verified_wallets WHERE discord_id = $1",
    [discordId]
  );

  return res.rows[0]?.wallet || null;
}

async function ensurePlayer(discordId, wallet) {
  await pool.query(
    `
    INSERT INTO farmerpets_balances (discord_id, wallet, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET wallet = EXCLUDED.wallet, updated_at = NOW();
    `,
    [discordId, wallet]
  );
}

async function recordRescue(discordId, wallet, eventName, success, reward) {
  await pool.query(
    `
    INSERT INTO farmerpets_logs (discord_id, wallet, event_name, success, reward)
    VALUES ($1, $2, $3, $4, $5);
    `,
    [discordId, wallet, eventName, success, reward]
  );

  await pool.query(
    `
    INSERT INTO farmerpets_balances (
      discord_id,
      wallet,
      payout_nkfe,
      lifetime_nkfe,
      total_successes,
      total_attempts,
      weekly_nkfe,
      weekly_successes,
      weekly_attempts,
      updated_at
    )
    VALUES ($1, $2, $3, $3, $4, 1, $3, $4, 1, NOW())
    ON CONFLICT (discord_id)
    DO UPDATE SET
      wallet = EXCLUDED.wallet,
      payout_nkfe = farmerpets_balances.payout_nkfe + EXCLUDED.payout_nkfe,
      lifetime_nkfe = farmerpets_balances.lifetime_nkfe + EXCLUDED.lifetime_nkfe,
      total_successes = farmerpets_balances.total_successes + EXCLUDED.total_successes,
      total_attempts = farmerpets_balances.total_attempts + 1,
      weekly_nkfe = farmerpets_balances.weekly_nkfe + EXCLUDED.weekly_nkfe,
      weekly_successes = farmerpets_balances.weekly_successes + EXCLUDED.weekly_successes,
      weekly_attempts = farmerpets_balances.weekly_attempts + 1,
      updated_at = NOW();
    `,
    [discordId, wallet, reward, success ? 1 : 0]
  );
}

// ASSETS

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

// ROLE LOGIC

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

async function announceNewFarmerRoles(member, wallet, addedRoleNames) {
  if (!addedRoleNames.length) return;

  const channel = await client.channels.fetch(LEADERBOARD_CHANNEL).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send(
    `🌾 **NEW FARMER PETS ROLE UNLOCKED!** 🌾\n\n` +
      `**${member.displayName}** just unlocked new Farmer Pets role(s):\n\n` +
      `${addedRoleNames.map(role => `✅ ${role}`).join("\n")}\n\n` +
      `Wallet: **${wallet}**\n\n` +
      `The farm keeps growing. 🚜`
  );
}

async function syncRoles(member, analysis, wallet, announce = true) {
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

  if (announce && added.length) {
    await announceNewFarmerRoles(member, wallet, added);
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

// FARM EVENTS

function buildRescueButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(RESCUE_BUTTON_CUSTOM_ID)
      .setLabel("Rescue Pet")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🌾")
  );
}

async function startFarmEvent() {
  if (activeFarmEvent) return false;

  const roll = randomInt(1, 100);

  let name = "🐛 Pest Swarm";
  let min = 1;
  let max = 5;

  if (roll <= 5) {
    name = "🌾 Legendary Harvest Crisis";
    min = 10;
    max = 25;
  } else if (roll <= 25) {
    name = "⚠️ Rare Infestation";
    min = 5;
    max = 10;
  }

  const farmEvent = {
    name,
    rewardMin: min,
    rewardMax: max,
    expires: Date.now() + FARM_EVENT_DURATION_MS,
    players: new Set(),
    timeout: null
  };

  activeFarmEvent = farmEvent;

  try {
    const channel = await client.channels.fetch(FARM_CHANNEL);

    if (!channel?.isTextBased()) {
      throw new Error(`Farm channel ${FARM_CHANNEL} is not a text channel.`);
    }

    const pingRole = `<@&${FARMER_VERIFIED_ROLE}>`;

    await channel.send({
      content:
        `${pingRole}\n\n` +
        `${name}\n\n` +
        `🚨 **A Farm Emergency has started!**\n\n` +
        `Farmers have **5 minutes** to run **/fp-rescue** or press **Rescue Pet** below.\n\n` +
        `Reward: **${min}-${max} $NKFE**`,
      components: [buildRescueButtonRow()]
    });

    farmEvent.timeout = setTimeout(() => {
      if (activeFarmEvent === farmEvent) {
        activeFarmEvent = null;
      }

      scheduleEvent();
    }, FARM_EVENT_DURATION_MS);

    return true;
  } catch (error) {
    if (activeFarmEvent === farmEvent) {
      activeFarmEvent = null;
    }

    throw error;
  }
}

function scheduleEvent() {
  const delay = randomInt(
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000
  );

  console.log(`Next Farmer Pets event in ${Math.round(delay / 60000)} minutes.`);

  setTimeout(() => {
    startFarmEvent().catch(error => {
      console.error("Failed to start scheduled Farmer Pets event:", error);
      scheduleEvent();
    });
  }, delay);
}

async function handleRescue(interaction) {
  const farmEvent = activeFarmEvent;

  if (!farmEvent) {
    await interaction.reply({
      content: "No active farm emergency.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (Date.now() > farmEvent.expires) {
    await interaction.reply({
      content: "This farm emergency has already ended.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  if (farmEvent.players.has(interaction.user.id)) {
    await interaction.reply({
      content: "You already attempted this rescue.",
      flags: FLAGS_EPHEMERAL
    });
    return;
  }

  farmEvent.players.add(interaction.user.id);

  let attemptRecorded = false;

  try {
    const wallet = await getWallet(interaction.user.id);

    if (!wallet) {
      farmEvent.players.delete(interaction.user.id);

      await interaction.reply({
        content: "You must verify your wallet first using `/verify`.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    await ensurePlayer(interaction.user.id, wallet);

    const successChance = getSuccessChance(member);
    const success = Math.random() < successChance;
    const reward = success
      ? randomInt(farmEvent.rewardMin, farmEvent.rewardMax)
      : 0;

    await recordRescue(
      interaction.user.id,
      wallet,
      farmEvent.name,
      success,
      reward
    );

    attemptRecorded = true;

    await interaction.reply({
      content: success
        ? `🌾 Farm Rescue Success!\n\nReward: **${reward} $NKFE**`
        : "🛡 Rescue Failed.",
      flags: FLAGS_EPHEMERAL
    });

    try {
      const channel = await client.channels.fetch(FARM_CHANNEL);

      if (channel?.isTextBased()) {
        await channel.send(
          success
            ? `🌾 **FARM RESCUE SUCCESS**\n\nFarmer: **${member.displayName}**\nEvent: **${farmEvent.name}**\nReward: **${reward} $NKFE**`
            : `🛡 **FARM RESCUE FAILED**\n\nFarmer: **${member.displayName}**\nEvent: **${farmEvent.name}**`
        );
      }
    } catch (error) {
      console.error("Failed to announce Farmer Pets rescue result:", error);
    }
  } catch (error) {
    if (!attemptRecorded) {
      farmEvent.players.delete(interaction.user.id);
    }

    throw error;
  }
}

// STATS / LEADERBOARD

async function buildStatsMessage(discordId, displayName) {
  const wallet = await getWallet(discordId);

  if (!wallet) {
    return "No verified wallet found. Please verify your wallet first using `/verify`.";
  }

  await ensurePlayer(discordId, wallet);

  const res = await pool.query(
    "SELECT * FROM farmerpets_balances WHERE discord_id = $1",
    [discordId]
  );

  const row = res.rows[0];
  const attempts = Number(row.total_attempts || 0);
  const successes = Number(row.total_successes || 0);
  const successRate = attempts ? Math.round((successes / attempts) * 100) : 0;

  return (
    `🌾 **Farmer Pets Stats**\n\n` +
    `Farmer: **${displayName}**\n` +
    `Wallet: **${wallet}**\n\n` +
    `Current Payout Owed: **${row.payout_nkfe} $NKFE**\n` +
    `Weekly NKFE Earned: **${row.weekly_nkfe} $NKFE**\n` +
    `Lifetime NKFE Earned: **${row.lifetime_nkfe} $NKFE**\n` +
    `Rescue Attempts: **${attempts}**\n` +
    `Successful Rescues: **${successes}**\n` +
    `Success Rate: **${successRate}%**`
  );
}

async function buildLeaderboardMessage() {
  const res = await pool.query(`
    SELECT discord_id, wallet, weekly_nkfe, weekly_successes, weekly_attempts, lifetime_nkfe
    FROM farmerpets_balances
    WHERE weekly_attempts > 0 OR weekly_nkfe > 0
    ORDER BY weekly_nkfe DESC, weekly_successes DESC, weekly_attempts DESC
    LIMIT 10;
  `);

  if (!res.rows.length) {
    return "🏆 **Farmer Pets Weekly Leaderboard**\n\nNo Farmer Pets rescue activity this week.";
  }

  const lines = res.rows.map((row, index) => {
    return (
      `${index + 1}. <@${row.discord_id}> — ` +
      `**${row.weekly_nkfe} $NKFE** | ` +
      `${row.weekly_successes}/${row.weekly_attempts} successful | ` +
      `Lifetime: ${row.lifetime_nkfe} $NKFE | Wallet: **${row.wallet}**`
    );
  });

  return "🏆 **Farmer Pets Weekly Leaderboard**\n\n" + lines.join("\n");
}

async function postWeeklyLeaderboardAndReset() {
  const channel = await client.channels.fetch(LEADERBOARD_CHANNEL);
  const leaderboard = await buildLeaderboardMessage();

  const payoutRes = await pool.query(`
    SELECT wallet, discord_id, payout_nkfe
    FROM farmerpets_balances
    WHERE payout_nkfe > 0
    ORDER BY payout_nkfe DESC;
  `);

  const totalPayout = payoutRes.rows.reduce(
    (sum, row) => sum + Number(row.payout_nkfe || 0),
    0
  );

  await channel.send(
    `${leaderboard}\n\n` +
    `💰 **Total Farmer Pets NKFE Owed:** ${totalPayout} $NKFE\n\n` +
    `Use **/fp-payouts** for the manual payout list.`
  );

  await pool.query(`
    UPDATE farmerpets_balances
    SET weekly_nkfe = 0,
        weekly_successes = 0,
        weekly_attempts = 0,
        updated_at = NOW();
  `);
}

// COMMANDS

const commands = [
  new SlashCommandBuilder()
    .setName("fp-roles")
    .setDescription("Sync Farmer Pets roles"),

  new SlashCommandBuilder()
    .setName("fp-rescue")
    .setDescription("Join the current farm rescue event"),

  new SlashCommandBuilder()
    .setName("fp-stats")
    .setDescription("Show your Farmer Pets rescue stats"),

  new SlashCommandBuilder()
    .setName("fp-leaderboard")
    .setDescription("Show the Farmer Pets weekly leaderboard"),

  new SlashCommandBuilder()
    .setName("fp-payouts")
    .setDescription("Admin: show Farmer Pets NKFE payouts owed")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-resetpayouts")
    .setDescription("Admin: reset Farmer Pets payout balances after manual payment")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("fp-testevent")
    .setDescription("Admin: manually start a Farmer Pets event")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

client.once("clientReady", async () => {
  console.log(`Farmer Pets Bot online as ${client.user.tag}`);

  try {
    await initDatabase();

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Farmer Pets slash commands registered.");

    scheduleEvent();

    cron.schedule(
      "0 17 * * 0",
      async () => {
        try {
          await postWeeklyLeaderboardAndReset();
        } catch (error) {
          console.error("Failed to post weekly Farmer Pets leaderboard:", error);
        }
      },
      { timezone: "America/Los_Angeles" }
    );

    console.log("Weekly Farmer Pets leaderboard scheduled for Sundays at 5:00 PM Pacific.");
  } catch (error) {
    console.error("Failed during Farmer Pets startup:", error);

    if (error?.code === "28000") {
      console.error(
        "PostgreSQL authentication failed. Check DATABASE_URL on Render and ensure the database role is allowed to log in."
      );
    }

    process.exit(1);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === RESCUE_BUTTON_CUSTOM_ID) {
        await handleRescue(interaction);
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "fp-rescue") {
      await handleRescue(interaction);
      return;
    }

    if (interaction.commandName === "fp-roles") {
      await interaction.deferReply({ flags: FLAGS_EPHEMERAL });

      const wallet = await getWallet(interaction.user.id);

      if (!wallet) {
        await interaction.editReply("Verify your wallet first using `/verify`.");
        return;
      }

      let assetData;

      try {
        assetData = await getAssets(wallet);
      } catch (error) {
        console.error("Failed to fetch Farmer Pets assets:", error);
        await interaction.editReply(
          "Farmer Pets asset services are unavailable right now. No roles were changed; please try again later."
        );
        return;
      }

      const analysis = analyzeAssets(assetData.combinedAssets);
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const roleResult = await syncRoles(member, analysis, wallet, true);

      await interaction.editReply(
        `🌾 **Farmer Pets Role Scan Complete**\n\n` +
        `Wallet: **${wallet}**\n\n` +
        `Wallet NFTs Found: **${assetData.walletAssets.length}**\n` +
        `Staked/In-Game Assets Found: **${assetData.stakedAssets.length}**\n` +
        `Total Assets Evaluated: **${analysis.total}**\n\n` +
        `🥫 Food Assets: **${analysis.food}**\n` +
        `🪵 Wood Assets: **${analysis.wood}**\n` +
        `🥈 Silver Assets: **${analysis.silver}**\n` +
        `🛠️ Tool Assets: **${analysis.tool}**\n\n` +
        `**Roles Added:**\n${roleResult.added.length ? roleResult.added.join("\n") : "None"}\n\n` +
        `**Roles Removed:**\n${roleResult.removed.length ? roleResult.removed.join("\n") : "None"}`
      );
      return;
    }

    if (interaction.commandName === "fp-stats") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const message = await buildStatsMessage(interaction.user.id, member.displayName);

      await interaction.reply({
        content: message,
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-leaderboard") {
      const message = await buildLeaderboardMessage();

      await interaction.reply({
        content: message
      });
      return;
    }

    if (interaction.commandName === "fp-payouts") {
      const res = await pool.query(`
        SELECT wallet, discord_id, payout_nkfe
        FROM farmerpets_balances
        WHERE payout_nkfe > 0
        ORDER BY payout_nkfe DESC;
      `);

      if (!res.rows.length) {
        await interaction.reply({
          content: "No Farmer Pets NKFE payouts owed right now.",
          flags: FLAGS_EPHEMERAL
        });
        return;
      }

      const lines = res.rows.map(row =>
        `${row.wallet} — **${row.payout_nkfe} $NKFE** — <@${row.discord_id}>`
      );

      await interaction.reply({
        content:
          "💰 **Farmer Pets Manual Payout List**\n\n" +
          lines.join("\n") +
          "\n\nAfter manual payment, run `/fp-resetpayouts`.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-resetpayouts") {
      await pool.query(`
        UPDATE farmerpets_balances
        SET payout_nkfe = 0,
            updated_at = NOW();
      `);

      await interaction.reply({
        content: "Farmer Pets payout balances reset to 0. Lifetime stats were preserved.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }

    if (interaction.commandName === "fp-testevent") {
      if (activeFarmEvent) {
        await interaction.reply({
          content: "A Farmer Pets event is already active.",
          flags: FLAGS_EPHEMERAL
        });
        return;
      }

      const started = await startFarmEvent();

      await interaction.reply({
        content: started
          ? "Test Farmer Pets event started."
          : "A Farmer Pets event is already active.",
        flags: FLAGS_EPHEMERAL
      });
      return;
    }
  } catch (error) {
    console.error(error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Something went wrong.");
      } else {
        await interaction.reply({
          content: "Something went wrong.",
          flags: FLAGS_EPHEMERAL
        });
      }
    } catch {
      console.log("Could not send error reply to interaction.");
    }
  }
});

client.login(TOKEN);
