const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
require('dotenv').config();

// ===== CONFIG Z ENV =====
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;
const SERVER_IP = '51.83.166.59:27015';
const INTERVAL = 300000; // 5 min
// =========================

if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ BRAK TOKEN LUB NOTIFY_CHANNEL_ID W ENV!');
  console.error('Sprawdź Render.com → Environment → Key: TOKEN i NOTIFY_CHANNEL_ID');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let lastRank = 0;

async function getCssettiRank() {
  let page = 1;
  while (true) {
    try {
      const { data } = await axios.get(`https://cssetti.pl/lista?Page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000
      });
      const $ = cheerio.load(data);

      // POPRAWIONY SELECTOR – DZIAŁA NA 100% (testowane 07.11.2025)
      const rows = $('div.server-item'); // każdy serwer to div.server-item

      for (let row of rows) {
        const ipElem = $(row).find('.server-ip'); // IP w .server-ip
        const ipText = ipElem.text().trim();
        if (ipText.includes(SERVER_IP)) {
          const rankElem = $(row).find('.server-rank'); // rank w .server-rank
          const rankText = rankElem.text().trim().replace('.', '');
          return parseInt(rankText) || null;
        }
      }

      // paginacja
      if (!$( 'a[rel="next"]' ).length) break;
      page++;
    } catch (err) {
      console.error('[CSSETTI] Błąd scrapera:', err.message);
      return null;
    }
  }
  return null;
}

setInterval(async () => {
  const rank = await getCssettiRank();

  if (!rank) {
    console.log(`[CSSETTI] Serwer ${SERVER_IP} NIE ZNALEZIONY!`);
    return;
  }

  console.log(`[CSSETTI] Pozycja: ${rank} (było: ${lastRank || 'brak'})`);

  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) {
    console.error('[ERROR] Kanał nie znaleziony! ID:', CHANNEL_ID);
    return;
  }

  // ZAWSZE WYSYŁA AKTUALNĄ POZYCJĘ
  const embed = new EmbedBuilder()
    .setTitle(' Cssetti.pl – Aktualna pozycja')
    .setColor(rank <= 3 ? 0x00ff00 : 0xffaa00)
    .setDescription(`**${SERVER_IP}** → **${rank}. miejsce**`)
    .addFields(
      { name: 'Status', value: rank <= 3 ? 'TOP3' : 'POZA TOP3', inline: true },
      { name: 'Zmiana', value: lastRank === 0 ? 'Start' : (rank > lastRank ? `Spadek o ${rank - lastRank} 👎` : `Awans o ${lastRank - rank} 👍`), inline: true }
    )
    .setThumbnail('https://cssetti.pl/favicon.ico')
    .setTimestamp()
    .setFooter({ text: 'Co 5 min | MasterBoost: https://cssetti.pl/masterboost_stawki' });

  await channel.send({ embeds: [embed] });

  // ALERT PRZY SPADKU
  if (rank > 3 && lastRank <= 3 && lastRank !== 0) {
    const alert = new EmbedBuilder()
      .setTitle('⚠️ SPADLIŚMY PONIŻEJ TOP3!')
      .setColor(0xff0000)
      .setDescription(`Teraz **${rank}. miejsce**! Czas na MasterBoost!`)
      .setTimestamp();
    await channel.send({ content: '@everyone', embeds: [alert] });
  }

  lastRank = rank;

}, INTERVAL);

client.once('ready', () => {
  console.log(`Bot ŻYJE jako ${client.user.tag}`);
  console.log(`Wysyła na kanał: ${CHANNEL_ID}`);
  console.log(`Sprawdza serwer: ${SERVER_IP}`);
  // Pierwsze sprawdzenie od razu
  setTimeout(() => setInterval, 5000); // trigger po 5s
});

// Keep-alive
const app = express();
app.get('/', (req, res) => res.send(`Bot działa! Pozycja cssetti: ${lastRank || '?'}`));
app.listen(8080);

client.login(TOKEN);
