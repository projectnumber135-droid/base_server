const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const acme = require('acme-client');

// --- Paths ---
const ROOT_DIR = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const CERT_DIR = path.join(ROOT_DIR, 'Certificates');

// --- Helper: Read .env ---
function readEnv() {
    if (!fs.existsSync(ENV_PATH)) return {};
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)/);
        if (match) env[match[1].trim()] = match[2].trim();
    });
    return env;
}

// --- Helper: Patch .env ---
function patchEnv(updates) {
    if (!fs.existsSync(ENV_PATH)) return;
    let content = fs.readFileSync(ENV_PATH, 'utf8');
    for (const [key, value] of Object.entries(updates)) {
        const re = new RegExp(`^(${key}=).*`, 'm');
        if (re.test(content)) {
            content = content.replace(re, `$1${value}`);
        } else {
            content = content.trimEnd() + `\n${key}=${value}\n`;
        }
    }
    fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// --- Helper: Patch Domain in Project Files ---
function patchDomainInFiles(newSubdomain, oldSubdomain) {
    if (newSubdomain === oldSubdomain) return [];

    const oldFQDN = `${oldSubdomain}.duckdns.org`;
    const newFQDN = `${newSubdomain}.duckdns.org`;
    const patchedFiles = [];

    const filesToPatch = [
        path.join(ROOT_DIR, 'package.json'),
        path.join(ROOT_DIR, 'server.js'),
        path.join(ROOT_DIR, 'cert.conf'),
        path.join(ROOT_DIR, 'public', 'ub-cloud-api.js'),
        path.join(ROOT_DIR, 'public', 'index.html'),
        path.join(ROOT_DIR, 'public', 'files.html'),
        path.join(ROOT_DIR, 'public', 'update.html'),
        path.join(ROOT_DIR, 'ssl', 'ssl_generater.js'),
        path.join(ROOT_DIR, 'ssl', 'ssl.js'),
        path.join(ROOT_DIR, 'ssl', 'generate-ssl.js'),
        path.join(ROOT_DIR, 'scripts', 'update_duckdns.ps1'),
        path.join(ROOT_DIR, 'scripts', 'update_dns.js'),
        path.join(ROOT_DIR, 'scripts', 'update_domaine_telegram_token.js')
    ];

    filesToPatch.forEach(file => {
        if (!fs.existsSync(file)) return;
        try {
            let content = fs.readFileSync(file, 'utf8');
            const originalContent = content;
            content = content.replace(new RegExp(oldFQDN, 'g'), newFQDN);
            content = content.replace(new RegExp(`\\b${oldSubdomain}\\b`, 'g'), newSubdomain);
            if (content !== originalContent) {
                fs.writeFileSync(file, content, 'utf8');
                patchedFiles.push(path.basename(file));
            }
        } catch (e) {
            console.error(`Error patching ${file}:`, e.message);
        }
    });
    return patchedFiles;
}

// --- Helper: HTTP GET ---
function httpGet(reqUrl) {
    return new Promise((resolve, reject) => {
        const client = reqUrl.startsWith('https') ? https : http;
        client.get(reqUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', reject);
    });
}

// --- Helper: Split PEM ---
function splitPemCerts(pemBundle) {
    const certs = [];
    const regex = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g;
    let match;
    while ((match = regex.exec(pemBundle)) !== null) {
        certs.push(match[1]);
    }
    return certs;
}

// --- MAIN API ENDPOINT ---
router.post('/generate', async (req, res) => {
    const { Subdomain, DuckDNS_Token, Admin_Email, Telegram_Token, Staging } = req.body || {};
    const env = readEnv();

    // Use input or fallback to .env
    const config = {
        subdomain: Subdomain || env.DUCKDNS_DOMAIN,
        token: DuckDNS_Token || env.DUCKDNS_TOKEN,
        email: Admin_Email || env.ADMIN_EMAIL,
        telegramToken: Telegram_Token || env.TELEGRAM_BOT_TOKEN,
        staging: Staging === true || Staging === 'true'
    };

    const oldSubdomain = env.DUCKDNS_DOMAIN;

    if (!config.subdomain || !config.token || !config.email) {
        return res.status(400).json({ error: 'Missing required configuration (Subdomain, Token, or Email)' });
    }

    const domain = `${config.subdomain}.duckdns.org`;
    const directoryUrl = config.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production;

    try {
        console.log(`[SSL API] Starting generation for ${domain}...`);
        
        // 1. Generate ACME keys
        const accountKey = await acme.crypto.createPrivateRsaKey(2048);
        const client = new acme.Client({ directoryUrl, accountKey });
        const domainKeyRaw = await acme.crypto.createPrivateRsaKey(4096);
        const [domainKey, csr] = await acme.crypto.createCsr(
            { commonName: domain, altNames: [domain] },
            domainKeyRaw
        );

        // 2. Run ACME Challenge
        const certificate = await client.auto({
            csr,
            email: config.email,
            termsOfServiceAgreed: true,
            challengePriority: ['dns-01'],
            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                const setUrl = `https://www.duckdns.org/update?domains=${config.subdomain}&token=${config.token}&txt=${encodeURIComponent(keyAuthorization)}&verbose=true`;
                const resp = await httpGet(setUrl);
                if (resp.split('\n')[0] !== 'OK') throw new Error(`DuckDNS API failed: ${resp}`);
                
                // Wait for propagation
                await new Promise(r => setTimeout(r, 20000));
            },
            challengeRemoveFn: async () => {
                const clearUrl = `https://www.duckdns.org/update?domains=${config.subdomain}&token=${config.token}&txt=&clear=true`;
                await httpGet(clearUrl);
            }
        });

        // 3. Save Files locally in /ssl temporarily
        const privateKeyPem = domainKey.toString();
        const certChainPem = certificate.toString();
        const certs = splitPemCerts(certChainPem);

        const files = {
            key: { name: `${domain}-key.pem`, content: privateKeyPem },
            crt: { name: `${domain}-crt.pem`, content: certs[0] || '' },
            chain: { name: `${domain}-chain.pem`, content: certChainPem },
            chainOnly: { name: `${domain}-chain-only.pem`, content: certs.slice(1).join('\n') },
        };

        for (const f of Object.values(files)) {
            fs.writeFileSync(path.join(__dirname, f.name), f.content + '\n', 'utf-8');
        }

        // 4. Run Automation
        if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
        
        // Clean Certificates folder
        fs.readdirSync(CERT_DIR).forEach(f => {
            if (f.endsWith('.pem')) {
                try { fs.unlinkSync(path.join(CERT_DIR, f)); } catch (e) {}
            }
        });

        // Move new files
        for (const f of Object.values(files)) {
            const src = path.join(__dirname, f.name);
            const dest = path.join(CERT_DIR, f.name);
            fs.renameSync(src, dest);
        }

        // Patch project files
        const patched = patchDomainInFiles(config.subdomain, oldSubdomain);

        // Update .env
        patchEnv({
            DUCKDNS_DOMAIN: config.subdomain,
            DUCKDNS_TOKEN: config.token,
            ADMIN_EMAIL: config.email,
            TELEGRAM_BOT_TOKEN: config.telegramToken,
            SSL_KEY_PATH: path.join(CERT_DIR, files.key.name).replace(/\\/g, '/'),
            SSL_CERT_PATH: path.join(CERT_DIR, files.chain.name).replace(/\\/g, '/')
        });

        res.json({ 
            success: true, 
            message: 'SSL generated and automation complete. Restarting server...',
            domain,
            patchedFiles: patched
        });

        // 5. Restart/Start Server via PM2
        setTimeout(() => {
            const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
            const pm2Path  = path.join(ROOT_DIR, 'node_modules', 'pm2', 'bin', 'pm2');
            const pm2Env = {
                ...process.env,
                PM2_HOME:     path.join(ROOT_DIR, 'pm2'),
                PM2_RPC_PORT: '43554',
                PM2_PUB_PORT: '43555'
            };

            console.log('[SSL API] Triggering PM2 lifecycle...');
            // Try restart first
            exec(`"${nodePath}" "${pm2Path}" restart FileServer`, { env: pm2Env }, (err) => {
                if (err) {
                    console.log('[SSL API] Restart failed (process might not exist), attempting start...');
                    exec(`"${nodePath}" "${pm2Path}" start server.js --name FileServer --cwd "${ROOT_DIR}"`, { env: pm2Env });
                } else {
                    console.log('[SSL API] Restart successful.');
                }
            });
        }, 1500);

    } catch (err) {
        console.error('[SSL API] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
