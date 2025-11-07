// Bezpieczne obsługi wyjątków
process.on('unhandledRejection', err => console.error('❌ UNHANDLED REJECTION:', err));
process.on('uncaughtException', err => {
    console.error('❌ UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

// Importy
const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
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

// Client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// SCAPER TYLKO TWOJEGO SERWERA ZOMBIE+EXP
async function getMyServerRank() {
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    let page = 1;
    while (page <= 10) {
        try {
            console.log(`[ZOMBIE+EXP] Sprawdzam stronę ${page}...`);
            const { data } = await axios.get(`https://cssetti.pl/lista?Page=${page}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            });
            const $ = cheerio.load(data);

            const rows = $('table tbody tr');
            console.log(`[DEBUG] Znaleziono ${rows.length} serwerów na stronie ${page}`);

            for (let i = 0; i < rows.length; i++) {
                const cols = rows.eq(i).find('td');
                if (cols.length < 4) continue;

                const rankText = cols.eq(0).text().trim().replace('.', '');
                const ipText = cols.eq(2).text().trim();

                if (ipText.includes(fullIp)) {
                    const rank = parseInt(rankText);
                    console.log(`[ZOMBIE+EXP] TWÓJ SERWER NA POZYCJI ${rank}! IP: ${ipText}`);
                    return rank;
                }
            }

            const nextPage = $('a[aria-label="Następna"], a[rel="next"]');
            if (!nextPage.length || nextPage.parent().hasClass('disabled')) break;
            page++;
        } catch (err) {
            console.error('[ZOMBIE+EXP] Błąd:', err.message);
            break;
        }
    }
    console.log('[ZOMBIE+EXP] TWÓJ SERWER NIE ZNALEZIONY');
    return null;
}

// Aktualizacja – TYLKO POZYCJA TWOJEGO SERWERA, ZWYKŁA WIADOMOŚĆ
async function updateStatus() {
    if (!statusMessage) return;

    const rank = await getMyServerRank();
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    const now = new Date();
    const timePL = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' });
    const datePL = now.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric' });

    const message = `MasterBoost - Aktualna pozycja w rankingu [${fullIp}]\n\nPozycja: ${rank ? rank + '. miejsce' : 'NIE ZNALEZIONY'}\n\nAktualizacja: ${timePL}\n\n@MCk199 ${datePL}`;

    try {
        await statusMessage.edit({ content: message, embeds: [] });
        console.log(`Wiadomość zaktualizowana – TWOJA POZYCJA: ${rank || 'NIE ZNALEZIONY'}`);
    } catch (err) {
        console.error('Błąd edycji:', err);
    }
}

// Ready
client.once('ready', async () => {
    console.log(`Bot ŻYJE jako ${client.user.tag}`);

    if (!TOKEN || !SERVER_IP || isNaN(SERVER_PORT) || !STATUS_CHANNEL_ID) {
        console.error('BRAKUJE ZMIENNYCH!');
        process.exit(1);
    }

    http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000);

    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (!channel) throw new Error('Błędne ID kanału');

        if (PREVIOUS_STATUS_MESSAGE_ID) {
            try {
                statusMessage = await channel.messages.fetch(PREVIOUS_STATUS_MESSAGE_ID);
            } catch {
                statusMessage = await channel.send('Inicjuję Zombie+EXP...');
            }
        } else {
            statusMessage = await channel.send('Inicjuję Zombie+EXP...');
        }

        await updateStatus();
        setInterval(updateStatus, UPDATE_INTERVAL_MINUTES * 60000);
        console.log(`Interwał co ${UPDATE_INTERVAL_MINUTES} min`);
    } catch (err) {
        console.error('Błąd startu:', err);
    }
});

client.login(TOKEN);
