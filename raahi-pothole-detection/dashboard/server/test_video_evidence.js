import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  getVideoMetadata,
  extractClip,
  parseTimestampToSeconds,
  formatSecondsToTimestamp
} from './services/videoEvidenceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const SOURCE_VIDEO = path.join(PROJECT_ROOT, 'videos/input/cityRoad_potHoles-side.mp4');
const EXPECTED_SOURCE_MD5 = '62a13fc3c8049c98c5e210af82179aaf';

console.log('==============================================================');
console.log('      RAAHI: VIDEO EVIDENCE EXTRACTION TEST (PHASE 12)        ');
console.log('==============================================================\n');

function getFileMd5(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function runTest() {
  // 1. Verify source video exists and checksum matches
  console.log('--- 1. SOURCE VIDEO INTEGRITY CHECK ---');
  if (!fs.existsSync(SOURCE_VIDEO)) {
    console.error(`ERROR: Source video does not exist at ${SOURCE_VIDEO}`);
    process.exit(1);
  }

  const initialMd5 = getFileMd5(SOURCE_VIDEO);
  console.log(`Source Video: ${SOURCE_VIDEO}`);
  console.log(`Source MD5:   ${initialMd5}`);

  if (initialMd5 !== EXPECTED_SOURCE_MD5) {
    console.error(`ERROR: Source video MD5 mismatch! Expected ${EXPECTED_SOURCE_MD5}, got ${initialMd5}`);
    process.exit(1);
  }
  console.log('  PASSED: Source video integrity verified.\n');

  // 2. Test metadata extraction via ffprobe
  console.log('--- 2. SOURCE VIDEO METADATA PROBE ---');
  const metadata = await getVideoMetadata(SOURCE_VIDEO);
  console.log(`Resolution:   ${metadata.width}x${metadata.height}`);
  console.log(`FPS:          ${metadata.fps}`);
  console.log(`Duration:     ${metadata.duration}s`);
  console.log(`Total Frames: ${metadata.totalFrames}`);

  if (metadata.fps === 25.0 && metadata.duration > 24) {
    console.log('  PASSED: Metadata extraction is accurate.\n');
  } else {
    console.error('  FAILED: Unexpected metadata values.');
    process.exit(1);
  }

  // 3. Test extraction for POT-000002, detection 85 at 00:03.60
  console.log('--- 3. EVIDENCE CLIP EXTRACTION ---');
  const potholeId = 'POT-000002';
  const detectionId = 85;
  const videoTimestamp = '00:03.60';

  const clipResult = await extractClip({
    potholeId,
    detectionId,
    videoTimestamp,
    sourceVideoPath: SOURCE_VIDEO,
    windowBefore: 2.0,
    windowAfter: 3.0
  });

  console.log('\nExtracted Clip Result:');
  console.log(`  File Name:    ${clipResult.fileName}`);
  console.log(`  Local Path:   ${clipResult.localPath}`);
  console.log(`  Duration:     ${clipResult.durationSeconds.toFixed(2)}s`);
  console.log(`  Start Time:   ${clipResult.startTime}`);
  console.log(`  End Time:     ${clipResult.endTime}`);
  console.log(`  FPS:          ${clipResult.fps}`);
  console.log(`  Size:         ${clipResult.fileSizeBytes} bytes`);

  if (
    fs.existsSync(clipResult.localPath) &&
    clipResult.durationSeconds >= 4.9 &&
    clipResult.durationSeconds <= 5.1 &&
    clipResult.fileSizeBytes > 100000
  ) {
    console.log('  PASSED: Evidence clip generated and verified successfully.\n');
  } else {
    console.error('  FAILED: Evidence clip verification failed.');
    process.exit(1);
  }

  // 4. Verify source video is 100% untouched
  console.log('--- 4. POST-EXTRACTION SOURCE VIDEO INTEGRITY ---');
  const postMd5 = getFileMd5(SOURCE_VIDEO);
  console.log(`Source MD5 after extraction: ${postMd5}`);

  if (postMd5 === EXPECTED_SOURCE_MD5) {
    console.log('  PASSED: Source video was NOT modified during extraction.\n');
  } else {
    console.error('  FAILED: Source video was corrupted or modified!');
    process.exit(1);
  }

  console.log('==============================================================');
  console.log('             VIDEO EXTRACTION TEST PASSED!                    ');
  console.log('==============================================================');
}

runTest().catch(err => {
  console.error('Extraction test failed:', err);
  process.exit(1);
});
