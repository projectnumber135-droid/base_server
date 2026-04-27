// MUST BE AT TOP: The Global Hammer
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const axios = require('axios');
const https = require('https');
const { sendHealthAlert } = require('./telegram');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
// Using 127.0.0.1 is more stable for internal checks on Windows
const SERVER_URLS = ['https://127.0.0.1:443'];
const SERVER_NAME = 'File Server (Windows VM)';

let wasDown = false;

// THE ULTIMATE FIX: This silences the "Hostname/IP does not match" error specifically
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined,
});

async function checkHealth() {
    console.log(`[${new Date().toLocaleString()}] Health check starting...`);
    let allUp = true;
    let errorMessages = [];

    for (const url of SERVER_URLS) {
        try {
            await axios.get(url, {
                timeout: 10000,
                validateStatus: () => true,
                httpsAgent: httpsAgent
            });
            console.log(`✅ ${url} is online.`);
        } catch (error) {
            allUp = false;
            errorMessages.push(`❌ ${url} is DOWN: ${error.message}`);
        }
    }

    if (!allUp) {
        const fullMessage = errorMessages.join('\n');
        console.log('Failure detected. Alerting Telegram...');
        await sendHealthAlert(false, fullMessage);
        wasDown = true;
    } else if (wasDown) {
        console.log('Recovery detected. Alerting Telegram...');
        await sendHealthAlert(true, 'All systems are operational again.');
        wasDown = false;
    }
}

checkHealth();
setInterval(checkHealth, CHECK_INTERVAL_MS);