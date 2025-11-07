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

// Inicjalizacja klienta Discorda (TO BYŁO BRAK!)
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Scraper pozycji MasterBoost
async function getMasterBoostRank() {
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    let page = 1;
    while (true) {
        try {
            const { data } = await axios.get(`https://cssetti.pl/lista?Page=${page}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 15000
            });
            const $ = cheerio.load(data);

            const servers = $('div.server-item');
            for (let server of servers) {
                const ipText = $(server).find('.server-ip').text().trim();
                if (ipText.includes(fullIp)) {
                    const rankText = $(server).find('.server-rank').text().trim().replace('.', '');
                    return parseInt(rankText) || null;
                }
            }

            if (!$('a[rel="next"]').length) break;
            page++;
        } catch (err) {
            console.error('[MASTERBOOST] Błąd:', err.message);
            return null;
        }
    }
    return null;
}

// Aktualizacja – ZAWSZE pokazuje pozycję
async function updateMasterBoostStatus() {
    if (!statusMessage) return;

    const rank = await getMasterBoostRank();
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    const timePL = new Date().toLocaleTimeString('pl-PL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: 'Europe/Warsaw'
    });

    const embed = new EmbedBuilder()
        .setTitle(' MasterBoost – Aktualna pozycja w rankingu cssetti.pl')
        .setURL('https://cssetti.pl/masterboost_stawki')
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `Co ${UPDATE_INTERVAL_MINUTES} min | ${new Date().toLocaleDateString('pl-PL')}` });

    if (!rank) {
        embed.setColor(0xFF0000)
             .setDescription(`**${fullIp}**\n\nSerwer **nie znaleziony** w rankingu!`)
             .addFields({ name: 'Aktualizacja', value: timePL });
        console.log('⚠️ Serwer nie znaleziony w rankingu cssetti.pl');
    } else {
        const color = rank <= 3 ? 0x00FF00 : (rank <= 10 ? 0xFFFF00 : 0xFFAA00);
        const status = rank <= 3 ? 'TOP3' : (rank <= 10 ? 'TOP10' : 'POZA TOP10');
        const zmiana = lastRank === 0 ? 'Pierwsze sprawdzenie' 
                     : (rank > lastRank ? `Spadek o ${rank - lastRank} 👎` 
                     : `Awans o ${lastRank - rank} 👍`);

        embed.setColor(color)
             .setDescription(`**${fullIp}**`)
             .addFields(
                 { name: 'Pozycja', value: `**${rank}. miejsce** ${status}`, inline: true },
                 { name: 'Zmiana', value: zmiana, inline: true },
                 { name: 'MasterBoost', value: '[Kup stawki tutaj 🚀](https://cssetti.pl/masterboost_stawki)', inline: false },
                 { name: 'Aktualizacja', value: timePL, inline: false }
             );

        console.log(`✅ Pozycja MasterBoost: ${rank} (było: ${lastRank || 'brak'})`);
        lastRank = rank;
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: '' });
    } catch (err) {
        console.error('❌ Błąd edycji wiadomości:', err);
    }
}

// Ready
client.once('ready', async () => {
    console.log(`✅ Bot zalogowany jako ${client.user.tag}`);

    if (!TOKEN || !SERVER_IP || isNaN(SERVER_PORT) || !STATUS_CHANNEL_ID) {
        console.error('❌ Brakujące zmienne!');
        process.exit(1);
    }

    // Keep-alive HTTP
    http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000);

    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
        console.error('❌ Błędne ID kanału!');
        return;
    }

    // Wiadomość statusu
    if (PREVIOUS_STATUS_MESSAGE_ID) {
        try {
            statusMessage = await channel.messages.fetch(PREVIOUS_STATUS_MESSAGE_ID);
        } catch {
            statusMessage = await channel.send({
                embeds: [new EmbedBuilder().setDescription('Inicjuję MasterBoost...').setColor(0xFFA500)]
            });
        }
    } else {
        statusMessage = await channel.send({
            embeds: [new EmbedBuilder().setDescription('Inicjuję MasterBoost...').setColor(0xFFA500)]
        });
    }

    // Pierwsze sprawdzenie + interwał
    await updateMasterBoostStatus();
    setInterval(updateMasterBoostStatus, UPDATE_INTERVAL_MINUTES * 60000);
});

client.login(TOKEN);
