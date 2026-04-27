#!/usr/bin/env node

/**
 * SSL Generator — Local Web Server
 * Serves a beautiful UI + real ACME backend for DuckDNS SSL generation.
 *
 * Usage:  node server.js
 * Open:   http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const acme = require('acme-client');
const https = require('https');

const PORT = 3000;

// ─── Utility: HTTP GET ───────────────────────────────────
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

// ─── Utility: Read POST body ─────────────────────────────
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// ─── Utility: Split PEM chain ────────────────────────────
function splitPemCerts(pemBundle) {
    const certs = [];
    const regex = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g;
    let match;
    while ((match = regex.exec(pemBundle)) !== null) {
        certs.push(match[1]);
    }
    return certs;
}

// ─── Utility: Update .env file ───────────────────────────
function patchEnv(updates) {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    let content = fs.readFileSync(envPath, 'utf8');
    for (const [key, value] of Object.entries(updates)) {
        const re = new RegExp(`^(${key}=).*`, 'm');
        if (re.test(content)) {
            content = content.replace(re, `$1${value}`);
        } else {
            content = content.trimEnd() + `\n${key}=${value}\n`;
        }
    }
    fs.writeFileSync(envPath, content, 'utf8');
}

// ─── Utility: Patch Domain in Project Files ─────────────
function patchDomainInFiles(newSubdomain) {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    // 1. Get CURRENT domain from .env
    const envContent = fs.readFileSync(envPath, 'utf8');
    const domainMatch = envContent.match(/^DUCKDNS_DOMAIN=(.*)/m);
    if (!domainMatch) {
        broadcastLog('⚠️ Automation: Could not find current DUCKDNS_DOMAIN in .env for deep patching.', 'warning');
        return;
    }
    const oldSubdomain = domainMatch[1].trim();
    if (oldSubdomain === newSubdomain) return; // No change needed

    const oldFQDN = `${oldSubdomain}.duckdns.org`;
    const newFQDN = `${newSubdomain}.duckdns.org`;

    broadcastLog(`📝 Automation: Deep-patching project from '${oldSubdomain}' to '${newSubdomain}'...`);

    const filesToPatch = [
        path.join(__dirname, '..', 'package.json'),
        path.join(__dirname, '..', 'server.js'),
        path.join(__dirname, '..', 'cert.conf'),
        path.join(__dirname, '..', 'public', 'ub-cloud-api.js'),
        path.join(__dirname, '..', 'public', 'index.html'),
        path.join(__dirname, '..', 'public', 'files.html'),
        path.join(__dirname, '..', 'public', 'update.html'),
        path.join(__dirname, '..', 'ssl', 'ssl_generater.js'),
        path.join(__dirname, '..', 'ssl', 'ssl.js'),
        path.join(__dirname, '..', 'ssl', 'generate-ssl.js'),
        path.join(__dirname, '..', 'scripts', 'update_duckdns.ps1'),
        path.join(__dirname, '..', 'scripts', 'update_dns.js'),
        path.join(__dirname, '..', 'scripts', 'update_domaine_telegram_token.js')
    ];

    filesToPatch.forEach(file => {
        if (!fs.existsSync(file)) return;
        try {
            let content = fs.readFileSync(file, 'utf8');
            
            // Replace FQDNs first (more specific) then subdomains
            const originalContent = content;
            content = content.replace(new RegExp(oldFQDN, 'g'), newFQDN);
            content = content.replace(new RegExp(`\\b${oldSubdomain}\\b`, 'g'), newSubdomain);

            if (content !== originalContent) {
                fs.writeFileSync(file, content, 'utf8');
                broadcastLog(`   Patched: ${path.basename(file)}`, 'success');
            }
        } catch (e) {
            broadcastLog(`   Error patching ${path.basename(file)}: ${e.message}`, 'warning');
        }
    });
}

// ─── SSE: Server-Sent Events log streaming ───────────────
let sseClients = [];

function broadcastLog(message, type = 'info') {
    const data = JSON.stringify({ message, type, timestamp: new Date().toLocaleTimeString() });
    sseClients.forEach(res => {
        res.write(`data: ${data}\n\n`);
    });
}

// ─── ACME SSL Generation ─────────────────────────────────
async function generateSSL(config) {
    const { subdomain, token, email, staging } = config;
    const domain = `${subdomain}.duckdns.org`;
    const outputDir = __dirname;

    const directoryUrl = staging
        ? acme.directory.letsencrypt.staging
        : acme.directory.letsencrypt.production;

    broadcastLog(`🚀 Starting SSL generation for ${domain}...`);
    broadcastLog(`Environment: ${staging ? 'Staging (Testing)' : 'Production (Live)'}`);

    // Step 1: Account key
    broadcastLog('Step 1: Generating ACME account key (RSA-2048)...');
    const accountKey = await acme.crypto.createPrivateRsaKey(2048);
    broadcastLog('Account key generated.', 'success');

    // Step 2: Client
    broadcastLog(`Step 2: Connecting to Let's Encrypt...`);
    const client = new acme.Client({ directoryUrl, accountKey });
    broadcastLog('ACME client connected.', 'success');

    // Step 3: Domain key + CSR
    broadcastLog('Step 3: Generating 4096-bit RSA domain key and CSR...');
    const domainKeyRaw = await acme.crypto.createPrivateRsaKey(4096);
    const [domainKey, csr] = await acme.crypto.createCsr(
        { commonName: domain, altNames: [domain] },
        domainKeyRaw
    );
    broadcastLog('Domain key and CSR generated.', 'success');

    // Step 4: ACME auto
    broadcastLog('Step 4: Initiating ACME DNS-01 challenge...');

    const certificate = await client.auto({
        csr,
        email,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],

        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
            broadcastLog(`Challenge received for ${authz.identifier.value}`);

            // Set TXT record via DuckDNS
            const setUrl = `https://www.duckdns.org/update?domains=${subdomain}&token=${token}&txt=${encodeURIComponent(keyAuthorization)}&verbose=true`;
            broadcastLog(`Setting _acme-challenge.${domain} TXT record...`);
            const res = await httpGet(setUrl);

            if (res.split('\n')[0] !== 'OK') {
                throw new Error(`DuckDNS API failed: ${res}`);
            }
            broadcastLog('DuckDNS TXT record set.', 'success');

            // Wait for DNS propagation
            broadcastLog('Step 5: Waiting for DNS propagation (30s)...');
            await new Promise(r => setTimeout(r, 10000));

            // Verify DNS
            const dns = require('dns').promises;
            for (let i = 1; i <= 5; i++) {
                broadcastLog(`DNS check ${i}/5...`);
                try {
                    const records = await dns.resolveTxt(`_acme-challenge.${domain}`);
                    const flat = records.map(r => r.join('')).flat();
                    if (flat.includes(keyAuthorization)) {
                        broadcastLog('DNS propagated — TXT record confirmed!', 'success');
                        return;
                    }
                } catch (e) {
                    broadcastLog(`No record yet (${e.code || e.message})`, 'warning');
                }
                if (i < 5) await new Promise(r => setTimeout(r, 15000));
            }
            broadcastLog('Proceeding without local DNS confirmation...', 'warning');
        },

        challengeRemoveFn: async () => {
            const clearUrl = `https://www.duckdns.org/update?domains=${subdomain}&token=${token}&txt=&clear=true`;
            await httpGet(clearUrl);
            broadcastLog('TXT record cleared.', 'success');
        },
    });

    // Step 6: Save files
    broadcastLog('Step 6: Saving PEM files...');
    const privateKeyPem = domainKey.toString();
    const certChainPem = certificate.toString();
    const certs = splitPemCerts(certChainPem);

    const files = {
        key: { name: `${domain}-key.pem`, content: privateKeyPem },
        crt: { name: `${domain}-crt.pem`, content: certs[0] || '' },
        chain: { name: `${domain}-chain.pem`, content: certChainPem },
        chainOnly: { name: `${domain}-chain-only.pem`, content: certs.slice(1).join('\n') },
    };

    for (const [, file] of Object.entries(files)) {
        fs.writeFileSync(path.join(outputDir, file.name), file.content + '\n', 'utf-8');
        broadcastLog(`Saved ${file.name}`, 'success');
    }

    broadcastLog('🎉 SSL Certificate generation complete!', 'complete');

    return {
        domain,
        files: Object.fromEntries(
            Object.entries(files).map(([k, v]) => [k, { name: v.name, size: v.content.length }])
        ),
        certCount: certs.length,
        staging,
    };
}

// ─── HTTP Server ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    // SSE for live logs
    if (parsed.pathname === '/api/logs') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write(':\n\n');
        sseClients.push(res);
        req.on('close', () => {
            sseClients = sseClients.filter(c => c !== res);
        });
        return;
    }

    // Generate SSL endpoint
    if (parsed.pathname === '/api/generate' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        try {
            const body = await readBody(req);
            const result = await generateSSL(body);

            // ─── AUTOMATION: Clear, Move, and Patch ──────────
            const certDir = path.join(__dirname, '..', 'Certificates');
            if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

            broadcastLog('📁 Automation: Cleaning Certificates folder...');
            fs.readdirSync(certDir).forEach(f => {
                if (f.endsWith('.pem')) {
                    try { fs.unlinkSync(path.join(certDir, f)); } catch(e) {}
                }
            });

            broadcastLog('🚚 Automation: Moving certificates to Certificates folder...');
            const filesToMove = [
                result.files.key.name,
                result.files.crt.name,
                result.files.chain.name,
                result.files.chainOnly.name
            ];

            filesToMove.forEach(f => {
                const src = path.join(__dirname, f);
                const dest = path.join(certDir, f);
                if (fs.existsSync(src)) {
                    try { fs.renameSync(src, dest); } catch(e) {}
                }
            });

            // ─── AUTOMATION: Deep Patching first (using old domain from .env) ───
            patchDomainInFiles(body.subdomain);

            broadcastLog('📝 Automation: Updating .env configuration...');
            patchEnv({
                DUCKDNS_DOMAIN: body.subdomain,
                DUCKDNS_TOKEN: body.token,
                ADMIN_EMAIL: body.email,
                TELEGRAM_BOT_TOKEN: body.telegramToken,
                SSL_KEY_PATH: path.join(certDir, result.files.key.name).replace(/\\/g, '/'),
                SSL_CERT_PATH: path.join(certDir, result.files.chain.name).replace(/\\/g, '/')
            });

            broadcastLog('✅ Automation: Workflow complete!', 'success');

            res.end(JSON.stringify({ success: true, result }));
        } catch (err) {
            broadcastLog(`Error: ${err.message}`, 'error');
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // Download endpoint
    if (parsed.pathname.startsWith('/api/download/')) {
        const filename = decodeURIComponent(parsed.pathname.replace('/api/download/', ''));
        const filepath = path.join(__dirname, filename);
        if (fs.existsSync(filepath) && filename.endsWith('.pem')) {
            const content = fs.readFileSync(filepath);
            res.writeHead(200, {
                'Content-Type': 'application/x-pem-file',
                'Content-Disposition': `attachment; filename="${filename}"`,
            });
            res.end(content);
        } else {
            res.writeHead(404);
            res.end('File not found');
        }
        return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    // Serve frontend
    if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`\n\x1b[36m╔══════════════════════════════════════════════════════╗`);
    console.log(`║     SSL Generator Server Running                     ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\x1b[0m`);
    console.log(`\n  \x1b[1mOpen in browser:\x1b[0m  \x1b[4mhttp://localhost:${PORT}\x1b[0m\n`);
});
