import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const DEFAULT_SOURCE_VIDEO = path.join(PROJECT_ROOT, 'videos/input/cityRoad_potHoles-side.mp4');
const DEFAULT_EVIDENCE_DIR = path.join(PROJECT_ROOT, 'videos/evidence');

/**
 * Video Evidence Service (Phase 12)
 * =================================
 * Dynamically extracts short (5-second) evidence clips from the primary road video
 * centered on verified YOLO detection timestamps.
 */

/**
 * Parses timestamp string (MM:SS.ss or HH:MM:SS) or number to total seconds.
 * 
 * @param {string|number} ts - Input timestamp
 * @returns {number} Seconds as float
 */
export function parseTimestampToSeconds(ts) {
  if (typeof ts === 'number') {
    return Number.isFinite(ts) && ts >= 0 ? ts : null;
  }
  if (!ts || typeof ts !== 'string') {
    return null;
  }

  const trimmed = ts.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length === 2) {
    // MM:SS or MM:SS.ss
    const min = parseFloat(parts[0]);
    const sec = parseFloat(parts[1]);
    if (isNaN(min) || isNaN(sec) || min < 0 || sec < 0) return null;
    return min * 60 + sec;
  } else if (parts.length === 3) {
    // HH:MM:SS
    const hr = parseFloat(parts[0]);
    const min = parseFloat(parts[1]);
    const sec = parseFloat(parts[2]);
    if (isNaN(hr) || isNaN(min) || isNaN(sec) || hr < 0 || min < 0 || sec < 0) return null;
    return hr * 3600 + min * 60 + sec;
  }

  const directNum = parseFloat(trimmed);
  return !isNaN(directNum) && directNum >= 0 ? directNum : null;
}

/**
 * Formats seconds into MM:SS.ss timestamp string.
 * 
 * @param {number} sec - Seconds
 * @returns {string} e.g. "00:03.60"
 */
export function formatSecondsToTimestamp(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

/**
 * Reads exact video metadata (FPS, duration, frames, resolution) using ffprobe.
 * Does NOT assume fixed FPS.
 * 
 * @param {string} videoPath - Absolute path to video file
 * @returns {Promise<{ width: number, height: number, fps: number, duration: number, totalFrames: number }>}
 */
export async function getVideoMetadata(videoPath = DEFAULT_SOURCE_VIDEO) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Source video not found at: ${videoPath}`);
  }

  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration',
    '-of', 'json',
    videoPath
  ];

  try {
    const { stdout } = await execFileAsync('ffprobe', args);
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];

    if (!stream) {
      throw new Error("No video stream found in file.");
    }

    // Parse FPS from r_frame_rate (e.g. "25/1")
    let fps = 25.0;
    if (stream.r_frame_rate) {
      const [num, den] = stream.r_frame_rate.split('/').map(Number);
      if (num && den) {
        fps = Math.round((num / den) * 100) / 100;
      }
    }

    const duration = parseFloat(stream.duration) || 0;
    const totalFrames = parseInt(stream.nb_frames, 10) || Math.round(duration * fps);

    return {
      width: stream.width,
      height: stream.height,
      fps,
      duration,
      totalFrames
    };
  } catch (err) {
    throw new Error(`Failed to probe video metadata: ${err.message}`);
  }
}

/**
 * Extracts a 5-second evidence MP4 clip centered on detection timestamp.
 * Window: [T - windowBefore, T + windowAfter] (clamped to video boundaries).
 * 
 * @param {object} options
 * @param {string} options.potholeId - Pothole ID (e.g. "POT-000002")
 * @param {number|string} options.detectionId - Detection ID (e.g. 85)
 * @param {string|number} options.videoTimestamp - Detection timestamp (e.g. "00:03.60")
 * @param {string} [options.sourceVideoPath] - Source video path (defaults to cityRoad_potHoles-side.mp4)
 * @param {number} [options.windowBefore=2.0] - Seconds before detection
 * @param {number} [options.windowAfter=3.0] - Seconds after detection
 * @returns {Promise<object>} Generated clip metadata and absolute file path
 */
export async function extractClip({
  potholeId,
  detectionId = 85,
  videoTimestamp = '00:03.60',
  sourceVideoPath = DEFAULT_SOURCE_VIDEO,
  windowBefore = 2.0,
  windowAfter = 3.0
}) {
  if (!potholeId || typeof potholeId !== 'string' || !potholeId.trim()) {
    throw new Error("Missing or invalid required 'potholeId'.");
  }

  if (detectionId === undefined || detectionId === null || isNaN(Number(detectionId))) {
    throw new Error(`Invalid 'detectionId': must be a valid number, got '${detectionId}'.`);
  }

  const targetSeconds = parseTimestampToSeconds(videoTimestamp);
  if (targetSeconds === null) {
    throw new Error(`Invalid 'videoTimestamp': '${videoTimestamp}'. Must be MM:SS, MM:SS.ss, or valid seconds.`);
  }

  if (!fs.existsSync(sourceVideoPath)) {
    throw new Error(`Source video not found: ${sourceVideoPath}`);
  }

  // 1. Read metadata from actual video file
  const meta = await getVideoMetadata(sourceVideoPath);

  // 2. Compute extraction window clamped to video length
  const startTime = Math.max(0, targetSeconds - windowBefore);
  const endTime = Math.min(meta.duration, targetSeconds + windowAfter);
  const duration = Math.round((endTime - startTime) * 100) / 100;

  // 3. Ensure evidence output directory exists
  if (!fs.existsSync(DEFAULT_EVIDENCE_DIR)) {
    fs.mkdirSync(DEFAULT_EVIDENCE_DIR, { recursive: true });
  }

  // 4. Deterministic filename: POT-XXXXXX_detection-XX.mp4
  const fileName = `${potholeId.trim()}_detection-${Number(detectionId)}.mp4`;
  const localPath = path.join(DEFAULT_EVIDENCE_DIR, fileName);

  console.log(`[VideoEvidenceService] Extracting evidence clip for ${potholeId}:`);
  console.log(`  Source:     ${sourceVideoPath}`);
  console.log(`  Target:     ${videoTimestamp} (${targetSeconds.toFixed(2)}s)`);
  console.log(`  Window:     ${startTime.toFixed(2)}s to ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`);
  console.log(`  Output:     ${localPath}`);

  // 5. Run ffmpeg with H.264 video codec and AAC audio for browser compatibility
  const ffmpegArgs = [
    '-y',
    '-ss', startTime.toFixed(3),
    '-i', sourceVideoPath,
    '-t', duration.toFixed(3),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-pix_fmt', 'yuv420p',
    localPath
  ];

  try {
    await execFileAsync('ffmpeg', ffmpegArgs);
  } catch (err) {
    throw new Error(`ffmpeg extraction failed: ${err.message}`);
  }

  // 6. Verify generated file exists and has valid size
  if (!fs.existsSync(localPath)) {
    throw new Error(`Evidence clip was not written to: ${localPath}`);
  }

  const stat = fs.statSync(localPath);
  if (stat.size === 0) {
    throw new Error(`Evidence clip is empty (0 bytes): ${localPath}`);
  }

  // 7. Verify clip health with ffprobe
  const clipMeta = await getVideoMetadata(localPath);

  return {
    fileName,
    localPath,
    durationSeconds: clipMeta.duration,
    startTime: formatSecondsToTimestamp(startTime),
    endTime: formatSecondsToTimestamp(endTime),
    detectionTime: formatSecondsToTimestamp(targetSeconds),
    fps: clipMeta.fps,
    fileSizeBytes: stat.size
  };
}
