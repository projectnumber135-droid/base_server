const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, exec } = require('child_process');
const dotenv = require('dotenv');

// Utility to escape HTML special characters for Telegram messages
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Use absolute path for .env to ensure it works even when started as a service
const envPath = 'c:/FileServer/.env';
dotenv.config({ path: envPath });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

console.log('📬 Telegram module loaded. Token present:', !!BOT_TOKEN);
const PM2_HOME = 'c:/FileServer/pm2';

/**
 * Sends a message to the configured Telegram chat.
 * @param {string} message - The message text to send.
 */
async function sendTelegramMsg(message) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('⚠️ Telegram credentials not configured in .env');
        return;
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    try {
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        return true;
    } catch (error) {
        if (error.response) {
            console.error('❌ Telegram API Error:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('❌ Request Error:', error.message);
        }
        return false;
    }
}

/**
 * Sends a document/file to the configured Telegram chat.
 * @param {string} filePath - Path to the file.
 * @param {string} caption - Optional caption.
 */
async function sendTelegramFile(filePath, caption = '') {
    if (!BOT_TOKEN || !CHAT_ID) return;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;

    try {
        const fileName = path.basename(filePath);
        const fileBuffer = fs.readFileSync(filePath);

        // Using Node 22+ native FormData and Blob
        const formData = new FormData();
        formData.append('chat_id', CHAT_ID);
        formData.append('caption', caption);

        const blob = new Blob([fileBuffer]);
        formData.append('document', blob, fileName);

        await axios.post(url, formData);
    } catch (error) {
        console.error('❌ Telegram File Send Error:', error.message);
    }
}

// --- Specialized Notification Helpers ---

async function sendStartupMsg() {
    let success = false;
    let attempts = 0;

    while (!success && attempts < 30) { // Retry for up to 2.5 minutes
        attempts++;
        try {
            let ip = 'Unknown';
            try {
                const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
                ip = response.data.ip;
            } catch (err) {
                // If we can't even hit ipify, the network is likely still down
                throw new Error('Network not ready');
            }

            const password = 'hZ!~xh5tj(<5:W=';
            const sent = await sendTelegramMsg('GcpVm:\n🚀 VM Boot Successful\nUB-STUDIOZ File Server is now online.');

            if (sent) {
                await sendTelegramMsg(ip);
                await sendTelegramMsg(password);
                await sendStatusReport();

                // Create and send RDP file
                if (ip !== 'Unknown') {
                    try {
                        const rdpContent = `full address:s:${ip}\nusername:s:atjson_com\n# Password: ${password}`;
                        const rdpName = `instance-${new Date().toISOString().split('T')[0]}.rdp`;
                        const rdpPath = path.join(__dirname, rdpName);

                        fs.writeFileSync(rdpPath, rdpContent);
                        await sendTelegramFile(rdpPath, `🖥️ RDP File for ${ip}`);
                        if (fs.existsSync(rdpPath)) fs.unlinkSync(rdpPath);
                    } catch (err) {
                        console.error('❌ RDP Generation Error:', err.message);
                    }
                }
                success = true;
                console.log('🚀 Startup notification sent successfully.');
            } else {
                throw new Error('Telegram send failed');
            }
        } catch (err) {
            console.log(`📡 Waiting for network/Telegram (Attempt ${attempts})...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function sendShutdownMsg(signal) {
    return sendTelegramMsg(`🛑 <b>Server Stopping</b>\nSignal: <code>${escapeHTML(signal)}</code>`);
}

async function sendUploadAlert(filename, size, ip) {
    const formattedSize = (size / (1024 * 1024)).toFixed(2) + ' MB';
    return sendTelegramMsg(`📤 <b>New Upload</b>\n📄 File: <code>${escapeHTML(filename)}</code>\n⚖️ Size: <code>${formattedSize}</code>\n📍 IP: <code>${escapeHTML(ip)}</code>`);
}

async function sendActionAlert(method, path, ip) {
    return sendTelegramMsg(`⚡ <b>Action</b>: <code>${escapeHTML(method)} ${escapeHTML(path)}</code>\n📍 IP: <code>${escapeHTML(ip)}</code>`);
}

async function sendHealthAlert(isUp, details) {
    const emoji = isUp ? '✅' : '🚨';
    const status = isUp ? 'RECOVERED' : 'DOWN';
    return sendTelegramMsg(`${emoji} <b>Health Check ${status}</b>\n${escapeHTML(details)}`);
}

async function sendVisitAlert(ip, isExit = false) {
    const action = isExit ? '👋 <b>User Left</b>' : '👁️ <b>Page Opened</b>';
    return sendTelegramMsg(`${action}\n📍 IP: <code>${escapeHTML(ip)}</code>`);
}

const pm2 = require('pm2');

// Ensure PM2 uses TCP instead of pipes to avoid EPERM on Windows
process.env.PM2_HOME = 'c:/FileServer/pm2';
process.env.PM2_RPC_PORT = '43554';
process.env.PM2_PUB_PORT = '43555';

/**
 * Utility to run PM2 commands programmatically
 */
function runPm2Command(action, target = null) {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) return reject(err);

            const callback = (err, result) => {
                pm2.disconnect();
                if (err) return reject(err);
                resolve(result);
            };

            if (action === 'list') pm2.list(callback);
            else if (action === 'restart') pm2.restart(target || 'all', callback);
            else if (action === 'stop') pm2.stop(target || 'all', callback);
            else {
                pm2.disconnect();
                reject(new Error('Unknown action'));
            }
        });
    });
}

// ─── Status Report ─────────────────────────────────────────────
async function sendStatusReport() {
    try {
        // --- VM Info ---
        const uptimeSec = os.uptime();
        const hours = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);
        const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
        const usedMemGB = ((os.totalmem() - os.freemem()) / (1024 ** 3)).toFixed(1);
        const memPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
        const cpuCount = os.cpus().length;
        const hostname = os.hostname();

        // --- External IP ---
        let ip = 'Unknown';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
            ip = ipRes.data.ip;
        } catch (e) { /* ignore */ }

        // --- PM2 Process Info ---
        let pm2Info = '';
        try {
            const processes = await runPm2Command('list');
            if (processes && processes.length > 0) {
                pm2Info = processes.map(p => {
                    const status = p.pm2_env ? p.pm2_env.status : 'unknown';
                    const emoji = status === 'online' ? '✅' : '❌';
                    const mem = p.monit ? (p.monit.memory / (1024 * 1024)).toFixed(1) : '0';
                    const cpu = p.monit ? p.monit.cpu : '0';
                    return `  ${emoji} *${p.name}* — ${status} (PID: ${p.pid}, CPU: ${cpu}%, MEM: ${mem}MB)`;
                }).join('\n');
            } else {
                pm2Info = '  ⚠️ No PM2 processes found';
            }
        } catch (e) {
            pm2Info = `  ⚠️ PM2 Error: ${e.message}`;
        }

        const report =
            '📊 <b>System Status Report</b>\n' +
            '━━━━━━━━━━━━━━━━━━━\n' +
            `🖥️ <b>VM</b>: Running\n` +
            `⏱️ <b>Uptime</b>: ${hours}h ${mins}m\n` +
            `💾 <b>Memory</b>: ${usedMemGB} / ${totalMemGB} GB (${memPercent}%)\n` +
            `🧠 <b>CPU Cores</b>: ${cpuCount}\n` +
            `🌐 <b>Hostname</b>: <code>${escapeHTML(hostname)}</code>\n` +
            `📡 <b>External IP</b>: <code>${escapeHTML(ip)}</code>\n\n` +
            `📡 <b>Server Processes:</b>\n${pm2Info}`;

        await sendTelegramMsg(report);
    } catch (err) {
        await sendTelegramMsg(`❌ Status check failed: <code>${escapeHTML(err.message)}</code>`);
    }
}

module.exports = {
    sendTelegramMsg,
    sendStartupMsg,
    sendShutdownMsg,
    sendUploadAlert,
    sendActionAlert,
    sendHealthAlert,
    sendVisitAlert,
    sendStatusReport
};
