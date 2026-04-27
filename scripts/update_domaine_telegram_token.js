/**
 * update_domaine_telegram_token.js
 * 
 * Patches .env with new DuckDNS domain / Telegram bot token,
 * generates a self-signed SSL certificate for the new domain,
 * and saves it to <project_root>/ssl/.
 *
 * CLI:  node update_domaine_telegram_token.js --domain=myname --token=123:abc
 * API:  const { updateConfig } = require('./update_domaine_telegram_token');
 *       await updateConfig('myname', '123:abc');
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');      // <project_root>
const ENV_PATH = path.join(ROOT_DIR, '.env');
const SSL_DIR  = path.join(ROOT_DIR, 'ssl');

// ─── SSL Generation ────────────────────────────────────────────────────────────

/**
 * Generates a self-signed RSA-2048 certificate via openssl.
 * Saves key + cert to <project_root>/ssl/<domain>.duckdns.org-{key,chain}.pem
 * @param {string} domain - subdomain only (e.g. "ubstudioz")
 * @returns {{ keyPath: string, certPath: string }}
 */
function generateSSL(domain) {
    const fqdn     = `${domain}.duckdns.org`;
    const keyPath  = path.join(SSL_DIR, `${fqdn}-key.pem`);
    const certPath = path.join(SSL_DIR, `${fqdn}-chain.pem`);

    if (!fs.existsSync(SSL_DIR)) {
        fs.mkdirSync(SSL_DIR, { recursive: true });
        console.log(`📁 Created ssl/ directory: ${SSL_DIR}`);
    }

    const subject = `/CN=${fqdn}`;

    // Build an openssl config string for Subject Alt Names (avoids browser warnings)
    const sslConf = [
        '[req]',
        'distinguished_name = req_distinguished_name',
        'x509_extensions = v3_req',
        'prompt = no',
        '[req_distinguished_name]',
        `CN = ${fqdn}`,
        '[v3_req]',
        'subjectAltName = @alt_names',
        '[alt_names]',
        `DNS.1 = ${fqdn}`,
        `DNS.2 = *.${fqdn}`,
    ].join('\n');

    const confPath = path.join(SSL_DIR, `${fqdn}.conf`);
    fs.writeFileSync(confPath, sslConf);

    try {
        execSync(
            `openssl req -x509 -newkey rsa:2048 ` +
            `-keyout "${keyPath}" ` +
            `-out "${certPath}" ` +
            `-days 825 -nodes ` +
            `-config "${confPath}"`,
            { stdio: 'pipe' }
        );
        console.log(`✅ SSL key  : ${keyPath}`);
        console.log(`✅ SSL cert : ${certPath}`);
    } catch (err) {
        // Clean up conf on failure
        if (fs.existsSync(confPath)) fs.unlinkSync(confPath);
        const hint = err.stderr ? err.stderr.toString().trim() : err.message;
        throw new Error(
            `OpenSSL failed — is it installed and in PATH?\n` +
            `  Install: winget install ShiningLight.OpenSSL\n` +
            `  Error  : ${hint}`
        );
    }

    // Remove temp config
    if (fs.existsSync(confPath)) fs.unlinkSync(confPath);

    return { keyPath, certPath };
}

// ─── .env Patcher ──────────────────────────────────────────────────────────────

/**
 * Reads .env, replaces target keys in-place, writes it back.
 * Only keys explicitly provided are patched; others are untouched.
 * @param {string|null} domain
 * @param {string|null} telegramToken
 * @param {string|null} keyPath   - absolute path to PEM key
 * @param {string|null} certPath  - absolute path to PEM cert
 */
function patchEnv(domain, telegramToken, keyPath, certPath) {
    if (!fs.existsSync(ENV_PATH)) {
        throw new Error(`.env not found at ${ENV_PATH}`);
    }

    let content = fs.readFileSync(ENV_PATH, 'utf8');

    /**
     * Replaces KEY=<anything> on its own line.
     * If the key is missing from .env, it appends it.
     */
    function setKey(key, value) {
        const re = new RegExp(`^(${key}=).*`, 'm');
        if (re.test(content)) {
            content = content.replace(re, `$1${value}`);
        } else {
            content = content.trimEnd() + `\n${key}=${value}\n`;
        }
    }

    if (domain)        setKey('DUCKDNS_DOMAIN', domain);
    if (keyPath)       setKey('SSL_KEY_PATH',   keyPath.replace(/\\/g, '/'));
    if (certPath)      setKey('SSL_CERT_PATH',  certPath.replace(/\\/g, '/'));
    if (telegramToken) setKey('TELEGRAM_BOT_TOKEN', telegramToken);

    fs.writeFileSync(ENV_PATH, content, 'utf8');
    console.log('✅ .env patched successfully');
}

// ─── Main Export ───────────────────────────────────────────────────────────────

/**
 * Full update: generates SSL for new domain (if provided) then patches .env.
 * @param {string|null} domain        - new DuckDNS subdomain (or null to skip)
 * @param {string|null} telegramToken - new Telegram bot token (or null to skip)
 * @returns {Promise<{ keyPath?: string, certPath?: string }>}
 */
async function updateConfig(domain, telegramToken) {
    let keyPath  = null;
    let certPath = null;

    if (domain) {
        console.log(`🔐 Generating SSL for ${domain}.duckdns.org ...`);
        const result = generateSSL(domain);
        keyPath  = result.keyPath;
        certPath = result.certPath;
    }

    patchEnv(domain, telegramToken, keyPath, certPath);

    return { success: true, keyPath, certPath };
}

module.exports = { updateConfig };

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
    const args    = process.argv.slice(2);
    const getArg  = (name) => {
        const a = args.find(a => a.startsWith(`--${name}=`));
        return a ? a.split('=').slice(1).join('=') : null;
    };

    const domain = getArg('domain');
    const token  = getArg('token');

    if (!domain && !token) {
        console.error('Usage: node update_domaine_telegram_token.js [--domain=NAME] [--token=BOT_TOKEN]');
        console.error('  Example: node update_domaine_telegram_token.js --domain=mynewdomain --token=123:abc');
        process.exit(1);
    }

    updateConfig(domain, token)
        .then(r => {
            console.log('\n🎉 Done!');
            if (r.keyPath)  console.log(`   Key  : ${r.keyPath}`);
            if (r.certPath) console.log(`   Cert : ${r.certPath}`);
            console.log('   Restart the server for changes to take effect.');
        })
        .catch(err => {
            console.error('❌ Failed:', err.message);
            process.exit(1);
        });
}
