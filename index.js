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

const FARMER_VERIFIED_ROLE = "1499240994397356112";

const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";
const FARMER_PETS_API = "https://pets-api-main.herokuapp.com";

const CONTRACT_ACCOUNT = "farmerpetssc";

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

async function getWallet(discordId) {
  const res = await pool.query(
    "SELECT wallet FROM verified_wallets WHERE discord_id = $1",
    [discordId]
  );
  return res.rows[0]?.wallet || null;
}

async function getJsonSafe(url) {
  try {
    const res = await fetch(url);
    const json = await res.json();
    return json?.data || json?.rows || [];
  } catch {
    return [];
  }
}

async function getWalletAssets(wallet) {
  const url =
    `${ATOMIC_API}?owner=${wallet}&collection_name=farmerpetsgo&limit=1000`;
  return await getJsonSafe(url);
}

async function getStakedAssets(wallet) {

  const urls = [
    `${FARMER_PETS_API}/api/rows/tools?scope=${CONTRACT_ACCOUNT}&user=${wallet}`,
    `${FARMER_PETS_API}/api/rows/lands?scope=${CONTRACT_ACCOUNT}&user=${wallet}`,
    `${FARMER_PETS_API}/api/rows/pets?user=${wallet}`,
    `${FARMER_PETS_API}/api/rows/items?user=${wallet}`,
    `${FARMER_PETS_API}/api/rows/solarpanels?user=${wallet}`
  ];

  const assets = [];

  for (const url of urls) {
    const rows = await getJsonSafe(url);
    rows.forEach(r => {
      assets.push({
        name: r.name || r.schema_name || "asset",
        data: r
      });
    });
  }

  return assets;
}

async function getAssets(wallet) {

  const walletAssets = await getWalletAssets(wallet);
  const stakedAssets = await getStakedAssets(wallet);

  return [...walletAssets, ...stakedAssets];
}

function analyzeAssets(assets) {

  let food = 0;
  let wood = 0;
  let silver = 0;
  let tool = 0;

  for (const asset of assets) {

    const text = JSON.stringify(asset).toLowerCase();

    if (text.includes("food")) food++;
    if (text.includes("wood")) wood++;
    if (text.includes("silver")) silver++;

    if (
      text.includes("tool") ||
      text.includes("axe") ||
      text.includes("pickaxe") ||
      text.includes("shovel")
    ) tool++;
  }

  const production = food + wood + silver;

  return {
    verified: assets.length > 0,
    food,
    wood,
    silver,
    tool,
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

  const pingRole = `<@&${FARMER_VERIFIED_ROLE}>`;

  await channel.send(

`${pingRole}

${name}

🚨 **A Farm Emergency has started!**

Farmers have **60 seconds** to run **/fp-rescue**

Reward: **${min}-${max} $NKFE**
`
  );

  setTimeout(() => {
    activeFarmEvent = null;
    scheduleEvent();
  }, 60000);
}

function scheduleEvent() {

  const delay = randomInt(
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000
  );

  setTimeout(startFarmEvent, delay);
}

async function handleRescue(interaction) {

  if (!activeFarmEvent) {
    interaction.reply({ content: "No active farm emergency.", ephemeral: true });
    return;
  }

  if (activeFarmEvent.players.has(interaction.user.id)) {
    interaction.reply({ content: "You already attempted.", ephemeral: true });
    return;
  }

  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
    interaction.reply({
      content: "You must verify your wallet first using /verify.",
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  const successChance = getSuccessChance(member);
  const success = Math.random() < successChance;

  const reward = success
    ? randomInt(activeFarmEvent.rewardMin, activeFarmEvent.rewardMax)
    : 0;

  activeFarmEvent.players.add(interaction.user.id);

  interaction.reply({
    content: success
      ? `🌾 Farm Rescue Success! Reward: **${reward} $NKFE**`
      : `🛡 Rescue Failed`,
    ephemeral: true
  });

  const channel = await client.channels.fetch(FARM_CHANNEL);

  channel.send(
    success
      ? `🌾 **FARM RESCUE SUCCESS**

Farmer: **${member.displayName}**
Reward: **${reward} $NKFE**`
      : `🛡 **FARM RESCUE FAILED**

Farmer: **${member.displayName}**`
  );
}

const commands = [

  new SlashCommandBuilder()
    .setName("fp-roles")
    .setDescription("Sync Farmer Pets roles"),

  new SlashCommandBuilder()
    .setName("fp-rescue")
    .setDescription("Join farm rescue event"),

].map(c => c.toJSON());

client.once("ready", async () => {

  console.log(`Farmer Pets Bot running`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  scheduleEvent();
});

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "fp-rescue") {
    handleRescue(interaction);
  }

  if (interaction.commandName === "fp-roles") {

    const wallet = await getWallet(interaction.user.id);

    if (!wallet) {
      interaction.reply({
        content: "Verify wallet first using /verify",
        ephemeral: true
      });
      return;
    }

    const assets = await getAssets(wallet);
    const analysis = analyzeAssets(assets);

    const member = await interaction.guild.members.fetch(interaction.user.id);

    await syncRoles(member, analysis);

    interaction.reply({
      content: "Farmer Pets roles updated.",
      ephemeral: true
    });
  }
});

client.login(TOKEN);
