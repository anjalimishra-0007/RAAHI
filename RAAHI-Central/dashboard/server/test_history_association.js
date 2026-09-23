import {
  parseVideoTimestampToSeconds,
  toEpochMs,
  evaluateGpsAccuracy,
  matchDetectionToGps,
  createPotholeCandidate
} from './utils/gpsMatcher.js';

console.log('==============================================================');
console.log('  RAAHI: GPS HISTORY BUFFER & REAL DETECTION ASSOCIATION TEST ');
console.log('==============================================================\n');

// -------------------------------------------------------------
// SCENARIO: Bus RAAHI-01 is driving along a route
// Phone streams GPS samples every 1 second (1000ms interval)
// -------------------------------------------------------------
const videoStartTime = '2026-09-12T10:19:27.000Z'; // Recording start UTC

const simulatedGpsHistory = [
  { timestamp: '2026-09-12T10:19:27.000Z', latitude: 28.613010, longitude: 77.208100, accuracy: 4.2 }, // Frame 0
  { timestamp: '2026-09-12T10:19:28.000Z', latitude: 28.613320, longitude: 77.208420, accuracy: 4.0 }, // Frame 25 (00:01.00)
  { timestamp: '2026-09-12T10:19:29.000Z', latitude: 28.613610, longitude: 77.208710, accuracy: 4.5 }, // Frame 50 (00:02.00)
  { timestamp: '2026-09-12T10:19:30.400Z', latitude: 28.613900, longitude: 77.209000, accuracy: 5.0 }, // ~ Frame 84 (00:03.36)
  { timestamp: '2026-09-12T10:19:31.500Z', latitude: 28.614210, longitude: 77.209320, accuracy: 6.1 }  // Frame 112 (00:04.50)
];

console.log(`Video Recording Anchor (videoStartTime): ${videoStartTime}`);
console.log(`GPS Session History Buffer: ${simulatedGpsHistory.length} samples stored.\n`);

// -------------------------------------------------------------
// TEST CASE 1: Successful Association within 2000ms window
// -------------------------------------------------------------
console.log('--- TEST 1: Successful Association within 2000ms window ---');
const detection1 = {
  id: 84,
  type: 'pothole',
  confidence: 0.87,
  frame: 84,
  timestamp: '00:03.36' // 3.36 sec => 10:19:30.360Z
};

console.log(`Detection: ID ${detection1.id} • ${detection1.type} (${detection1.confidence * 100}%)`);
console.log(`  videoTimestamp:     ${detection1.timestamp} (Frame ${detection1.frame})`);

const match1 = matchDetectionToGps({
  detectionTime: detection1.timestamp,
  gpsSamples: simulatedGpsHistory,
  videoStartTime,
  maxDeltaMs: 2000
});

console.log('Match Result:');
console.log(`  matched:            ${match1.matched}`);
console.log(`  detectionTimestamp: ${match1.detectionTimestamp}`);
console.log(`  gpsTimestamp:       ${match1.gpsTimestamp}`);
console.log(`  timeDeltaMs:        ${match1.timeDeltaMs} ms (${match1.timeDeltaSec}s)`);
console.log(`  matchedLocation:    (${match1.location.latitude}, ${match1.location.longitude})`);
console.log(`  accuracy:           ±${match1.location.accuracy}m (${match1.accuracyEvaluation.label})`);
console.log(`  syncQuality:        ${match1.quality.toUpperCase()}`);

const candidate1 = createPotholeCandidate(detection1, match1, 'RAAHI-01');
console.log('\nPothole Incident Candidate:');
console.log(JSON.stringify({
  candidateType: candidate1.candidateType,
  status: candidate1.status,
  detectionId: candidate1.detectionId,
  type: candidate1.type,
  confidence: candidate1.confidence,
  videoTimestamp: candidate1.videoTimestamp,
  detectionTimestamp: candidate1.gpsTimestamp ? match1.detectionTimestamp : null,
  location: candidate1.location,
  gpsTimestamp: candidate1.gpsTimestamp,
  timeDeltaMs: candidate1.timeDeltaMs,
  syncQuality: candidate1.syncQuality
}, null, 2));

// -------------------------------------------------------------
// TEST CASE 2: Failed Association exceeding 2000ms window (Safety Filter)
// -------------------------------------------------------------
console.log('\n--------------------------------------------------------------');
console.log('--- TEST 2: Failed Association (Out of 2000ms window) ---');
const detection2 = {
  id: 195,
  type: 'pothole',
  confidence: 0.79,
  frame: 450,
  timestamp: '00:18.00' // 18 seconds => 10:19:45.000Z (latest GPS is 10:19:31.500Z => delta 13.5s)
};

console.log(`Detection: ID ${detection2.id} • ${detection2.type}`);
console.log(`  videoTimestamp:     ${detection2.timestamp}`);

const match2 = matchDetectionToGps({
  detectionTime: detection2.timestamp,
  gpsSamples: simulatedGpsHistory,
  videoStartTime,
  maxDeltaMs: 2000
});

console.log('Match Result:');
console.log(`  matched:            ${match2.matched}`);
console.log(`  reason:             ${match2.reason}`);
console.log(`  timeDeltaMs:        ${match2.timeDeltaMs} ms (exceeds ${match2.maxDeltaMs} ms threshold)`);
console.log(`  closestSample:      ${match2.closestSample ? match2.closestSample.timestamp : 'none'}`);

// -------------------------------------------------------------
// TEST CASE 3: Accuracy Evaluation
// -------------------------------------------------------------
console.log('\n--------------------------------------------------------------');
console.log('--- TEST 3: GPS Accuracy Preservation & Quality Rating ---');
[3.5, 8.0, 18.0, 45.0].forEach(acc => {
  const rating = evaluateGpsAccuracy(acc);
  console.log(`  GPS Accuracy ±${acc}m -> Tier: ${rating.tier.padEnd(9)} | Reliability Score: ${rating.score} | Usable: ${rating.usable}`);
});

console.log('\n==============================================================');
console.log('              ALL ASSOCIATION TESTS COMPLETED                 ');
console.log('==============================================================');
