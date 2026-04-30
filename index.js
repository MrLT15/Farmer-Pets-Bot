const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { Pool } = require("pg");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const FARMER_PETS_CHANNEL_ID = process.env.FARMER_PETS_CHANNEL_ID;

const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";

// Farmer Pets Role IDs
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
   (asset.data?.name || "") +
   (asset.template?.immutable_data?.name || "");

  const lower = name.toLowerCase();

  if (lower.includes("food") || lower.includes("feed")) food++;
  if (lower.includes("wood")) wood++;
  if (lower.includes("silver")) silver++;

  if (
   lower.includes("tool") ||
   lower.includes("axe") ||
   lower.includes("pickaxe") ||
   lower.includes("shovel") ||
   lower.includes("hammer")
  ) tool++;
 }

 const production = food + wood + silver;

 return {
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

  if (shouldHave && !hasRole) {
   await member.roles.add(roleId);
  }

  if (!shouldHave && hasRole) {
   await member.roles.remove(roleId);
  }
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

 let type = "common";
 let min = 1;
 let max = 5;
 let name = "🐛 Pest Swarm";

 if (roll <= 5) {
  type = "legendary";
  min = 10;
  max = 25;
  name = "🌾 Legendary Harvest Crisis";
 } else if (roll <= 25) {
  type = "rare";
  min = 5;
  max = 10;
  name = "⚠️ Rare Infestation";
 }

 activeFarmEvent = {
  type,
  rewardMin: min,
  rewardMax: max,
  expires: Date.now() + 60000,
  players: new Set()
 };

 const channel = await client.channels.fetch(FARMER_PETS_CHANNEL_ID);

 await channel.send(
  `${name}

Farmers have **60 seconds** to run **/fp-rescue**

Reward: **${min}-${max} $NKFE**`
 );

 setTimeout(() => {
  activeFarmEvent = null;
  scheduleEvent();
 }, 60000);
}

function scheduleEvent() {

 const delay = randomInt(2 * 60 * 60 * 1000, 4 * 60 * 60 * 1000);

 setTimeout(() => {
  startFarmEvent();
 }, delay);
}

async function handleRescue(interaction) {

 if (!activeFarmEvent || Date.now() > activeFarmEvent.expires) {
  await interaction.reply({
   content: "No active farm emergency.",
   ephemeral: true
  });
  return;
 }

 if (activeFarmEvent.players.has(interaction.user.id)) {
  await interaction.reply({
   content: "You already attempted this rescue.",
   ephemeral: true
  });
  return;
 }

 const wallet = await getWallet(interaction.user.id);

 if (!wallet) {
  await interaction.reply({
   content: "Please verify your wallet first.",
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

 await interaction.reply({
  content: success
   ? `🌾 Farm Rescue Success!

Reward: **${reward} $NKFE**`
   : "🛡 Rescue Failed.",
  ephemeral: true
 });

 const channel = await client.channels.fetch(FARMER_PETS_CHANNEL_ID);

 await channel.send(
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
  .setDescription("Join the current farm rescue event")

].map(cmd => cmd.toJSON());

client.once("ready", async () => {

 console.log(`Farmer Pets Bot online`);

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
  await handleRescue(interaction);
 }

 if (interaction.commandName === "fp-roles") {

  const wallet = await getWallet(interaction.user.id);

  if (!wallet) {
   interaction.reply({
    content: "Verify your wallet first.",
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
