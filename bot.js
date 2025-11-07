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

// ================== SCRAPER – BARDZIEJ NIEZAWODNY ==================
async function getOurRank() {
    let page = 1;
    while (page <= 20) {
        try {
            console.log(`[MASTERBOOST] Sprawdzam stronę ${page}...`);
            const { data } = await axios.get(`https://cssetti.pl/masterboost_stawki?Page=${page}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 20000  // dłuższy timeout
            });
            const $ = cheerio.load(data);
            const rows = $('table tbody tr');

            console.log(`[DEBUG] Znaleziono ${rows.length} wierszy na stronie ${page}`);

            for (let i = 0; i < rows.length; i++) {
                const cols = rows.eq(i).find('td');
                if (cols.length < 4) continue;

                // Lepszy parsing pozycji – bierzemy surowy tekst i wyciągamy liczbę
                const rankRaw = cols.eq(0).text().trim();
                const rankMatch = rankRaw.match(/\d+/);  // tylko cyfry
                const rank = rankMatch ? parseInt(rankMatch[0], 10) : null;

                const ipText = cols.eq(2).text().trim();

                if (ipText.includes(FULL_IP)) {
                    console.log(`[MASTERBOOST] ZNALEZIONO! Pozycja: ${rank} | Surowy rank: "${rankRaw}" | IP: ${ipText}`);
                    return rank;
                }
            }

            // paginacja
            const nextBtn = $('a[aria-label="Następna"], a[rel="next"]');
            if (!nextBtn.length || nextBtn.parent().hasClass('disabled')) {
                console.log('[MASTERBOOST] Ostatnia strona.');
                break;
            }
            page++;
        } catch (err) {
            console.error(`[MASTERBOOST] Błąd na stronie ${page}:`, err.message);
            break;
        }
    }
    console.log('[MASTERBOOST] SERWER NIE ZNALEZIONY');
    return null;
}

// ================== AKTUALIZACJA EMBEDU ==================
async function updateStatus() {
    if (!statusMessage) {
        console.error('statusMessage nie istnieje!');
        return;
    }

    const rank = await getOurRank();
    const timePL = new Date().toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Europe/Warsaw'
    });

    const embed = new EmbedBuilder()
        .setTitle(' MasterBoost – Aktualna pozycja')
        .setURL('https://cssetti.pl/lista')
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `${new Date().toLocaleDateString('pl-PL')}` });

    if (!rank) {
        embed.setColor(0xFF0000)
             .setDescription(`**${FULL_IP}**\n\nSerwer NIE ZNALEZIONY w rankingu cssetti.pl`);
    } else {
        const color = rank <= 3 ? 0x00FF00 : (rank <= 10 ? 0xFFFF00 : 0xFFAA00);
        embed.setColor(color)
             .setDescription(`**${FULL_IP}**`)
             .addFields(
                 { name: 'Pozycja', value: `**${rank}. miejsce**`, inline: true },
                 { name: 'Aktualizacja', value: timePL, inline: true }
             );
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: '' });
        console.log(`Embed zaktualizowany – pozycja: ${rank || 'NIE ZNALEZIONY'}`);
    } catch (err) {
        console.error('Błąd edycji:', err);
    }
}

// ================== START BOTA ==================
client.once('ready', async () => {
    console.log(`Bot żyje jako ${client.user.tag}`);

    if (!TOKEN || !STATUS_CHANNEL_ID) {
        console.error('BRAK DISCORD_TOKEN lub STATUS_CHANNEL_ID w .env!');
        process.exit(1);
    }

    http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000);

    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (!(channel instanceof TextChannel)) throw new Error('Kanał nie jest tekstowy');

        statusMessage = await channel.send({
            embeds: [new EmbedBuilder()
                .setDescription('Inicjuję MasterBoost...')
                .setColor(0xFFA500)]
        });
        console.log('Wysłano nową wiadomość statusu');

        await updateStatus();
        setInterval(updateStatus, UPDATE_INTERVAL_MINUTES * 60_000);
        console.log(`Interwał co ${UPDATE_INTERVAL_MINUTES} min włączony`);
    } catch (err) {
        console.error('Błąd startu:', err);
    }
});

client.login(TOKEN);
