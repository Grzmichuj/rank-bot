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

// DEFINICJA CLIENTA NA POCZĄTKU
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// POPRAWIONY SCAPER POZYCJI
async function getMasterBoostRank() {
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    let page = 1;
    while (page <= 10) {
        try {
            console.log(`[MASTERBOOST] Sprawdzam stronę ${page}...`);
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
                const ipText = cols.eq(2).text().trim();  // IP w 3. kolumnie

                if (ipText.includes(fullIp)) {
                    const rank = parseInt(rankText);
                    console.log(`[MASTERBOOST] ZNALEZIONO NA POZYCJI ${rank}! IP: ${ipText}`);
                    return rank;
                }
            }

            // paginacja
            const nextPage = $('a[aria-label="Następna"], a[rel="next"]');
            if (!nextPage.length || nextPage.parent().hasClass('disabled')) break;
            page++;
        } catch (err) {
            console.error('[MASTERBOOST] Błąd:', err.message);
            break;
        }
    }
    console.log('[MASTERBOOST] SERWER NIE ZNALEZIONY PO 10 STRONACH');
    return null;
}

// NOWY SCAPER STAWKI REKLAMY – ODCZYTUJE DYNAMICZNIE Z STRONY DLA TWOJEJ POZYCJI
async function getStawkaReklamy(rank) {
    if (!rank) return 'brak';
    try {
        console.log(`[STAWKA] Scrapuję stawkę dla pozycji ${rank}...`);
        const { data } = await axios.get('https://cssetti.pl/masterboost_stawki', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        });
        const $ = cheerio.load(data);

        const rows = $('table tbody tr');
        console.log(`[DEBUG] Znaleziono ${rows.length} wierszy stawek`);

        for (let i = 0; i < rows.length; i++) {
            const cols = rows.eq(i).find('td');
            if (cols.length < 2) continue;

            const posText = cols.eq(0).text().trim();
            const price = cols.eq(1).text().trim();

            // Jeśli pozycja pasuje dokładnie (np. "1" == rank 1)
            if (parseInt(posText) === rank) {
                console.log(`[STAWKA] Znaleziono dla ${rank}: ${price}`);
                return price;
            }
        }

        console.log(`[STAWKA] Nie znaleziono stawki dla pozycji ${rank}`);
        return 'POZA TABLICĄ';
    } catch (err) {
        console.error('[STAWKA] Błąd scrapera:', err.message);
        return 'błąd';
    }
}

// Aktualizacja embedu – ODCZYTUJE STAWKĘ DYNAMICZNIE
async function updateMasterBoostStatus() {
    if (!statusMessage) {
        console.error('statusMessage nie istnieje!');
        return;
    }

    const rank = await getMasterBoostRank();
    const stawka = await getStawkaReklamy(rank);
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    const now = new Date();
    const timePL = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' });
    const datePL = now.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric' });

    const embed = new EmbedBuilder()
        .setColor(rank <= 3 ? 0x00FF00 : 0xFFAA00)
        .setTitle(`MasterBoost - Aktualna pozycja w rankingu [${fullIp}]`)
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `@MCk199\n${datePL} Dziś o ${timePL}` });

    if (!rank) {
        embed.setDescription(`
**Stawka Reklamy:** brak | **Pozycja:** ❌ NIE ZNALEZIONY

**Aktualizacja:** ${timePL}
        `);
    } else {
        embed.setDescription(`
**Stawka Reklamy:** ${stawka} | **Pozycja:** **${rank}. miejsce**

**Aktualizacja:** ${timePL}
        `);
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: '' });
        console.log(`Embed zaktualizowany – pozycja: ${rank || 'NIE'}, stawka: ${stawka}`);
    } catch (err) {
        console.error('Błąd edycji:', err);
    }
}

// READY – bez zmian
client.once('ready', async () => {
    console.log(`Bot ŻYJE jako ${client.user.tag} `);

    if (!TOKEN || !SERVER_IP || isNaN(SERVER_PORT) || !STATUS_CHANNEL_ID) {
        console.error('BRAKUJE ZMIENNYCH ŚRODOWISKOWYCH!');
        process.exit(1);
    }

    http.createServer((req, res) => res.end('OK')).listen(process.env.PORT || 3000);

    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (!channel || !(channel instanceof TextChannel)) throw new Error('Błędne ID kanału');

        if (PREVIOUS_STATUS_MESSAGE_ID) {
            try {
                statusMessage = await channel.messages.fetch(PREVIOUS_STATUS_MESSAGE_ID);
                console.log('Załadano starą wiadomość');
            } catch {
                statusMessage = await channel.send({ embeds: [new EmbedBuilder().setDescription('Inicjuję...').setColor(0xFFA500)] });
            }
        } else {
            statusMessage = await channel.send({ embeds: [new EmbedBuilder().setDescription('Inicjuję MasterBoost...').setColor(0xFFA500)] });
        }

        await updateMasterBoostStatus();
        setInterval(updateMasterBoostStatus, UPDATE_INTERVAL_MINUTES * 60000);
        console.log(`Interwał co ${UPDATE_INTERVAL_MINUTES} min włączony`);
    } catch (err) {
        console.error('Błąd startu:', err);
    }
});

client.login(TOKEN);
