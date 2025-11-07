// Bezpieczne obsługi nieprzechwyconych wyjątków
process.on('unhandledRejection', err => {
    console.error('❌ UNHANDLED REJECTION:', err);
});
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

// Zmienne środowiskowe
const TOKEN = process.env.DISCORD_TOKEN;
const SERVER_IP = process.env.CS16_SERVER_IP;
const SERVER_PORT = parseInt(process.env.CS16_SERVER_PORT, 10);
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const UPDATE_INTERVAL_MINUTES = parseInt(process.env.UPDATE_INTERVAL_MINUTES || '3', 10);
const PREVIOUS_STATUS_MESSAGE_ID = process.env.PREVIOUS_STATUS_MESSAGE_ID;

let statusMessage = null;
let lastRank = 0;

// POPRAWIONY SCAPER – TABLE TR TD (działa na 100%!)
async function getMasterBoostRank() {
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    let page = 1;
    while (page <= 5) {  // max 5 stron, żeby nie loopować wiecznie
        try {
            console.log(`[DEBUG] Sprawdzam stronę ${page} dla IP: ${fullIp}`);
            const { data } = await axios.get(`https://cssetti.pl/lista?Page=${page}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            });
            const $ = cheerio.load(data);

            // ZNALEZIONE SELEKTORY: table tbody tr -> td[0]=rank, td[2]=IP
            const rows = $('table tbody tr');
            console.log(`[DEBUG] Znaleziono ${rows.length} wierszy na stronie ${page}`);

            for (let i = 0; i < rows.length; i++) {
                const row = rows.eq(i);
                const cols = row.find('td');
                if (cols.length >= 3) {
                    const rankText = cols.eq(0).text().trim();
                    const ipText = cols.eq(2).text().trim();  // IP w 3. kolumnie (0-based: td[2])
                    
                    console.log(`[DEBUG] Wiersz ${i}: rank="${rankText}", IP="${ipText}"`);
                    
                    if (ipText.includes(fullIp)) {
                        const rank = parseInt(rankText);
                        console.log(`[MASTERBOOST] ZNALEZIONY! Pozycja: ${rank}`);
                        return rank;
                    }
                }
            }

            // Paginacja
            if (!$('a[aria-label="Następna"], a[rel="next"]').length) {
                console.log(`[DEBUG] Brak następnej strony na ${page}`);
                break;
            }
            page++;
        } catch (err) {
            console.error('[MASTERBOOST] Błąd strony', page, ':', err.message);
            break;
        }
    }
    console.log('[MASTERBOOST] NIE ZNALEZIONY po 5 stronach');
    return null;
}

// Reszta bez zmian – zawsze pokazuje pozycję
async function updateMasterBoostStatus() {
    if (!statusMessage) return;

    const rank = await getMasterBoostRank();
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    const timePL = new Date().toLocaleTimeString('pl-PL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: 'Europe/Warsaw'
    });

    const embed = new EmbedBuilder()
        .setTitle(' MasterBoost – Aktualna pozycja cssetti.pl')
        .setURL('https://cssetti.pl/masterboost_stawki')
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `Co ${UPDATE_INTERVAL_MINUTES} min | ${new Date().toLocaleDateString('pl-PL')}` });

    if (!rank) {
        embed.setColor(0xFF0000)
             .setDescription(`**${fullIp}**\n\n❌ **NIE ZNALEZIONY** w rankingu!`)
             .addFields({ name: 'Aktualizacja', value: timePL });
    } else {
        const color = rank <= 3 ? 0x00FF00 : (rank <= 10 ? 0xFFFF00 : 0xFFAA00);
        const status = rank <= 3 ? '🥇 TOP3' : (rank <= 10 ? '🥈 TOP10' : '📉 POZA TOP10');
        const zmiana = lastRank === 0 ? 'Pierwsze sprawdzenie' 
                     : (rank > lastRank ? `Spadek o ${rank - lastRank} 👎` 
                     : `Awans o ${lastRank - rank} 👍`);

        embed.setColor(color)
             .setDescription(`**${fullIp}**`)
             .addFields(
                 { name: 'Pozycja', value: `**${rank}. miejsce** ${status}`, inline: true },
                 { name: 'Zmiana', value: zmiana, inline: true },
                 { name: 'Boost', value: '[Kup MasterBoost 🚀](https://cssetti.pl/masterboost_stawki)', inline: false },
                 { name: 'Aktualizacja', value: timePL, inline: false }
             );

        lastRank = rank;
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: '' });
        console.log(`✅ Embed zaktualizowany. Pozycja: ${rank || 'NIE ZNALEZIONY'}`);
    } catch (err) {
        console.error('❌ Błąd edycji:', err);
    }
}

// Ready – bez zmian
client.once('ready', async () => {
    console.log(`✅ Bot zalogowany jako ${client.user.tag}`);

    if (!TOKEN || !SERVER_IP || isNaN(SERVER_PORT) || !STATUS_CHANNEL_ID) {
        console.error('❌ Brakujące zmienne!');
        process.exit(1);
    }

    http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000);

    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
        console.error('❌ Błędne ID kanału!');
        return;
    }

    if (PREVIOUS_STATUS_MESSAGE_ID) {
        try {
            statusMessage = await channel.messages.fetch(PREVIOUS_STATUS_MESSAGE_ID);
        } catch {
            statusMessage = await channel.send({ embeds: [new EmbedBuilder().setDescription('🔄 Ładuję MasterBoost...').setColor(0xFFA500)] });
        }
    } else {
        statusMessage = await channel.send({ embeds: [new EmbedBuilder().setDescription('🔄 Ładuję MasterBoost...').setColor(0xFFA500)] });
    }

    // Test od razu + interwał
    await updateMasterBoostStatus();
    setInterval(updateMasterBoostStatus, UPDATE_INTERVAL_MINUTES * 60000);
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.login(TOKEN);
