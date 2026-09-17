import {
  parseVideoTimestampToSeconds,
  toEpochMs,
  evaluateGpsAccuracy,
  matchDetectionToGps,
  createPotholeCandidate
} from './utils/gpsMatcher.js';

console.log('==============================================================');
console.log('      RAAHI: GPS + YOLO DETECTION TIMING & ASSOCIATION TEST    ');
console.log('==============================================================\n');

// -------------------------------------------------------------
// TEST CASE 1: Relative Video Timestamp Matching (Task 5 Example)
// -------------------------------------------------------------
console.log('--- TEST 1: Relative Timestamp Matching ---');
const detectionTime = '00:03.36';

const relativeGpsSamples = [
  { timestamp: '00:03.20', latitude: 28.6130, longitude: 77.2085, accuracy: 4.5, name: 'Location A' },
  { timestamp: '00:03.40', latitude: 28.6139, longitude: 77.2090, accuracy: 5.0, name: 'Location B' },
  { timestamp: '00:03.60', latitude: 28.6148, longitude: 77.2095, accuracy: 8.2, name: 'Location C' }
];

console.log(`Input Detection Timestamp: ${detectionTime}`);
console.log('Available GPS Samples:');
relativeGpsSamples.forEach(s => {
  console.log(`  • ${s.timestamp} -> (${s.latitude}, ${s.longitude}) ±${s.accuracy}m [${s.name}]`);
});

const matchResult1 = matchDetectionToGps({
  detectionTime,
  gpsSamples: relativeGpsSamples
});

console.log('\nMatch Result:');
console.log(`  Matched Location: (${matchResult1.matchedGps.latitude}, ${matchResult1.matchedGps.longitude})`);
console.log(`  Matched Timestamp: ${matchResult1.matchedGps.timestamp}`);
console.log(`  Time Delta:        ${matchResult1.timeDeltaMs} ms (${matchResult1.timeDeltaSec} sec)`);
console.log(`  Sync Quality:      ${matchResult1.quality.toUpperCase()}`);
console.log(`  Accuracy Rating:   ${matchResult1.accuracyEvaluation.label}`);

const candidate1 = createPotholeCandidate(
  { id: 84, type: 'pothole', confidence: 0.87, frame: 84, timestamp: detectionTime },
  matchResult1,
  'RAAHI-01'
);

console.log('\nGenerated Pothole Candidate Structure:');
console.log(JSON.stringify(candidate1, null, 2));

// -------------------------------------------------------------
// TEST CASE 2: Absolute UTC Timestamp Matching
// -------------------------------------------------------------
console.log('\n--------------------------------------------------------------');
console.log('--- TEST 2: Absolute UTC Timestamp Matching (Real World) ---');
const videoStartTime = '2026-09-12T10:15:00.000Z';
const detectionTime2 = '00:03.36'; // 3.36 seconds after video start => 10:15:03.360Z

const utcGpsSamples = [
  { timestamp: '2026-09-12T10:15:01.000Z', latitude: 28.6132, longitude: 77.2082, accuracy: 4.0 },
  { timestamp: '2026-09-12T10:15:03.300Z', latitude: 28.6138, longitude: 77.2089, accuracy: 3.8 }, // delta = 60ms
  { timestamp: '2026-09-12T10:15:05.000Z', latitude: 28.6145, longitude: 77.2096, accuracy: 5.2 }
];

console.log(`Video Recording Start (UTC): ${videoStartTime}`);
console.log(`Detection in Video:          ${detectionTime2}`);
console.log(`Computed Detection Time:     2026-09-12T10:15:03.360Z`);

const matchResult2 = matchDetectionToGps({
  detectionTime: detectionTime2,
  gpsSamples: utcGpsSamples,
  videoStartTime
});

console.log('\nMatch Result:');
console.log(`  Matched GPS Time:  ${matchResult2.matchedGps.timestamp}`);
console.log(`  Time Delta:        ${matchResult2.timeDeltaMs} ms`);
console.log(`  Accuracy:          ±${matchResult2.matchedGps.accuracy}m`);
console.log(`  Match Quality:     ${matchResult2.quality}`);

// -------------------------------------------------------------
// TEST CASE 3: GPS Accuracy Filtering & Drift Degradation
// -------------------------------------------------------------
console.log('\n--------------------------------------------------------------');
console.log('--- TEST 3: Accuracy Handling (±3m vs ±50m) ---');
const accuracies = [3.2, 10.5, 25.0, 65.0, null];
accuracies.forEach(acc => {
  const evalResult = evaluateGpsAccuracy(acc);
  console.log(`  Accuracy: ${acc !== null ? `±${acc}m` : 'null'} => Tier: ${evalResult.tier.padEnd(10)} | Score: ${evalResult.score} | Usable: ${evalResult.usable} | ${evalResult.label}`);
});

console.log('\n==============================================================');
console.log('              ALL ASSOCIATION TESTS COMPLETED                 ');
console.log('==============================================================');
