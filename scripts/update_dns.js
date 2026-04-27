require('dotenv').config();

/**
 * DuckDNS Update Script
 * Automatically detects external IP and updates your DuckDNS domain.
 */

const DOMAIN = process.env.DUCKDNS_DOMAIN || "ubstudioz";
const TOKEN = process.env.DUCKDNS_TOKEN;
if (!TOKEN) {
    console.error("❌ ERROR: DUCKDNS_TOKEN is missing in .env file.");
    process.exit(1);
}

async function updateDNS() {
    try {
        console.log(`🌐 Updating DuckDNS for domain: ${DOMAIN}...`);

        // We don't strictly need to pass the IP; DuckDNS detects it from the request.
        const url = `https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}`;

        const response = await fetch(url);
        const result = await response.text();

        if (result === "OK") {
            console.log("✅ DuckDNS update successful!");
        } else {
            console.error("❌ DuckDNS update failed:", result);
        }
    } catch (err) {
        console.error("❌ Network Error:", err.message);
    }
}

// Run once
updateDNS();

// Optional: Keep running every 5 minutes if started as a background process
if (process.argv.includes('--watch')) {
    console.log("🕒 Watch mode enabled. Updating every 5 minutes...");
    setInterval(updateDNS, 5 * 60 * 1000);
}
