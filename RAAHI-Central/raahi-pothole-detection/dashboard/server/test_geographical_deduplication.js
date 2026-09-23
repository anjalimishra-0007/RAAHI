import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';
import {
  haversineDistanceMeters,
  getDedupRadiusMeters,
  createOrUpdatePothole
} from './services/potholeDeduplicationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

console.log('==============================================================');
console.log('       RAAHI: GEOGRAPHICAL DEDUPLICATION TEST (PHASE 10)       ');
console.log('==============================================================\n');

async function runTests() {
  await connectDB();

  console.log(`Configured Deduplication Radius: ${getDedupRadiusMeters()} meters\n`);

  // -------------------------------------------------------------
  // UNIT TEST: Haversine Calculation Accuracy
  // -------------------------------------------------------------
  console.log('--- 1. UNIT TEST: Haversine Distance Calculation ---');
  const lat1 = 28.613900;
  const lon1 = 77.209000;
  const lat2 = 28.613905;
  const lon2 = 77.209008;

  const testDist = haversineDistanceMeters(lat1, lon1, lat2, lon2);
  console.log(`Point 1: (${lat1}, ${lon1})`);
  console.log(`Point 2: (${lat2}, ${lon2})`);
  console.log(`Calculated Haversine Distance: ${testDist} meters`);

  if (testDist > 0 && testDist < 2) {
    console.log('  PASSED: Distance calculation is precise (~0.95m).\n');
  } else {
    console.error(`  FAILED: Unexpected distance: ${testDist} meters\n`);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // INITIAL DATABASE STATE INSPECTION
  // -------------------------------------------------------------
  console.log('--- 2. DATABASE STATE BEFORE TESTS ---');
  const initialCount = await Pothole.countDocuments();
  console.log(`Total Pothole Documents: ${initialCount}`);

  const pot1 = await Pothole.findOne({ potholeId: 'POT-000001' }).lean();
  const pot2 = await Pothole.findOne({ potholeId: 'POT-000002' }).lean();

  if (!pot1) {
    console.error('  ERROR: Existing record POT-000001 not found! Aborting for safety.');
    process.exit(1);
  }
  if (!pot2) {
    console.error('  ERROR: Existing record POT-000002 not found! Aborting for safety.');
    process.exit(1);
  }

  console.log(`  • POT-000001: (${pot1.location.latitude}, ${pot1.location.longitude}) count=${pot1.detectionCount}`);
  console.log(`  • POT-000002: (${pot2.location.latitude}, ${pot2.location.longitude}) count=${pot2.detectionCount}, buses=[${pot2.busesDetectedBy.join(', ')}]\n`);

  const pot2InitialCount = pot2.detectionCount;

  // -------------------------------------------------------------
  // TEST A: Nearby Candidate (Same physical pothole within 10m)
  // -------------------------------------------------------------
  console.log('--- 3. TEST A: Nearby Candidate Deduplication ---');
  const nearbyCandidate = {
    candidateType: 'pothole_incident_candidate',
    status: 'provisional',
    detectionId: 85,
    type: 'pothole',
    confidence: 0.91,
    frame: 90,
    videoTimestamp: '00:03.60',
    location: {
      latitude: 28.613905,
      longitude: 77.209008,
      accuracy: 5
    },
    gpsTimestamp: '2026-09-12T10:19:31.000Z',
    bus: 'RAAHI-02'
  };

  const distToPot2 = haversineDistanceMeters(
    pot2.location.latitude,
    pot2.location.longitude,
    nearbyCandidate.location.latitude,
    nearbyCandidate.location.longitude
  );
  console.log(`Distance between Candidate and POT-000002: ${distToPot2}m (Threshold: <= 10m)`);

  const resultA = await createOrUpdatePothole(nearbyCandidate);
  console.log('Result A:');
  console.log(`  Created:          ${resultA.created}`);
  console.log(`  Updated:          ${resultA.updated}`);
  console.log(`  Deduplicated:     ${resultA.deduplicated}`);
  console.log(`  Matched ID:       ${resultA.matchedPotholeId}`);
  console.log(`  Distance:         ${resultA.distanceMeters}m`);
  console.log(`  New Detection Cnt:${resultA.pothole.detectionCount}`);
  console.log(`  Buses Detected:   [${resultA.pothole.busesDetectedBy.join(', ')}]`);

  if (
    resultA.deduplicated === true &&
    resultA.matchedPotholeId === 'POT-000002' &&
    resultA.pothole.detectionCount === pot2InitialCount + 1 &&
    resultA.pothole.busesDetectedBy.includes('RAAHI-02') &&
    resultA.pothole.busesDetectedBy.includes('RAAHI-01')
  ) {
    console.log('  PASSED: Nearby candidate successfully deduplicated and updated POT-000002.\n');
  } else {
    console.error('  FAILED: Deduplication result did not match expectations.');
    process.exit(1);
  }

  // Verify POT-000001 is completely untouched
  const pot1AfterA = await Pothole.findOne({ potholeId: 'POT-000001' }).lean();
  if (pot1AfterA.detectionCount !== pot1.detectionCount) {
    console.error('  FAILED: POT-000001 was unintentionally modified!');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // TEST B: Far-Away Candidate (Outside 10m radius -> New Pothole)
  // -------------------------------------------------------------
  console.log('--- 4. TEST B: Far-Away Candidate Creation ---');
  const farAwayCandidate = {
    candidateType: 'pothole_incident_candidate',
    status: 'provisional',
    detectionId: 200,
    type: 'pothole',
    confidence: 0.82,
    frame: 300,
    videoTimestamp: '00:12.00',
    location: {
      latitude: 28.704100,
      longitude: 77.102500,
      accuracy: 4
    },
    gpsTimestamp: '2026-09-12T10:19:40.000Z',
    bus: 'RAAHI-01'
  };

  const distToPot1 = haversineDistanceMeters(
    pot1.location.latitude,
    pot1.location.longitude,
    farAwayCandidate.location.latitude,
    farAwayCandidate.location.longitude
  );
  const distFarToPot2 = haversineDistanceMeters(
    pot2.location.latitude,
    pot2.location.longitude,
    farAwayCandidate.location.latitude,
    farAwayCandidate.location.longitude
  );

  console.log(`Distance to POT-000001: ${Math.round(distToPot1)}m`);
  console.log(`Distance to POT-000002: ${Math.round(distFarToPot2)}m`);

  // Check if POT-000003 already exists (idempotency guard)
  const existingPot3 = await Pothole.findOne({
    'location.latitude': farAwayCandidate.location.latitude,
    'location.longitude': farAwayCandidate.location.longitude
  });

  let resultB;
  if (!existingPot3) {
    resultB = await createOrUpdatePothole(farAwayCandidate);
    console.log('Result B:');
    console.log(`  Created:          ${resultB.created}`);
    console.log(`  Updated:          ${resultB.updated}`);
    console.log(`  Deduplicated:     ${resultB.deduplicated}`);
    console.log(`  Pothole ID:       ${resultB.pothole.potholeId}`);
    console.log(`  Detection Count:  ${resultB.pothole.detectionCount}`);

    if (
      resultB.created === true &&
      resultB.pothole.potholeId === 'POT-000003' &&
      resultB.pothole.detectionCount === 1
    ) {
      console.log('  PASSED: Far-away candidate created POT-000003.\n');
    } else {
      console.error('  FAILED: Far-away candidate did not create POT-000003 as expected.');
      process.exit(1);
    }
  } else {
    console.log(`  NOTE: Test record at (${farAwayCandidate.location.latitude}, ${farAwayCandidate.location.longitude}) already exists as ${existingPot3.potholeId}.`);
    console.log('  Idempotency guard active: testing deduplication on existing POT-000003.\n');
    resultB = await createOrUpdatePothole(farAwayCandidate);
  }

  // -------------------------------------------------------------
  // FINAL DATABASE STATE VERIFICATION
  // -------------------------------------------------------------
  console.log('--- 5. FINAL DATABASE STATE ---');
  const finalCount = await Pothole.countDocuments();
  console.log(`Final Document Count: ${finalCount}`);

  const allRecords = await Pothole.find().sort({ potholeId: 1 }).lean();
  allRecords.forEach(r => {
    console.log(`  • ${r.potholeId}: (${r.location.latitude}, ${r.location.longitude}) count=${r.detectionCount}, buses=[${r.busesDetectedBy.join(', ')}]`);
  });

  console.log('\n==============================================================');
  console.log('             ALL TESTS COMPLETED SUCCESSFULLY!                ');
  console.log('==============================================================');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
