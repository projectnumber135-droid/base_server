require('dotenv').config();
process.env.PM2_HOME = require('path').join(__dirname, 'pm2');
process.env.PM2_RPC_PORT = '43554';
process.env.PM2_PUB_PORT = '43555';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const http = require('http');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('ffmpeg-static');

const { processImageFile } = require('./js/image_process');
const { cutVideo, mergeVideos } = require('./js/video_process');
const { 
    sendTelegramMsg, 
    sendStartupMsg, 
    sendShutdownMsg, 
    sendUploadAlert, 
    sendActionAlert, 
    sendVisitAlert
} = require('./js/telegram');

ffmpeg.setFfmpegPath(ffmpegInstaller);

const app = express();
const API_KEY = process.env.API_KEY || "your-secret-key-here";

// --- SSL CONFIGURATION (Let's Encrypt) ---
const sslOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH || path.join(__dirname, 'Certificates', 'ubstudioz.duckdns.org-key.pem')),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH || path.join(__dirname, 'Certificates', 'ubstudioz.duckdns.org-chain.pem'))
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serves the index.html from a 'public' folder

// Dynamic Config Script
app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(`window.UB_CONFIG = { apiKey: "${API_KEY}" };`);
});

const uploadDir = path.join(__dirname, 'uploads');
const trashDir = path.join(uploadDir, '.trash');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir);
if (!fs.existsSync(path.join(uploadDir, 'cut'))) fs.mkdirSync(path.join(uploadDir, 'cut'), { recursive: true });
if (!fs.existsSync(path.join(uploadDir, 'merged'))) fs.mkdirSync(path.join(uploadDir, 'merged'), { recursive: true });

// Security: Domain Whitelisting
const ALLOWED_DOMAINS = [
    `${process.env.DUCKDNS_DOMAIN}.duckdns.org`, 
    'ubstudioz.duckdns.org', 
    'localhost', 
    '127.0.0.1', 
    'movie-soft.web.app'
];
const checkDomain = (req, res, next) => {
    // Only protect routes that serve or list data
    const protectedRoutes = ['/api', '/view', '/download', '/upload'];
    const isProtected = protectedRoutes.some(route => req.path.startsWith(route));
    if (!isProtected) return next();

    const referer = req.headers.referer || req.headers.origin;
    if (!referer) return next();
    try {
        const refUrl = new URL(referer);
        if (ALLOWED_DOMAINS.includes(refUrl.hostname)) return next();
        return res.status(403).send('Forbidden: Domain not whitelisted. No data loaded.');
    } catch (e) {
        return next();
    }
};
app.use(checkDomain);

// --- TELEGRAM NOTIFICATION MIDDLEWARE ---
const notifyAction = (req, res, next) => {
    // Only log meaningful API actions, skip static files and config
    const noise = [
        '.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', 
        '/api/files', '/config.js', '/favicon.ico', '/api/notify-action'
    ];
    if (noise.some(ext => req.path.includes(ext))) return next();

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    sendActionAlert(req.method, req.path, clientIp);
    next();
};
app.use(notifyAction);

// Auth Middleware
const authenticate = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.key;
    if (key === API_KEY) return next();
    res.status(401).send('Unauthorized');
};

// --- ROUTES ---

// 1. LIST FILES & FOLDERS (Updated for paths)
app.get('/api/files', authenticate, (req, res) => {
    const subPath = req.query.path || '';
    const fullPath = path.join(uploadDir, subPath);

    // Security: Prevent directory traversal
    if (!fullPath.startsWith(uploadDir)) {
        return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(fullPath)) return res.status(404).send('Not Found');

    const items = fs.readdirSync(fullPath).map(name => {
        const stats = fs.statSync(path.join(fullPath, name));
        const hlsPath = path.join(fullPath, `${name}_hls`, 'master.m3u8');
        return {
            name,
            isFolder: stats.isDirectory(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            hasHLS: fs.existsSync(hlsPath)
        };
    });
    res.json(items);
});

// 2. UPLOAD (Updated for paths)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const subPath = req.query.path || '';
        const dest = path.join('uploads', subPath);
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.post('/upload', authenticate, upload.single('file'), (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    sendUploadAlert(req.file.filename, req.file.size, clientIp);
    res.send({ message: 'Success', file: req.file.filename });
});

// 3. DELETE (Move to Trash)
app.delete('/api/delete', authenticate, (req, res) => {
    const { name, path: subPath = '' } = req.query;
    if (!name) return res.status(400).send('Name required');

    const names = Array.isArray(name) ? name : [name];
    let count = 0;

    names.forEach(n => {
        const target = path.join(uploadDir, subPath, n);
        if (target.startsWith(uploadDir) && fs.existsSync(target)) {
            try {
                if (subPath === '.trash') {
                    fs.rmSync(target, { recursive: true, force: true });
                } else {
                    const trashedName = `${Date.now()}_${n}`;
                    const dest = path.join(trashDir, trashedName);
                    fs.renameSync(target, dest);
                }
                count++;
            } catch (err) {
                console.error(`❌ Delete Error (${n}):`, err.message);
            }
        }
    });
    res.send({ status: 'Deleted (Moved to Trash)', count });
});

// 4. RENAME / MOVE (Updated for paths)
app.post('/api/rename', authenticate, (req, res) => {
    const { oldName, newName, path: subPath = '' } = req.body || {};
    const oldPath = path.join(uploadDir, subPath, oldName);
    const newPath = path.join(uploadDir, subPath, newName);

    if (!oldPath.startsWith(uploadDir) || !newPath.startsWith(uploadDir)) {
        return res.status(403).send('Forbidden');
    }

    fs.renameSync(oldPath, newPath);
    res.send({ status: 'Renamed' });
});

// 5. DOWNLOAD
app.get('/download/:name', authenticate, (req, res) => {
    const subPath = req.query.path || '';
    const filePath = path.join(uploadDir, subPath, req.params.name);
    if (!filePath.startsWith(uploadDir)) return res.status(403).send('Forbidden');
    res.download(filePath);
});

// 6. VIEW (With Smart Processing)
app.get('/view/:name', authenticate, async (req, res) => {
    const subPath = req.query.path || '';
    const filePath = path.join(uploadDir, subPath, req.params.name);

    if (!filePath.startsWith(uploadDir)) return res.status(403).send('Forbidden');
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    const ext = path.extname(req.params.name).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff'].includes(ext);

    // If it's an image and has processing params
    if (isImage && (req.query.w || req.query.h || req.query.q || req.query.watermark)) {
        try {
            let transform = sharp(filePath);
            const { w, h, q, watermark } = req.query;

            // Resize
            if (w || h) {
                transform = transform.resize(
                    w ? parseInt(w) : null,
                    h ? parseInt(h) : null,
                    { fit: 'cover' }
                );
            }

            // Quality
            if (q) {
                if (ext === '.png') transform = transform.png({ quality: parseInt(q) });
                else transform = transform.jpeg({ quality: parseInt(q) });
            }

            // Watermark (Composite SVG)
            if (watermark) {
                const svgBuffer = Buffer.from(`
                    <svg width="500" height="100">
                        <text x="50%" y="50%" font-family="Arial" font-size="40" fill="white" fill-opacity="0.3" text-anchor="middle" dominant-baseline="middle">
                            ${watermark}
                        </text>
                    </svg>
                `);
                transform = transform.composite([{ input: svgBuffer, gravity: 'center' }]);
            }

            const buffer = await transform.toBuffer();
            res.set('Content-Type', `image/${ext.replace('.', '')}`);
            return res.send(buffer);
        } catch (err) {
            console.error("Sharp Error:", err);
            return res.sendFile(filePath); // Fallback
        }
    }

    res.sendFile(filePath);
});

// 7. CREATE NEW FOLDER
app.post('/api/create-folder', authenticate, (req, res) => {
    const { name, path: subPath = '' } = req.body || {};
    const folderPath = path.join(uploadDir, subPath, name);
    if (!folderPath.startsWith(uploadDir)) return res.status(403).send('Forbidden');

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
        res.send({ status: 'Folder Created' });
    } else {
        res.status(400).send('Folder already exists');
    }
});

// 8. CREATE NEW EMPTY FILE
app.post('/api/create-file', authenticate, (req, res) => {
    const { name, path: subPath = '' } = req.body || {};
    const filePath = path.join(uploadDir, subPath, name);
    if (!filePath.startsWith(uploadDir)) return res.status(403).send('Forbidden');

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
        res.send({ status: 'File Created' });
    } else {
        res.status(400).send('File already exists');
    }
});

// 9. COPY (Bulk Support)
app.post('/api/copy', authenticate, (req, res) => {
    const { sourceName, sourcePath = '', destPath = '' } = req.body || {};
    if (!sourceName) return res.status(400).send('Source required');

    const names = Array.isArray(sourceName) ? sourceName : [sourceName];
    let count = 0;

    names.forEach(n => {
        const src = path.join(uploadDir, sourcePath, n);
        const dest = path.join(uploadDir, destPath, n);
        if (src.startsWith(uploadDir) && dest.startsWith(uploadDir) && fs.existsSync(src)) {
            try {
                fs.cpSync(src, dest, { recursive: true });
                count++;
            } catch (err) { console.error(err); }
        }
    });
    res.send({ status: 'Copied', count });
});

// 10. MOVE / RESTORE
app.post('/api/move', authenticate, (req, res) => {
    const { sourceName, sourcePath = '', destPath = '', isFromTrash } = req.body || {};
    if (!sourceName) return res.status(400).send('Source required');

    const names = Array.isArray(sourceName) ? sourceName : [sourceName];
    let count = 0;

    names.forEach(n => {
        const src = isFromTrash ? path.join(trashDir, n) : path.join(uploadDir, sourcePath, n);
        const finalName = isFromTrash ? n.split('_').slice(1).join('_') : n; // Restore original name
        const dest = path.join(uploadDir, destPath, finalName);

        if ((src.startsWith(uploadDir) || src.startsWith(trashDir)) && dest.startsWith(uploadDir) && fs.existsSync(src)) {
            try {
                fs.renameSync(src, dest);
                count++;
            } catch (err) { console.error(err); }
        }
    });
    res.send({ status: 'Moved', count });
});

// 10.5 EMPTY TRASH
app.post('/api/trash/empty', authenticate, (req, res) => {
    fs.readdirSync(trashDir).forEach(file => {
        fs.rmSync(path.join(trashDir, file), { recursive: true, force: true });
    });
    res.send({ status: 'Trash Emptied' });
});

// 11. SAVE TEXT FILE CONTENT
app.post('/api/save-file', authenticate, (req, res) => {
    const { name, path: subPath = '', content } = req.body || {};
    const filePath = path.join(uploadDir, subPath, name);

    if (!filePath.startsWith(uploadDir)) return res.status(403).send('Forbidden');

    try {
        fs.writeFileSync(filePath, content);
        res.send({ status: 'Saved' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Save failed');
    }
});

// 11.5 PROCESS IMAGE (COMPRESS, WATERMARK, THUMBNAIL)
app.post('/api/process-image', authenticate, async (req, res) => {
    const { name, path: subPath = '', targetMb, watermarkText, addThumbnail } = req.body || {};
    
    try {
        const result = await processImageFile(uploadDir, name, subPath, {
            targetMb: parseFloat(targetMb),
            watermarkText,
            addThumbnail
        });
        res.send(result);
    } catch (err) {
        console.error("❌ Processing Error:", err.message);
        res.status(500).send({ error: err.message });
    }
});

// 11.6 CLIENT-SIDE SDK NOTIFICATION ENDPOINT
app.post('/api/notify-action', authenticate, (req, res) => {
    const { action, details } = req.body || {};
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    if (action === 'visit') {
        sendVisitAlert(clientIp, false);
    } else if (action === 'exit') {
        sendVisitAlert(clientIp, true);
    } else {
        let msg = `📱 *SDK Action*: \`${action}\``;
        if (details) msg += `\n📝 Details: \`${details}\``;
        sendTelegramMsg(msg);
    }
    res.send({ status: 'Notified' });
});

// 11.7 VERIFY PIN (no API key required — just the pin)
const UPDATE_PIN = '0208';
app.post('/api/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    if (pin === UPDATE_PIN) return res.json({ ok: true });
    return res.status(403).json({ ok: false, error: 'Invalid PIN' });
});

// 11.8 UPDATE CONFIG (.env patch + SSL generation + PM2 restart)
app.post('/api/update-config', authenticate, async (req, res) => {
    const { domain, telegramToken } = req.body || {};

    if (!domain && !telegramToken) {
        return res.status(400).json({ error: 'Provide at least domain or telegramToken' });
    }

    try {
        const { updateConfig } = require('./scripts/update_domaine_telegram_token');
        const result = await updateConfig(domain || null, telegramToken || null);

        res.json({ status: 'Updated', restarting: true, ...result });

        // Restart the FileServer process via PM2 after a short delay
        setTimeout(() => {
            const { exec } = require('child_process');
            const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
            const pm2Path  = path.join(__dirname, 'node_modules', 'pm2', 'bin', 'pm2');
            const env = {
                ...process.env,
                PM2_HOME:     path.join(__dirname, 'pm2'),
                PM2_RPC_PORT: '43554',
                PM2_PUB_PORT: '43555'
            };
            exec(`"${nodePath}" "${pm2Path}" restart FileServer`, { env }, (err) => {
                if (err) console.error('❌ PM2 restart failed:', err.message);
                else     console.log('♻️  FileServer restarted via PM2');
            });
        }, 1200);

    } catch (err) {
        console.error('❌ update-config failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 12. PROFESSIONAL HLS TRANSCODING (ABR)
app.post('/api/transcode', authenticate, (req, res) => {
    const { name, path: subPath = '' } = req.body;
    const inputPath = path.join(uploadDir, subPath, name);
    const outputDir = path.join(uploadDir, subPath, `${name}_hls`);

    if (!inputPath.startsWith(uploadDir)) return res.status(403).send('Forbidden');
    if (!fs.existsSync(inputPath)) return res.status(404).send('Source not found');

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    res.send({ status: 'ABR Processing started', outputDir: `${name}_hls` });

    // --- PROFESSIONAL WORKFLOW ---
    // Single-pass transcoding with variants: 1080p, 720p, 480p, 360p
    const cmd = ffmpeg(inputPath)
        .outputOptions([
            // Global HLS Settings
            '-f hls',
            '-hls_time 10',
            '-hls_playlist_type vod',
            '-master_pl_name master.m3u8',
            '-movflags +faststart',
            
            // Map 0:v and 0:a for 4 quality variants
            '-map 0:v', '-map 0:a',
            '-map 0:v', '-map 0:a',
            '-map 0:v', '-map 0:a',
            '-map 0:v', '-map 0:a',

            // Assign maps to variants with names: 1080p, 720p, 480p, 360p
            '-var_stream_map', 'v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p v:3,a:3,name:360p',

            // 1080p (v:0)
            '-s:v:0 1920x1080', '-b:v:0 5000k', '-maxrate:v:0 5350k', '-bufsize:v:0 7500k',
            // 720p (v:1)
            '-s:v:1 1280x720',  '-b:v:1 2800k', '-maxrate:v:1 2996k', '-bufsize:v:1 4200k',
            // 480p (v:2)
            '-s:v:2 854x480',   '-b:v:2 1400k', '-maxrate:v:2 1498k', '-bufsize:v:2 2100k',
            // 360p (v:3)
            '-s:v:3 640x360',   '-b:v:3 800k',  '-maxrate:v:3 856k',  '-bufsize:v:3 1200k',

            // Segment Naming
            '-hls_segment_filename', path.join(outputDir, '%v', 'segment%03d.ts').replace(/\\/g, '/')
        ])
        .output(path.join(outputDir, '%v', 'playlist.m3u8').replace(/\\/g, '/'))
        .on('start', (commandLine) => {
            console.log('🎬 Starting ABR Transcode for:', name);
            // Ensure variant directories exist
            ['1080p', '720p', '480p', '360p'].forEach(v => {
                const vPath = path.join(outputDir, v);
                if (!fs.existsSync(vPath)) fs.mkdirSync(vPath, { recursive: true });
            });
        })
        .on('end', () => {
            console.log('✅ ABR Transcoding complete for:', name);
            // Extract Subtitles in background after video is done
            extractSubtitles(inputPath, outputDir);
        })
        .on('error', (err) => {
            console.error('❌ ABR Error:', err.message);
        });

    cmd.run();
});

// 13. VIDEO CUTTING (Stream Copying)
app.post('/api/video/cut', authenticate, async (req, res) => {
    const { name, path: subPath = '', startTime, endTime } = req.body;
    const inputPath = path.join(uploadDir, subPath, name);
    
    // Generate output name: original_name_cut_TIMESTAMP.ext
    const ext = path.extname(name);
    const baseName = path.basename(name, ext);
    const outputName = `${baseName}_cut_${Date.now()}${ext}`;
    
    // Always save cut files in the 'cut' folder
    const cutFolderPath = path.join(uploadDir, 'cut');
    if (!fs.existsSync(cutFolderPath)) fs.mkdirSync(cutFolderPath, { recursive: true });
    
    const outputPath = path.join(cutFolderPath, outputName);

    if (!inputPath.startsWith(uploadDir)) return res.status(403).send('Forbidden');
    if (!fs.existsSync(inputPath)) return res.status(404).send('Source not found');

    try {
        await cutVideo(inputPath, parseFloat(startTime), parseFloat(endTime), outputPath);
        res.send({ status: 'Success', file: outputName, folder: 'cut' });
    } catch (err) {
        console.error("❌ Cut Error:", err.message);
        res.status(500).send({ error: err.message });
    }
});

// 13.5 VIDEO MERGING (Stream Copying)
app.post('/api/video/merge', authenticate, async (req, res) => {
    const { names, path: subPath = '' } = req.body; // names should be an ordered array
    if (!names || !Array.isArray(names) || names.length === 0) {
        return res.status(400).send('No files provided for merge');
    }

    const inputPaths = names.map(n => path.join(uploadDir, subPath, n));
    
    // Generate output name: merged_TIMESTAMP.mp4 (using extension of first file)
    const ext = path.extname(names[0]) || '.mp4';
    const outputName = `merged_${Date.now()}${ext}`;
    const mergedFolderPath = path.join(uploadDir, 'merged');
    if (!fs.existsSync(mergedFolderPath)) fs.mkdirSync(mergedFolderPath, { recursive: true });
    
    const outputPath = path.join(mergedFolderPath, outputName);

    try {
        await mergeVideos(inputPaths, outputPath);
        res.send({ status: 'Success', file: outputName, folder: 'merged' });
    } catch (err) {
        console.error("❌ Merge Error:", err.message);
        res.status(500).send({ error: err.message });
    }
});

// Helper: Extract Subtitles to WebVTT
function extractSubtitles(inputPath, outputDir) {
    ffmpeg(inputPath)
        .outputOptions([
            '-map 0:s?',
            '-f webvtt'
        ])
        .output(path.join(outputDir, 'subtitles.vtt'))
        .on('end', () => console.log('📑 Subtitles extracted (if any)'))
        .on('error', (err) => console.log('ℹ️ No embedded subtitles found or extraction skipped.'))
        .run();
}

// --- SERVERS ---
const startHttps = () => {
    https.createServer(sslOptions, app).listen(process.env.PORT_HTTPS || 443, '0.0.0.0', () => {
        console.log(`🔒 UB-STUDIOZ Secure Server: https://${process.env.DUCKDNS_DOMAIN}.duckdns.org`);
    }).on('error', (err) => {
        console.error("❌ HTTPS Server Error:", err.message);
        if (err.code === 'EADDRINUSE') {
            console.error(`   Port ${process.env.PORT_HTTPS || 443} is already in use. Try killing other processes.`);
        }
    });
};

const startHttp = () => {
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(process.env.PORT_HTTP || 80).on('error', (err) => {
        console.error("⚠️  HTTP Redirect Server Error:", err.message);
        if (err.code === 'EADDRINUSE') {
            console.error(`   Port ${process.env.PORT_HTTP || 80} is busy. Redirection disabled but HTTPS will still run if possible.`);
        }
    });
};

// --- DUCKDNS AUTO-UPDATE ---
const updateDuckDNS = async () => {
    const domain = process.env.DUCKDNS_DOMAIN;
    const token = process.env.DUCKDNS_TOKEN;

    if (!domain || !token || token === "YOUR_TOKEN_HERE") {
        console.log("ℹ️  DuckDNS update skipped: Domain or Token not configured in .env");
        return;
    }

    try {
        const url = `https://www.duckdns.org/update?domains=${domain}&token=${token}`;
        const response = await fetch(url);
        const result = await response.text();
        if (result === "OK") {
            console.log(`✅ DuckDNS auto-update successful for ${domain}.duckdns.org`);
        } else {
            console.error(`❌ DuckDNS auto-update failed: ${result}`);
        }
    } catch (err) {
        console.error(`❌ DuckDNS auto-update error: ${err.message}`);
    }
};

// Update on start and every 1 hour
updateDuckDNS();
setInterval(updateDuckDNS, 60 * 60 * 1000);

startHttps();
startHttp();

// Send startup notification immediately after servers are up
sendStartupMsg();

// --- STARTUP / SHUTDOWN NOTIFICATIONS ---
const gracefulShutdown = (signal) => {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
    sendShutdownMsg(signal).then(() => {
        process.exit(0);
    });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


