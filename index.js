const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { Pool } = require("pg");
const cron = require("node-cron");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const FARM_CHANNEL = "1270948980615938109";
const LEADERBOARD_CHANNEL = "1499255526054170825";

const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";

const ROLES = {
  verified: "1499240994397356112",
  food: "1499241227097477171",
  wood: "1499241359146487838",
  silver: "1499241567016189972",
  tool: "1499240639655579881",
  workingFarm: "1499242211928182905",
  fullFarm: "1499242342937399508"
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

async function initDatabase() {
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

async function getAssets(wallet) {
  const url = `${ATOMIC_API}?owner=${wallet}&collection_name=farmerpetsgo&limit=1000`;
  const res = await fetch(url);
  const json = await res.json();
  return json.data || [];
}

function analyzeAssets(assets) {
  let food = 0;
  let wood = 0;
  let silver = 0;
  let tool = 0;

  for (const asset of assets) {
    const name =
      (asset.name || "") +
      " " +
      (asset.data?.name || "") +
      " " +
      (asset.template?.immutable_data?.name || "") +
      " " +
      (asset.schema?.schema_name || "");

    const lower = name.toLowerCase();

    if (lower.includes("food") || lower.includes("feed")) food++;
    if (lower.includes("wood")) wood++;
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

  for (const [key, shouldHave] of checks) {
    const roleId = ROLES[key];
    const hasRole = member.roles.cache.has(roleId);

    if (shouldHave && !hasRole) await member.roles.add(roleId);
    if (!shouldHave && hasRole) await member.roles.remove(roleId);
  }
}

function getSuccessChance(member) {
  let chance = 0.4;

  if (member.roles.cache.has(ROLES.food)) chance += 0.05;
  if (member.roles.cache.has(ROLES.wood)) chance += 0.05;
  if (member.roles.cache.has(ROLES.silver)) chance += 0.05;
  if (member.roles.cache.has(ROLES.tool)) chance += 0.10;
  if (member.roles.cache.has(ROLES.fullFarm)) chance += 0.15;

  return Math.min(chance, 0.75);
}

async function startFarmEvent() {
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

  activeFarmEvent = {
    name,
    rewardMin: min,
    rewardMax: max,
    expires: Date.now() + 60000,
    players: new Set()
  };

  const channel = await client.channels.fetch(FARM_CHANNEL);

  await channel.send(
    `${name}\n\n` +
      `Farmers have **60 seconds** to run **/fp-rescue**\n\n` +
      `Reward: **${min}-${max} $NKFE**`
  );

  setTimeout(() => {
    activeFarmEvent = null;
    scheduleEvent();
  }, 60000);
}

function scheduleEvent() {
  const delay = randomInt(2 * 60 * 60 * 1000, 4 * 60 * 60 * 1000);
  console.log(`Next Farmer Pets event in ${Math.round(delay / 60000)} minutes.`);

  setTimeout(() => {
    startFarmEvent();
  }, delay);
}

async function handleRescue(interaction) {
  if (!activeFarmEvent) {
    await interaction.reply({ content: "No active farm emergency.", ephemeral: true });
    return;
  }

  if (Date.now() > activeFarmEvent.expires) {
    await interaction.reply({ content: "This farm emergency has already ended.", ephemeral: true });
    return;
  }

  if (activeFarmEvent.players.has(interaction.user.id)) {
    await interaction.reply({ content: "You already attempted this rescue.", ephemeral: true });
    return;
  }

  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
    await interaction.reply({
      content: "Verify your wallet first using the GetRight Games verification bot.",
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  await ensurePlayer(interaction.user.id, wallet);

  const successChance = getSuccessChance(member);
  const success = Math.random() < successChance;
  const reward = success ? randomInt(activeFarmEvent.rewardMin, activeFarmEvent.rewardMax) : 0;

  activeFarmEvent.players.add(interaction.user.id);

  await recordRescue(interaction.user.id, wallet, activeFarmEvent.name, success, reward);

  await interaction.reply({
    content: success
      ? `🌾 Farm Rescue Success!\n\nReward: **${reward} $NKFE**`
      : "🛡 Rescue Failed.",
    ephemeral: true
  });

  const channel = await client.channels.fetch(FARM_CHANNEL);

  await channel.send(
    success
      ? `🌾 **FARM RESCUE SUCCESS**\n\nFarmer: **${member.displayName}**\nEvent: **${activeFarmEvent.name}**\nReward: **${reward} $NKFE**`
      : `🛡 **FARM RESCUE FAILED**\n\nFarmer: **${member.displayName}**\nEvent: **${activeFarmEvent.name}**`
  );
}

async function buildStatsMessage(discordId, displayName) {
  const wallet = await getWallet(discordId);

  if (!wallet) {
    return "No verified wallet found. Please verify your wallet first using the GetRight Games verification bot.";
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

client.once("ready", async () => {
  console.log(`Farmer Pets Bot online as ${client.user.tag}`);

  await initDatabase();

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands
  });

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
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "fp-rescue") {
      await handleRescue(interaction);
      return;
    }

    if (interaction.commandName === "fp-roles") {
      await interaction.deferReply({ ephemeral: true });

      const wallet = await getWallet(interaction.user.id);

      if (!wallet) {
        await interaction.editReply("Verify your wallet first using the GetRight Games verification bot.");
        return;
      }

      const assets = await getAssets(wallet);
      const analysis = analyzeAssets(assets);
      const member = await interaction.guild.members.fetch(interaction.user.id);

      await syncRoles(member, analysis);

      await interaction.editReply(
        `🌾 Farmer Pets roles updated.\n\n` +
          `NFTs Found: **${analysis.total}**\n` +
          `🥫 Food: **${analysis.food}**\n` +
          `🪵 Wood: **${analysis.wood}**\n` +
          `🥈 Silver: **${analysis.silver}**\n` +
          `🛠️ Tools: **${analysis.tool}**`
      );
      return;
    }

    if (interaction.commandName === "fp-stats") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const message = await buildStatsMessage(interaction.user.id, member.displayName);
      await interaction.reply({ content: message, ephemeral: true });
      return;
    }

    if (interaction.commandName === "fp-leaderboard") {
      const message = await buildLeaderboardMessage();
      await interaction.reply({ content: message, ephemeral: false });
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
        await interaction.reply({ content: "No Farmer Pets NKFE payouts owed right now.", ephemeral: true });
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
        ephemeral: true
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
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "fp-testevent") {
      if (activeFarmEvent) {
        await interaction.reply({ content: "A Farmer Pets event is already active.", ephemeral: true });
        return;
      }

      await startFarmEvent();
      await interaction.reply({ content: "Test Farmer Pets event started.", ephemeral: true });
      return;
    }
  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Something went wrong.");
    } else {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  }
});

client.login(TOKEN);
