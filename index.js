const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { Pool } = require("pg");

// ENV VARIABLES
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

// CHANNEL ID
const FARM_CHANNEL = "1270948980615938109";

// AtomicAssets API
const ATOMIC_API = "https://wax.api.atomicassets.io/atomicassets/v1/assets";

// Farmer Pets Roles
const ROLES = {
 verified: "1499240994397356112",
 food: "1499241227097477171",
 wood: "1499241359146487838",
 silver: "1499241567016189972",
 tool: "1499240639655579881",
 workingFarm: "1499242211928182905",
 fullFarm: "1499242342937399508"
};

// DATABASE
const pool = new Pool({
 connectionString: DATABASE_URL,
 ssl: { rejectUnauthorized: false }
});

// DISCORD CLIENT
const client = new Client({
 intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ACTIVE EVENT
let activeFarmEvent = null;

function randomInt(min, max) {
 return Math.floor(Math.random() * (max - min + 1)) + min;
}

// GET WALLET FROM DATABASE
async function getWallet(discordId) {
 const res = await pool.query(
  "SELECT wallet FROM verified_wallets WHERE discord_id = $1",
  [discordId]
 );
 return res.rows[0]?.wallet || null;
}

// GET NFTS
async function getAssets(wallet) {

 const url = `${ATOMIC_API}?owner=${wallet}&collection_name=farmerpetsgo&limit=1000`;

 const res = await fetch(url);
 const json = await res.json();

 return json.data || [];
}

// ANALYZE NFTS
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

// SYNC ROLES
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

// SUCCESS CHANCE
function getSuccessChance(member) {

 let chance = 0.4;

 if (member.roles.cache.has(ROLES.food)) chance += 0.05;
 if (member.roles.cache.has(ROLES.wood)) chance += 0.05;
 if (member.roles.cache.has(ROLES.silver)) chance += 0.05;
 if (member.roles.cache.has(ROLES.tool)) chance += 0.10;
 if (member.roles.cache.has(ROLES.fullFarm)) chance += 0.15;

 return Math.min(chance, 0.75);
}

// START EVENT
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
  rewardMin: min,
  rewardMax: max,
  expires: Date.now() + 60000,
  players: new Set()
 };

 const channel = await client.channels.fetch(FARM_CHANNEL);

 channel.send(
`${name}

Farmers have **60 seconds** to run **/fp-rescue**

Reward: **${min}-${max} $NKFE**`
 );

 setTimeout(() => {
  activeFarmEvent = null;
  scheduleEvent();
 }, 60000);
}

// EVENT TIMER
function scheduleEvent() {

 const delay = randomInt(
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000
 );

 setTimeout(() => {
  startFarmEvent();
 }, delay);
}

// RESCUE COMMAND
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
  interaction.reply({ content: "Verify wallet first.", ephemeral: true });
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

// SLASH COMMANDS
const commands = [

 new SlashCommandBuilder()
  .setName("fp-roles")
  .setDescription("Sync Farmer Pets roles"),

 new SlashCommandBuilder()
  .setName("fp-rescue")
  .setDescription("Join farm rescue event")

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
   interaction.reply({ content: "Verify wallet first.", ephemeral: true });
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
