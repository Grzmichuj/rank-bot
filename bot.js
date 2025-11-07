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

// DEFINICJA CLIENTA NA POCZĄTKU – TERAZ JUŻ DZIAŁA!
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// POPRAWIONY SCAPER – TABLE TR TD (działa na pozycji 2!)
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
                const ipText = cols.eq(2).text().trim();  // IP jest w 3. kolumnie!

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

// Aktualizacja embedu – ZAWSZE pokazuje pozycję
async function updateMasterBoostStatus() {
    if (!statusMessage) {
        console.error('statusMessage nie istnieje!');
        return;
    }

    const rank = await getMasterBoostRank();
    const fullIp = `${SERVER_IP}:${SERVER_PORT}`;
    const timePL = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Europe/Warsaw' });

    const embed = new EmbedBuilder()
        .setTitle(' MasterBoost – Aktualna pozycja w rankingu')
        .setURL('https://cssetti.pl/masterboost_stawki')
        .setThumbnail('https://cssetti.pl/favicon.ico')
        .setTimestamp()
        .setFooter({ text: `Co ${UPDATE_INTERVAL_MINUTES} min | ${new Date().toLocaleDateString('pl-PL')}` });

    if (!rank) {
        embed.setColor(0xFF0000)
             .setDescription(`**${fullIp}**\n\n Serwer NIE ZNALEZIONY w rankingu cssetti.pl`)
             .addFields({ name: 'Aktualizacja', value: timePL });
    } else {
        const color = rank <= 3 ? 0x00FF00 : (rank <= 10 ? 0xFFFF00 : 0xFFAA00);
        const status = rank <= 3 ? 'TOP3' : (rank <= 10 ? 'TOP10' : 'POZA TOP10');
        const zmiana = lastRank === 0 ? 'Pierwsze sprawdzenie' : (rank > lastRank ? `Spadek o ${rank - lastRank} ` : `Awans o ${lastRank - rank} `);

        embed.setColor(color)
             .setDescription(`**${fullIp}**`)
             .addFields(
                 { name: 'Pozycja', value: `**${rank}. miejsce** ${status}`, inline: true },
                 { name: 'Zmiana', value: zmiana, inline: true },
                 { name: 'Boost', value: '[Kup MasterBoost ](https://cssetti.pl/masterboost_stawki)', inline: false },
                 { name: 'Aktualizacja', value: timePL, inline: false }
             );

        lastRank = rank;
    }

    try {
        await statusMessage.edit({ embeds: [embed], content: '' });
        console.log(`Embed zaktualizowany – pozycja: ${rank || 'NIE ZNALEZIONY'}`);
    } catch (err) {
        console.error('Błąd edycji:', err);
    }
}

// READY – client już zdefiniowany wyżej!
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
