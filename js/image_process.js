const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function processImageFile(uploadDir, filename, subPath, options) {
    const inputPath = path.join(uploadDir, subPath, filename);
    const ext = path.extname(filename).toLowerCase();
    const isPng = ext === '.png';
    const isJpeg = ['.jpg', '.jpeg'].includes(ext);

    if (!fs.existsSync(inputPath)) {
        throw new Error('File not found');
    }

    const { targetMb, watermarkText, addThumbnail } = options;
    const stats = fs.statSync(inputPath);
    const originalSizeMb = stats.size / (1024 * 1024);

    let transform = sharp(inputPath);

    // 1. Watermarking
    if (watermarkText) {
        const svgBuffer = Buffer.from(`
            <svg width="800" height="200">
                <style>
                    .text { fill: white; fill-opacity: 0.3; font-size: 60px; font-weight: bold; font-family: sans-serif; }
                </style>
                <text x="50%" y="50%" class="text" text-anchor="middle" dominant-baseline="middle">
                    ${watermarkText}
                </text>
            </svg>
        `);
        transform = transform.composite([{ input: svgBuffer, gravity: 'center' }]);
    }

    // 2. Compression
    // Heuristic: scale quality based on target vs current size
    let quality = 100;
    if (targetMb && originalSizeMb > 0) {
        const ratio = targetMb / originalSizeMb;
        quality = Math.max(5, Math.min(95, Math.round(ratio * 90)));
    }

    if (isPng) {
        transform = transform.png({ quality, compressionLevel: 9 });
    } else if (isJpeg) {
        transform = transform.jpeg({ quality, mozjpeg: true });
    } else {
        transform = transform.webp({ quality });
    }

    // 3. Save Processed File
    const outputPath = inputPath; // Overwrite
    const tempPath = inputPath + '.tmp';
    await transform.toFile(tempPath);
    fs.renameSync(tempPath, outputPath);

    // 4. Generate Thumbnail if requested
    let thumbnailName = null;
    if (addThumbnail) {
        thumbnailName = `thumb_${filename}`;
        const thumbPath = path.join(uploadDir, subPath, thumbnailName);
        await sharp(inputPath)
            .resize(200, 200, { fit: 'cover' })
            .toFile(thumbPath);
    }

    const newStats = fs.statSync(outputPath);
    return {
        success: true,
        originalSize: originalSizeMb.toFixed(2) + ' MB',
        newSize: (newStats.size / (1024 * 1024)).toFixed(2) + ' MB',
        thumbnail: thumbnailName
    };
}

module.exports = { processImageFile };
