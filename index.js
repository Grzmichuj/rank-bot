const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
require('dotenv').config();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const SERVER_IP = '51.83.166.59:27015';
const CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID; // OBOWIĄZKOWO W ENV NA RENDER!
const INTERVAL = 300000; // 5 minut = 300000 ms
// ==================

if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ BRAK TOKEN LUB CHANNEL_ID W ENV! DODAJ NA RENDER.COM');
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
      const rows = $('table tbody tr');

      for (let row of rows) {
        const cols = $(row).find('td');
        if (cols.length < 6) continue;
        const ip = cols.eq(3).text().trim();
        if (ip.includes(SERVER_IP)) {
          const rankText = cols.eq(0).text().trim().replace('.', '').replace(/\s+/g, '');
          return parseInt(rankText) || null;
        }
      }

      // paginacja
      const nextBtn = $('a[aria-label="Następna"]').parent();
      if (!nextBtn || nextBtn.hasClass('disabled')) break;
      page++;
    } catch (err) {
      console.error('[CSSETTI] Błąd scrapera:', err.message);
      return null;
    }
  }
  return null;
}

// GŁÓWNA PĘTLA
setInterval(async () => {
  const rank = await getCssettiRank();

  if (!rank) {
    console.log(`[CSSETTI] Serwer ${SERVER_IP} NIE ZNALEZIONY W RANKINGU!`);
    return;
  }

  console.log(`[CSSETTI] Aktualna pozycja: ${rank} (było: ${lastRank || 'brak'})`);

  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) {
    console.log('[ERROR] Kanał nie znaleziony! Sprawdź ID.');
    return;
  }

  // ZAWSZE WYSYŁA AKTUALNĄ POZYCJĘ
  const statusEmbed = new EmbedBuilder()
    .setTitle(' Cssetti.pl – Aktualna pozycja serwera')
    .setColor(rank <= 3 ? 0x00ff00 : 0xffff00)
    .setDescription(`**${SERVER_IP}**`)
    .addFields(
      { name: 'Pozycja', value: `**${rank}** ${rank <= 3 ? 'TOP3' : 'POZA TOP3'}`, inline: true },
      { name: 'Zmiana', value: lastRank === 0 ? 'Pierwsze sprawdzenie' : (rank > lastRank ? `Spadek o ${rank - lastRank}` : `Awans o ${lastRank - rank}`), inline: true }
    )
    .setThumbnail('https://cssetti.pl/favicon.ico')
    .setTimestamp()
    .setFooter({ text: 'Sprawdzane co 5 minut | MasterBoost → https://cssetti.pl/masterboost_stawki' });

  await channel.send({ embeds: [statusEmbed] });

  // ALERT TYLKO GDY SPADNIE PONIŻEJ 3.
  if (rank > 3 && lastRank <= 3 && lastRank !== 0) {
    const alertEmbed = new EmbedBuilder()
      .setTitle('⚠️ SPADLIŚMY PONIŻEJ TOP3!')
      .setColor(0xff0000)
      .setDescription(`**${SERVER_IP}** jest teraz na **${rank}. miejscu**!`)
      .addFields(
        { name: 'Czas na boost!', value: '[Kup MasterBoost ](https://cssetti.pl/masterboost_stawki)', inline: false }
      )
      .setTimestamp();

    await channel.send({ content: '@everyone', embeds: [alertEmbed] });
  }

  lastRank = rank;

}, INTERVAL);

// START
client.once('ready', () => {
  console.log(`Bot online jako ${client.user.tag}`);
  console.log(`Wysyła na kanał ID: ${CHANNEL_ID}`);
  console.log(`Sprawdza co ${INTERVAL/60000} minut`);
});

// Keep-alive
const app = express();
app.get('/', (req, res) => res.send('Cssetti bot ŻYJE – pozycja aktualizowana co 5 min'));
app.listen(8080, () => console.log('Keep-alive na porcie 8080'));

client.login(TOKEN);
