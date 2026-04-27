#!/usr/bin/env node

/**
 * ============================================================
 *  SSL Certificate Generator for DuckDNS Domains
 *  Uses Let's Encrypt ACME Protocol with DNS-01 Challenge
 * ============================================================
 *
 *  Generates 4 real PEM files:
 *    1. {domain}-key.pem        — RSA Private Key
 *    2. {domain}-crt.pem        — End-Entity Certificate
 *    3. {domain}-chain.pem      — Full Chain (cert + intermediate)
 *    4. {domain}-chain-only.pem — Intermediate Certificate Only
 *
 *  Usage:
 *    node generate-ssl.js
 *
 *  Environment Variables (or edit the CONFIG below):
 *    DUCKDNS_DOMAIN  — Your DuckDNS subdomain (without .duckdns.org)
 *    DUCKDNS_TOKEN   — Your DuckDNS API token
 *    ACME_EMAIL      — Your email for Let's Encrypt registration
 *    USE_STAGING     — Set to "true" to use LE staging (testing)
 */

const acme = require('acme-client');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ═══════════════════════════════════════════════════════════
//  CONFIGURATION — Edit these or use environment variables
// ═══════════════════════════════════════════════════════════

const CONFIG = {
    // Your DuckDNS subdomain (just the subdomain, without .duckdns.org)
    subdomain: process.env.DUCKDNS_DOMAIN || 'ubstudioz',

    // Your DuckDNS API token (get it from https://www.duckdns.org)
    token: process.env.DUCKDNS_TOKEN || '',

    // Email for Let's Encrypt account registration
    email: process.env.ACME_EMAIL || '',

    // Use staging (testing) server? Set to false for real certificates
    staging: process.env.USE_STAGING === 'true' ? true : false,

    // RSA key size (2048, 3072, or 4096)
    keySize: 4096,

    // Output directory for the PEM files
    outputDir: __dirname,

    // How long to wait for DNS propagation (milliseconds)
    dnsPropagationDelay: 30000,

    // How many times to retry DNS verification
    dnsRetries: 5,
};

// Derived values
const DOMAIN = `${CONFIG.subdomain}.duckdns.org`;
const DIRECTORY_URL = CONFIG.staging
    ? acme.directory.letsencrypt.staging
    : acme.directory.letsencrypt.production;

// ═══════════════════════════════════════════════════════════
//  PRETTY CONSOLE LOGGING
// ═══════════════════════════════════════════════════════════

const log = {
    step: (n, msg) => console.log(`\n  \x1b[36m[Step ${n}]\x1b[0m ${msg}`),
    info: (msg) => console.log(`    \x1b[90m→\x1b[0m ${msg}`),
    ok: (msg) => console.log(`    \x1b[32m✔\x1b[0m ${msg}`),
    warn: (msg) => console.log(`    \x1b[33m⚠\x1b[0m ${msg}`),
    err: (msg) => console.log(`    \x1b[31m✖\x1b[0m ${msg}`),
    file: (msg) => console.log(`    \x1b[35m📄\x1b[0m ${msg}`),
    banner: () => {
        console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════╗
║       SSL Certificate Generator for DuckDNS              ║
║       Let's Encrypt · ACME DNS-01 Challenge              ║
╚══════════════════════════════════════════════════════════╝\x1b[0m`);
        console.log(`  Domain:      \x1b[1m${DOMAIN}\x1b[0m`);
        console.log(`  Environment: \x1b[1m${CONFIG.staging ? 'STAGING (test)' : 'PRODUCTION (live)'}\x1b[0m`);
        console.log(`  Key Size:    \x1b[1m${CONFIG.keySize}-bit RSA\x1b[0m`);
        console.log(`  Output:      \x1b[1m${CONFIG.outputDir}\x1b[0m`);
    }
};

// ═══════════════════════════════════════════════════════════
//  DUCKDNS API HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Makes an HTTP(S) GET request and returns the response body.
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', reject);
    });
}

/**
 * Set a TXT record on DuckDNS for the ACME DNS-01 challenge.
 */
async function setDuckDnsTxt(txtValue) {
    const url = `https://www.duckdns.org/update?domains=${CONFIG.subdomain}&token=${CONFIG.token}&txt=${encodeURIComponent(txtValue)}&verbose=true`;
    log.info(`Setting TXT record: _acme-challenge.${DOMAIN} → ${txtValue.substring(0, 20)}...`);

    const response = await httpGet(url);
    const lines = response.split('\n');

    if (lines[0] === 'OK') {
        log.ok('DuckDNS TXT record updated successfully.');
        return true;
    } else {
        throw new Error(`DuckDNS API returned: ${response}`);
    }
}

/**
 * Clear the TXT record on DuckDNS after verification.
 */
async function clearDuckDnsTxt() {
    const url = `https://www.duckdns.org/update?domains=${CONFIG.subdomain}&token=${CONFIG.token}&txt=&clear=true&verbose=true`;
    log.info('Clearing TXT record from DuckDNS...');

    const response = await httpGet(url);
    const lines = response.split('\n');

    if (lines[0] === 'OK') {
        log.ok('TXT record cleared.');
    } else {
        log.warn(`Failed to clear TXT record: ${response}`);
    }
}

/**
 * Verify that the TXT record has propagated using DNS lookup.
 */
async function verifyDnsPropagation(expectedValue) {
    const dns = require('dns').promises;
    const challengeHost = `_acme-challenge.${DOMAIN}`;

    for (let attempt = 1; attempt <= CONFIG.dnsRetries; attempt++) {
        log.info(`DNS propagation check ${attempt}/${CONFIG.dnsRetries} — looking up TXT for ${challengeHost}`);

        try {
            const records = await dns.resolveTxt(challengeHost);
            const flat = records.map(r => r.join('')).flat();

            if (flat.includes(expectedValue)) {
                log.ok(`DNS propagated! Found matching TXT record.`);
                return true;
            } else {
                log.warn(`TXT records found but no match. Got: ${JSON.stringify(flat)}`);
            }
        } catch (err) {
            if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
                log.warn(`No TXT records found yet (${err.code}).`);
            } else {
                log.warn(`DNS lookup error: ${err.message}`);
            }
        }

        if (attempt < CONFIG.dnsRetries) {
            const waitSec = CONFIG.dnsPropagationDelay / 1000;
            log.info(`Waiting ${waitSec}s before next check...`);
            await sleep(CONFIG.dnsPropagationDelay);
        }
    }

    // Even if we couldn't verify, let ACME try — sometimes local DNS is delayed
    log.warn('Could not confirm DNS propagation locally. Proceeding anyway (ACME server may see it).');
    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════
//  CERTIFICATE FILE HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Split a PEM bundle into individual certificates.
 */
function splitPemCerts(pemBundle) {
    const certs = [];
    const regex = /(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g;
    let match;
    while ((match = regex.exec(pemBundle)) !== null) {
        certs.push(match[1]);
    }
    return certs;
}

/**
 * Save all 4 PEM files to disk.
 */
function saveFiles(privateKey, certificateChain) {
    const certs = splitPemCerts(certificateChain);

    if (certs.length < 1) {
        throw new Error('No certificates found in the response from Let\'s Encrypt.');
    }

    const endEntityCert = certs[0];                           // The domain certificate
    const intermediateCerts = certs.slice(1).join('\n');       // Intermediate chain only
    const fullChain = certificateChain;                        // cert + intermediates

    const files = {
        key: { name: `${DOMAIN}-key.pem`, content: privateKey },
        crt: { name: `${DOMAIN}-crt.pem`, content: endEntityCert },
        chain: { name: `${DOMAIN}-chain.pem`, content: fullChain },
        chainOnly: { name: `${DOMAIN}-chain-only.pem`, content: intermediateCerts },
    };

    log.step(6, 'Saving PEM files to disk...');

    for (const [type, file] of Object.entries(files)) {
        const filePath = path.join(CONFIG.outputDir, file.name);
        fs.writeFileSync(filePath, file.content + '\n', 'utf-8');
        log.file(`${file.name}  (${(file.content.length / 1024).toFixed(1)} KB)`);
    }

    return files;
}

// ═══════════════════════════════════════════════════════════
//  MAIN — ACME DNS-01 CERTIFICATE GENERATION
// ═══════════════════════════════════════════════════════════

async function main() {
    log.banner();

    // ── Validate config ──────────────────────────────────
    if (!CONFIG.token) {
        log.err('Missing DuckDNS token! Set DUCKDNS_TOKEN env var or edit CONFIG.token in this file.');
        process.exit(1);
    }
    if (!CONFIG.email) {
        log.err('Missing email! Set ACME_EMAIL env var or edit CONFIG.email in this file.');
        process.exit(1);
    }

    try {
        // ── Step 1: Generate account private key ──────────
        log.step(1, 'Generating ACME account private key...');
        const accountKey = await acme.crypto.createPrivateRsaKey(2048);
        log.ok('Account key generated (2048-bit RSA).');

        // ── Step 2: Create ACME client ────────────────────
        log.step(2, `Connecting to Let's Encrypt (${CONFIG.staging ? 'Staging' : 'Production'})...`);
        const client = new acme.Client({
            directoryUrl: DIRECTORY_URL,
            accountKey: accountKey,
        });
        log.ok('ACME client initialized.');

        // ── Step 3: Generate domain private key + CSR ─────
        log.step(3, `Generating ${CONFIG.keySize}-bit RSA key and CSR for ${DOMAIN}...`);
        const [domainKey, csr] = await acme.crypto.createCsr({
            commonName: DOMAIN,
            altNames: [DOMAIN],
        }, await acme.crypto.createPrivateRsaKey(CONFIG.keySize));
        log.ok(`Domain key and CSR generated.`);

        // ── Step 4: Run ACME auto with DNS-01 ─────────────
        log.step(4, 'Starting ACME certificate order with DNS-01 challenge...');

        const certificate = await client.auto({
            csr,
            email: CONFIG.email,
            termsOfServiceAgreed: true,
            challengePriority: ['dns-01'],

            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                log.info(`Challenge received for ${authz.identifier.value}`);
                log.info(`Challenge type: ${challenge.type}`);

                // Set the TXT record via DuckDNS API
                await setDuckDnsTxt(keyAuthorization);

                // Wait for DNS propagation
                log.step(5, 'Waiting for DNS propagation...');
                await sleep(10000); // Initial wait
                await verifyDnsPropagation(keyAuthorization);
            },

            challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
                // Clean up TXT record
                await clearDuckDnsTxt();
            },
        });

        // ── Step 5: Save the files ────────────────────────
        const privateKeyPem = domainKey.toString();
        const certChainPem = certificate.toString();

        const savedFiles = saveFiles(privateKeyPem, certChainPem);

        // ── Done! ─────────────────────────────────────────
        console.log(`
\x1b[32m╔══════════════════════════════════════════════════════════╗
║                  SSL GENERATION COMPLETE!                 ║
╚══════════════════════════════════════════════════════════╝\x1b[0m`);
        console.log(`  \x1b[1mFiles saved to:\x1b[0m ${CONFIG.outputDir}\n`);
        console.log(`  \x1b[35m📄\x1b[0m ${savedFiles.key.name}         (Private Key — KEEP SECRET!)`);
        console.log(`  \x1b[35m📄\x1b[0m ${savedFiles.crt.name}         (Domain Certificate)`);
        console.log(`  \x1b[35m📄\x1b[0m ${savedFiles.chain.name}       (Full Chain)`);
        console.log(`  \x1b[35m📄\x1b[0m ${savedFiles.chainOnly.name}   (Intermediate Only)\n`);

        if (CONFIG.staging) {
            log.warn('These are STAGING certificates (not trusted by browsers).');
            log.warn('Set USE_STAGING=false or edit CONFIG.staging to get production certs.');
        } else {
            log.ok('These are PRODUCTION certificates — valid and trusted!');
        }

        const certs = splitPemCerts(certChainPem);
        console.log(`\n  Certificate chain contains \x1b[1m${certs.length}\x1b[0m certificate(s).`);
        console.log(`  Valid for domain: \x1b[1m${DOMAIN}\x1b[0m\n`);

    } catch (err) {
        log.err(`Certificate generation failed!`);
        console.error(`\n  \x1b[31mError:\x1b[0m ${err.message}`);

        if (err.message.includes('rateLimited')) {
            log.warn('You\'ve hit Let\'s Encrypt rate limits. Wait and try again later.');
            log.warn('Use staging mode (USE_STAGING=true) for testing.');
        }

        if (err.message.includes('dns') || err.message.includes('DNS')) {
            log.warn('DNS issue detected. Make sure your DuckDNS token is correct.');
            log.warn('Try increasing dnsPropagationDelay in CONFIG.');
        }

        process.exit(1);
    }
}

// Run
main();
