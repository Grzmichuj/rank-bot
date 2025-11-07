const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
require('dotenv').config();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const SERVER_IP = '51.83.166.59:27015';
const CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID || 'TU_WPISZ_ID_KANALU';
const INTERVAL = 300000; // 5 minut
// ==================

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

let lastRank = 0;

async function getCssettiRank() {
  let page = 1;
  while (true) {
    try {
      const { data } = await axios.get(`https://cssetti.pl/lista?Page=${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });
      const $ = cheerio.load(data);
      const rows = $('table tbody tr');

      for (let i = 0; i < rows.length; i++) {
        const cols = $(rows[i]).find('td');
        if (cols.length < 6) continue;
        const ip = $(cols[3]).text().trim();
        if (ip.includes(SERVER_IP)) {
          const rankText = $(cols[0]).text().trim().replace('.', '');
          return parseInt(rankText) || null;
        }
      }

      // paginacja
      const nextPage = $('a[aria-label="Następna"]').parent();
      if (!nextPage || nextPage.hasClass('disabled')) break;
      page++;
    } catch (err) {
      console.error('[CSSETTI] Błąd scrapera:', err.message);
      return null;
    }
  }
  return null;
}

// Główna pętla co 5 minut
setInterval(async () => {
  const rank = await getCssettiRank();
  if (!rank) {
    console.log(`[CSSETTI] Serwer ${SERVER_IP} nie znaleziony w rankingu.`);
    return;
  }

  console.log(`[CSSETTI] Aktualna pozycja: ${rank} (było: ${lastRank || '≤3'})`);

  if (rank > 3 && lastRank <= 3) {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️ SPADLIŚMY PONIŻEJ TOP3 NA CSSETTI!')
        .setColor(0xff0000)
        .setDescription(`**Serwer:** ${SERVER_IP}`)
        .addFields(
          { name: 'Aktualna pozycja', value: `**${rank}** 👎`, inline: true },
          { name: 'Było', value: `**${lastRank || '≤3'}**`, inline: true },
          { name: 'Czas na boost!', value: '[Kup MasterBoost 🚀](https://cssetti.pl/masterboost_stawki)', inline: false }
        )
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp();

      await channel.send({ content: '@everyone', embeds: [embed] });
    }
  }

  lastRank = rank;
}, INTERVAL);

client.once('ready', () => {
  console.log(`Bot online jako ${client.user.tag} | Alert co ${INTERVAL/60000} min`);
});

// Keep-alive dla Render.com (free tier)
const app = express();
app.get('/', (req, res) => res.send('Cssetti bot żyje! 🚀'));
app.listen(8080, () => console.log('Keep-alive na 8080'));

client.login(TOKEN);