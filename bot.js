// Bezpieczne obsługi wyjątków
process.on('unhandledRejection', err => console.error('❌ UNHANDLED REJECTION:', err));
process.on('uncaughtException', err => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

// Importy
const http = require('http');
const { Client, GatewayIntentBits, TextChannel, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// === STAŁE ===
const TOKEN = process.env.DISCORD_TOKEN;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const UPDATE_INTERVAL_MINUTES = parseInt(process.env.UPDATE_INTERVAL_MINUTES || '3', 10);

const SERVER_IP = '51.83.166.59';
const SERVER_PORT = 27015;
const FULL_IP = `${SERVER_IP}:${SERVER_PORT}`;

let statusMessage = null;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const PING_USER_ID = '533969130433282061';

// ================== HEALTH-CHECK NA NAJWYŻSZYM PRIORYTECIE (PRZED BOTEM!) ==================
const PORT = process.env.PORT || 10000;  // Render default 10000
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HEALTH-CHECK GOTOWY! Nasłuchuję na http://0.0.0.0:${PORT}`);
    console.log(`Deploy na Render powinien przejść OD RAZU!`);
});
// Dodatkowy timeout na wypadek cudów
server.setTimeout(0);

// ================== SCRAPER – Z RETRY + LEPSZE LOGI ==================
async function getOurRank(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        let page = 1;
        while (page <= 20) {
            try {
                console.log(`[MASTERBOOST] Próba ${attempt} – strona ${page}...`);
                const { data } = await axios.get(`https://cssetti.pl/masterboost_stawki?Page=${page}`, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                    },
                    timeout: 45000
                });
                const $ = cheerio.load(data);
                const rows = $('table tbody tr');

                for (let i = 0; i < rows.length; i++) {
                    const cols = rows.eq(i).find('td');
                    if (cols.length < 4) continue;

                    const rankRaw = cols.eq(0).text().trim();
                    const rankMatch = rankRaw.match(/\d+/);
                    const rank = rankMatch ? parseInt(rankMatch[0], 10) : null;

                    const ipText = cols.eq(2).text().trim();

                    if (ipText.includes(FULL_IP)) {
                        console.log(`[MASTERBOOST] 🔥 ZNALEZIONO NA ${rank}. MIEJSCU! IP: ${ipText}`);
                        return rank;
                    }
                }

                const nextBtn = $('a[aria-label="Następna"], a[rel="next"]');
                if (!nextBtn.length || nextBtn.parent().hasClass('disabled')) break;
                page++;
            } catch (err) {
                console.error(`[MASTERBOOST] Błąd (próba ${attempt}): ${err.message}`);
                if (attempt < retries) await new Promise(r => setTimeout(r, 8000));
            }
        }
    }
    console.log('[MASTERBOOST] Serwer poza TOP 20 lub błąd strony');
    return null;
}

// ================== AKTUALIZACJA EMBEDU ==================
async function updateStatus() {
    if (!statusMessage) return console.error('statusMessage brak!');

    const rank = await getOurRank();
    const timePL = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' });

    const embed = new EmbedBuilder()
        .setTitle('🎯 MasterBoost – Aktualna pozycja')
        .setURL('https://cssetti.pl/lista')
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `${new Date().toLocaleDateString('pl-PL')}` });

    let pingContent = '';  // domyślnie nic nie pingujemy

    if (!rank) {
        embed.setColor(0xFF0000).setDescription(`**${FULL_IP}**\n\nSerwer NIE ZNALEZIONY w TOP 20 MasterBoost`);
    } else {
        const color = rank <= 1 ? 0xFFD700 : (rank <= 3 ? 0x00FF00 : (rank <= 10 ? 0xFFFF00 : 0xFFAA00));
        embed.setColor(color)
             .setDescription(`**${FULL_IP}** – Obecnie **${rank}. miejsce!** 🔥`)
             .addFields(
                 { name: 'Pozycja', value: `**${rank}.**`, inline: true },
                 { name: 'Godzina', value: timePL, inline: true }
             );

        if (rank >= 4) {
            pingContent = `<@${PING_USER_ID}> **przebili nas!** Aktualna pozycja → **${rank}.** miejsce`;
        }
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: pingContent, allowedMentions: { parse: ['users'] } });
        console.log(`Embed zaktualizowany – pozycja ${rank || 'brak'} | ping: ${!!pingContent}`);
    } catch (err) {
        console.error('Błąd edycji embedu:', err);
    }
}

// ================== START BOTA ==================
console.log('Loguję bota na Discord...');
client.once('ready', async () => {
    console.log(`Bot ONLINE jako ${client.user.tag}`);

    if (!TOKEN || !STATUS_CHANNEL_ID) {
        console.error('BRAK TOKENÓW W .env!');
        process.exit(1);
    }

    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (!(channel instanceof TextChannel)) throw new Error('Zły kanał');

        statusMessage = await channel.send({
            embeds: [new EmbedBuilder().setDescription('Inicjuję MasterBoost...').setColor(0xFFA500)]
        });

        await updateStatus();
        setInterval(updateStatus, UPDATE_INTERVAL_MINUTES * 60_000);
        console.log(`Interwał co ${UPDATE_INTERVAL_MINUTES} min – start!`);
    } catch (err) {
        console.error('Błąd startu bota:', err);
    }
});

client.login(TOKEN);
