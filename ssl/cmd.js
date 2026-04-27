#!/usr/bin/env node

/**
 * SSL Factory — CLI Mode
 * Interactive command-line SSL certificate generator for DuckDNS domains.
 *
 * Usage:  node ssl/cmd.js
 *   or:   cd ssl && node cmd.js
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

// ─── Paths ───────────────────────────────────────────────
const ROOT_DIR = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const CERT_DIR = path.join(ROOT_DIR, 'Certificates');

// ─── ANSI Colors ─────────────────────────────────────────
const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    cyan:    '\x1b[36m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    white:   '\x1b[37m',
    bgBlue:  '\x1b[44m',
    underline: '\x1b[4m',
};

// ─── Logger (replaces broadcastLog for CLI) ──────────────
function log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const prefix = `${C.dim}[${time}]${C.reset}`;
    switch (type) {
        case 'success':
            console.log(`${prefix} ${C.green}✅ ${message}${C.reset}`);
            break;
        case 'warning':
            console.log(`${prefix} ${C.yellow}⚠️  ${message}${C.reset}`);
            break;
        case 'error':
            console.log(`${prefix} ${C.red}❌ ${message}${C.reset}`);
            break;
        case 'complete':
            console.log(`${prefix} ${C.green}${C.bold}🎉 ${message}${C.reset}`);
            break;
        default:
            console.log(`${prefix} ${C.blue}${message}${C.reset}`);
    }
}

// Alias for the generation function
const broadcastLog = log;

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

// ─── Utility: Read .env ──────────────────────────────────
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

// ─── Utility: Patch .env ─────────────────────────────────
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

// ─── Utility: Patch Domain in Project Files ──────────────
function patchDomainInFiles(newSubdomain) {
    if (!fs.existsSync(ENV_PATH)) return;

    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const domainMatch = envContent.match(/^DUCKDNS_DOMAIN=(.*)/m);
    if (!domainMatch) {
        log('Could not find current DUCKDNS_DOMAIN in .env for deep patching.', 'warning');
        return;
    }
    const oldSubdomain = domainMatch[1].trim();
    if (oldSubdomain === newSubdomain) return;

    const oldFQDN = `${oldSubdomain}.duckdns.org`;
    const newFQDN = `${newSubdomain}.duckdns.org`;

    log(`Deep-patching project from '${oldSubdomain}' to '${newSubdomain}'...`);

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
                log(`   Patched: ${path.basename(file)}`, 'success');
            }
        } catch (e) {
            log(`   Error patching ${path.basename(file)}: ${e.message}`, 'warning');
        }
    });
}

// ─── Utility: Mask a secret ──────────────────────────────
function mask(value) {
    if (!value || value.length < 8) return value || '(not set)';
    return value.substring(0, 8) + '****' + value.substring(value.length - 4);
}

// ─── Utility: Readline prompt ────────────────────────────
function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

// ─── ACME SSL Generation ─────────────────────────────────
async function generateSSL(config) {
    const acme = require('acme-client');
    const { subdomain, token, email, staging } = config;
    const domain = `${subdomain}.duckdns.org`;
    const outputDir = __dirname;

    const directoryUrl = staging
        ? acme.directory.letsencrypt.staging
        : acme.directory.letsencrypt.production;

    log(`🚀 Starting SSL generation for ${domain}...`);
    log(`Environment: ${staging ? 'Staging (Testing)' : 'Production (Live)'}`);

    // Step 1: Account key
    log('Step 1: Generating ACME account key (RSA-2048)...');
    const accountKey = await acme.crypto.createPrivateRsaKey(2048);
    log('Account key generated.', 'success');

    // Step 2: Client
    log(`Step 2: Connecting to Let's Encrypt...`);
    const client = new acme.Client({ directoryUrl, accountKey });
    log('ACME client connected.', 'success');

    // Step 3: Domain key + CSR
    log('Step 3: Generating 4096-bit RSA domain key and CSR...');
    const domainKeyRaw = await acme.crypto.createPrivateRsaKey(4096);
    const [domainKey, csr] = await acme.crypto.createCsr(
        { commonName: domain, altNames: [domain] },
        domainKeyRaw
    );
    log('Domain key and CSR generated.', 'success');

    // Step 4: ACME auto
    log('Step 4: Initiating ACME DNS-01 challenge...');

    const certificate = await client.auto({
        csr,
        email,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],

        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
            log(`Challenge received for ${authz.identifier.value}`);

            const setUrl = `https://www.duckdns.org/update?domains=${subdomain}&token=${token}&txt=${encodeURIComponent(keyAuthorization)}&verbose=true`;
            log(`Setting _acme-challenge.${domain} TXT record...`);
            const res = await httpGet(setUrl);

            if (res.split('\n')[0] !== 'OK') {
                throw new Error(`DuckDNS API failed: ${res}`);
            }
            log('DuckDNS TXT record set.', 'success');

            // Wait for DNS propagation
            log('Step 5: Waiting for DNS propagation (30s)...');
            await new Promise(r => setTimeout(r, 10000));

            // Verify DNS
            const dns = require('dns').promises;
            for (let i = 1; i <= 5; i++) {
                log(`DNS check ${i}/5...`);
                try {
                    const records = await dns.resolveTxt(`_acme-challenge.${domain}`);
                    const flat = records.map(r => r.join('')).flat();
                    if (flat.includes(keyAuthorization)) {
                        log('DNS propagated — TXT record confirmed!', 'success');
                        return;
                    }
                } catch (e) {
                    log(`No record yet (${e.code || e.message})`, 'warning');
                }
                if (i < 5) await new Promise(r => setTimeout(r, 15000));
            }
            log('Proceeding without local DNS confirmation...', 'warning');
        },

        challengeRemoveFn: async () => {
            const clearUrl = `https://www.duckdns.org/update?domains=${subdomain}&token=${token}&txt=&clear=true`;
            await httpGet(clearUrl);
            log('TXT record cleared.', 'success');
        },
    });

    // Step 6: Save files
    log('Step 6: Saving PEM files...');
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
        log(`Saved ${file.name}`, 'success');
    }

    log('SSL Certificate generation complete!', 'complete');

    return {
        domain,
        files: Object.fromEntries(
            Object.entries(files).map(([k, v]) => [k, { name: v.name, size: v.content.length }])
        ),
        certCount: certs.length,
        staging,
    };
}

// ─── Post-Generation Automation ──────────────────────────
function runAutomation(result, config) {
    // 1. Clear Certificates folder
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

    log('Cleaning Certificates folder...');
    fs.readdirSync(CERT_DIR).forEach(f => {
        if (f.endsWith('.pem')) {
            try { fs.unlinkSync(path.join(CERT_DIR, f)); } catch (e) {}
        }
    });

    // 2. Move new certificates
    log('Moving certificates to Certificates folder...');
    const filesToMove = [
        result.files.key.name,
        result.files.crt.name,
        result.files.chain.name,
        result.files.chainOnly.name
    ];

    filesToMove.forEach(f => {
        const src = path.join(__dirname, f);
        const dest = path.join(CERT_DIR, f);
        if (fs.existsSync(src)) {
            try { fs.renameSync(src, dest); } catch (e) {}
        }
    });

    // 3. Deep-patch domain in project files (BEFORE updating .env)
    patchDomainInFiles(config.subdomain);

    // 4. Update .env
    log('Updating .env configuration...');
    patchEnv({
        DUCKDNS_DOMAIN: config.subdomain,
        DUCKDNS_TOKEN: config.token,
        ADMIN_EMAIL: config.email,
        TELEGRAM_BOT_TOKEN: config.telegramToken,
        SSL_KEY_PATH: path.join(CERT_DIR, result.files.key.name).replace(/\\/g, '/'),
        SSL_CERT_PATH: path.join(CERT_DIR, result.files.chain.name).replace(/\\/g, '/')
    });

    log('Automation: Workflow complete!', 'success');
}

// ─── Main CLI Flow ───────────────────────────────────────
async function main() {
    // Banner
    console.log(`\n${C.cyan}╔══════════════════════════════════════════════════════╗`);
    console.log(`║     ${C.bold}SSL Factory — CLI Mode${C.reset}${C.cyan}                           ║`);
    console.log(`╚══════════════════════════════════════════════════════╝${C.reset}\n`);

    // Read current .env values
    const env = readEnv();
    const currentSubdomain    = env.DUCKDNS_DOMAIN       || '';
    const currentToken        = env.DUCKDNS_TOKEN        || '';
    const currentEmail        = env.ADMIN_EMAIL          || '';
    const currentTelegram     = env.TELEGRAM_BOT_TOKEN   || '';

    console.log(`${C.bold}Current Configuration (from .env):${C.reset}\n`);
    console.log(`  Subdomain        : ${C.cyan}${currentSubdomain || '(not set)'}${C.reset}`);
    console.log(`  DuckDNS Token    : ${C.dim}${mask(currentToken)}${C.reset}`);
    console.log(`  Admin Email      : ${C.cyan}${currentEmail || '(not set)'}${C.reset}`);
    console.log(`  Telegram Token   : ${C.dim}${mask(currentTelegram)}${C.reset}`);
    console.log('');

    // Interactive prompts
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let subdomain = currentSubdomain;
    let token = currentToken;
    let email = currentEmail;
    let telegramToken = currentTelegram;

    // Subdomain
    const changeSubdomain = await ask(rl, `${C.bold}Do you want to change Subdomain?${C.reset} (y/n): `);
    if (changeSubdomain.toLowerCase() === 'y') {
        subdomain = await ask(rl, `  Enter new Subdomain: `);
    } else {
        console.log(`  ${C.green}✓ Keeping: ${subdomain}${C.reset}`);
    }

    // DuckDNS Token
    const changeToken = await ask(rl, `${C.bold}Do you want to change DuckDNS Token?${C.reset} (y/n): `);
    if (changeToken.toLowerCase() === 'y') {
        token = await ask(rl, `  Enter new DuckDNS Token: `);
    } else {
        console.log(`  ${C.green}✓ Keeping existing token.${C.reset}`);
    }

    // Admin Email
    const changeEmail = await ask(rl, `${C.bold}Do you want to change Admin Email?${C.reset} (y/n): `);
    if (changeEmail.toLowerCase() === 'y') {
        email = await ask(rl, `  Enter new Admin Email: `);
    } else {
        console.log(`  ${C.green}✓ Keeping: ${email}${C.reset}`);
    }

    // Telegram Bot Token
    const changeTelegram = await ask(rl, `${C.bold}Do you want to change Telegram Bot Token?${C.reset} (y/n): `);
    if (changeTelegram.toLowerCase() === 'y') {
        telegramToken = await ask(rl, `  Enter new Telegram Bot Token: `);
    } else {
        console.log(`  ${C.green}✓ Keeping existing token.${C.reset}`);
    }

    rl.close();

    // Validate
    if (!subdomain || !token || !email || !telegramToken) {
        console.log(`\n${C.red}${C.bold}❌ Error: All 4 fields are required. Aborting.${C.reset}\n`);
        process.exit(1);
    }

    // Summary
    console.log(`\n${C.bold}─── Configuration Summary ───${C.reset}`);
    console.log(`  Domain           : ${C.cyan}${subdomain}.duckdns.org${C.reset}`);
    console.log(`  DuckDNS Token    : ${C.dim}${mask(token)}${C.reset}`);
    console.log(`  Admin Email      : ${C.cyan}${email}${C.reset}`);
    console.log(`  Telegram Token   : ${C.dim}${mask(telegramToken)}${C.reset}`);
    console.log(`  Mode             : ${C.green}Production${C.reset}`);
    console.log('');

    // Generate
    try {
        const config = { subdomain, token, email, telegramToken, staging: false };
        const result = await generateSSL(config);

        // Run automation
        console.log(`\n${C.bold}─── Post-Generation Automation ───${C.reset}\n`);
        runAutomation(result, config);

        // Auto-start server
        console.log(`\n${C.green}${C.bold}🎉 Done! Starting server...${C.reset}`);
        console.log(`${C.dim}> cd C:\\FileServer && npm start${C.reset}\n`);

        const child = exec('npm start', { cwd: 'C:\\FileServer' });
        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);

    } catch (err) {
        log(`Generation failed: ${err.message}`, 'error');
        process.exit(1);
    }
}

main();
