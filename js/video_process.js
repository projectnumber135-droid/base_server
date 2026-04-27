const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

const path = require('path');
// Tell fluent-ffmpeg where the ffmpeg binary is
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Cuts a video using Stream Copying (No re-encoding)
 * @param {string} input - Path to source file
 * @param {number} start - In-time (seconds)
 * @param {number} end - Out-time (seconds)
 * @param {string} output - Save location
 * @returns {Promise}
 */
function cutVideo(input, start, end, output) {
    return new Promise((resolve, reject) => {
        const duration = end - start;
        console.log(`🎬 Starting cut: ${input} (${start}s to ${end}s)`);
        
        ffmpeg()
            .input(input)
            .inputOptions([`-ss ${start}`]) // Input seeking (fast)
            .outputOptions([
                `-t ${duration}`,
                '-c copy',         // The magic: copies streams without re-encoding
                '-map 0'           // Ensures all streams are moved
            ])
            .on('start', (command) => {
                console.log('Running FFmpeg with: ' + command);
            })
            .on('error', (err) => {
                console.error('Error: ' + err.message);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Cut Completed Successfully!');
                resolve({ output, start, end, duration });
            })
            .save(output);
    });
}

/**
 * Merges multiple videos using the Concat Demuxer (Stream Copying)
 * @param {string[]} inputs - Array of paths to source files
 * @param {string} output - Save location
 * @returns {Promise}
 */
function mergeVideos(inputs, output) {
    return new Promise((resolve, reject) => {
        if (!inputs || inputs.length === 0) return reject(new Error("No inputs provided"));
        
        console.log(`🎬 Starting merge of ${inputs.length} files...`);
        
        const fs = require('fs');
        const tempFileList = path.join(path.dirname(output), `concat_list_${Date.now()}.txt`);
        
        // Create the concat list file
        const fileContent = inputs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(tempFileList, fileContent);

        ffmpeg()
            .input(tempFileList)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions(['-c copy'])
            .on('start', (command) => {
                console.log('Running FFmpeg merge with: ' + command);
            })
            .on('error', (err) => {
                console.error('Merge Error: ' + err.message);
                if (fs.existsSync(tempFileList)) fs.unlinkSync(tempFileList);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Merge Completed Successfully!');
                if (fs.existsSync(tempFileList)) fs.unlinkSync(tempFileList);
                resolve({ output });
            })
            .save(output);
    });
}

module.exports = { cutVideo, mergeVideos };