import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";
import crypto from "crypto";
import http from "http";

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  // Discord
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  ALLOWED_CHANNEL_NAME: process.env.ALLOWED_CHANNEL || "core-members-office-access", // channel name or ID

  // SwitchBot API v1.1
  SWITCHBOT_TOKEN: process.env.SWITCHBOT_TOKEN,
  SWITCHBOT_SECRET: process.env.SWITCHBOT_SECRET,
  SWITCHBOT_DEVICE_ID: process.env.SWITCHBOT_DEVICE_ID,

  // What command to send: "turnOn", "turnOff", or "press"
  // For a Bot (physical button presser), "press" is most common.
  // For a Plug Mini, use "turnOn" / "turnOff" / "toggle".
  SWITCHBOT_COMMAND: process.env.SWITCHBOT_COMMAND || "press",
};

// ─── SwitchBot API v1.1 Auth ─────────────────────────────────────
function makeSwitchBotHeaders() {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const data = CONFIG.SWITCHBOT_TOKEN + t + nonce;

  const signature = crypto
    .createHmac("sha256", CONFIG.SWITCHBOT_SECRET)
    .update(data)
    .digest("base64");

  return {
    Authorization: CONFIG.SWITCHBOT_TOKEN,
    sign: signature,
    nonce: nonce,
    t: t,
    "Content-Type": "application/json",
  };
}

// ─── Send command to SwitchBot ───────────────────────────────────
async function activateSwitchBot() {
  const url = `https://api.switch-bot.com/v1.1/devices/${CONFIG.SWITCHBOT_DEVICE_ID}/commands`;

  const body = {
    command: CONFIG.SWITCHBOT_COMMAND,
    parameter: "default",
    commandType: "command",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: makeSwitchBotHeaders(),
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (json.statusCode !== 100) {
    throw new Error(`SwitchBot API error: ${json.statusCode} – ${json.message}`);
  }

  return json;
}

// ─── Helper: list devices (run once to find your device ID) ──────
async function listDevices() {
  const url = "https://api.switch-bot.com/v1.1/devices";
  const res = await fetch(url, {
    method: "GET",
    headers: makeSwitchBotHeaders(),
  });
  const json = await res.json();
  console.log("\n📋 Your SwitchBot devices:\n");
  for (const d of json.body.deviceList) {
    console.log(`  ${d.deviceName} — ID: ${d.deviceId} (${d.deviceType})`);
  }
  console.log();
  return json;
}

// ─── Discord Bot ─────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`👂 Listening for pings in #${CONFIG.ALLOWED_CHANNEL_NAME}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Check if the bot was mentioned
  if (!message.mentions.has(client.user)) return;

  // Check channel — matches by name OR by ID
  const channel = message.channel;
  const isAllowed =
    channel.name === CONFIG.ALLOWED_CHANNEL_NAME ||
    channel.id === CONFIG.ALLOWED_CHANNEL_NAME;

  if (!isAllowed) {
    await message.reply("⛔ I only respond to pings in the designated channel.");
    return;
  }

  // Activate the SwitchBot
  try {
    await message.react("⏳");
    const result = await activateSwitchBot();
    await message.reactions.removeAll().catch(() => {});
    await message.react("✅");
    await message.reply(`🤖 SwitchBot activated! (command: \`${CONFIG.SWITCHBOT_COMMAND}\`)`);
    console.log(`[${new Date().toISOString()}] Activated by ${message.author.tag} in #${channel.name}`);
  } catch (err) {
    await message.reactions.removeAll().catch(() => {});
    await message.react("❌");
    await message.reply(`⚠️ Failed to activate SwitchBot: ${err.message}`);
    console.error("SwitchBot error:", err);
  }
});

// ─── Startup ─────────────────────────────────────────────────────
// If run with --list-devices flag, just print devices and exit
if (process.argv.includes("--list-devices")) {
  listDevices()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.log("Token exists:", !!CONFIG.DISCORD_TOKEN);
  http.createServer((_, res) => res.end("ok")).listen(process.env.PORT || 3000);
  client.login(CONFIG.DISCORD_TOKEN);
}
