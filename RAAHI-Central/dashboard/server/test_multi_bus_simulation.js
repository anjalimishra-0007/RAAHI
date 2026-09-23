/**
 * Automated Multi-Bus Fleet Simulation & Deduplication Test Suite
 * ===============================================================
 * Validates the 8 core assertions specified in Phase 18.9:
 *   TEST 1: First bus creates an incident.
 *   TEST 2: Second bus detects the same physical pothole (same potholeId).
 *   TEST 3: Third bus detects the same physical pothole (same potholeId).
 *   TEST 4: detectionCount becomes 3.
 *   TEST 5: busesDetectedBy contains all three buses.
 *   TEST 6: No duplicate pothole document is created for the same physical location.
 *   TEST 7: A far-away pothole creates a different potholeId.
 *   TEST 8: Same bus repeated detection does not duplicate the bus ID.
 *
 * Usage:
 *   node dashboard/server/test_multi_bus_simulation.js
 */

import { haversineDistanceMeters } from './services/potholeDeduplicationService.js';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';

const BASE_URL = process.env.SERVER_URL || 'http://localhost:5001';
const CREATE_ENDPOINT = `${BASE_URL}/api/dev/create-pothole`;
const POTHOLES_ENDPOINT = `${BASE_URL}/api/potholes`;

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, description, detail = '') {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ [PASS] ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failedAssertions++;
    console.error(`  ❌ [FAIL] ${description}${detail ? ` (${detail})` : ''}`);
  }
}

async function sendCandidate(candidate) {
  const res = await fetch(CREATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API returned ${res.status}: ${text}`);
  }
  return await res.json();
}

async function getPotholes() {
  const res = await fetch(POTHOLES_ENDPOINT);
  if (!res.ok) throw new Error(`GET /api/potholes returned ${res.status}`);
  const data = await res.json();
  return data.potholes || [];
}

async function runTests() {
  console.log('================================================================');
  console.log('  RAAHI PHASE 18: AUTOMATED MULTI-BUS DEDUPLICATION TEST SUITE  ');
  console.log('================================================================\n');

  // Test Coordinates (dedicated to test suite for idempotency)
  // Latitude around 28.535600, Longitude 77.391200
  const TEST_BASE_LAT = 28.535600;
  const TEST_BASE_LNG = 77.391200;

  // Pre-cleanup of any previous run of this specific test coordinate
  await connectDB();
  await Pothole.deleteMany({
    'location.latitude': { $gte: 28.53555, $lte: 28.53565 },
    'location.longitude': { $gte: 77.39115, $lte: 77.39125 },
    potholeId: { $ne: 'POT-000001' }
  });
  await Pothole.deleteMany({
    'location.latitude': 28.750100,
    'location.longitude': 77.150200,
    potholeId: { $ne: 'POT-000001' }
  });

  const countBefore = (await getPotholes()).length;
  console.log(`Initial Potholes Count: ${countBefore}\n`);

  // -------------------------------------------------------------
  // TEST 1: First bus creates an incident
  // -------------------------------------------------------------
  console.log('--- TEST 1: First bus creates an incident ---');
  const bus1Candidate = {
    type: 'pothole',
    confidence: 0.85,
    gpsTimestamp: new Date().toISOString(),
    location: {
      latitude: TEST_BASE_LAT,
      longitude: TEST_BASE_LNG,
      accuracy: 3.0
    },
    bus: 'RAAHI-01'
  };

  const res1 = await sendCandidate(bus1Candidate);
  const createdPotholeId = res1.pothole?.potholeId;

  assert(res1.success === true, 'Response indicates success');
  assert(res1.created === true, 'First detection creates new pothole document');
  assert(res1.deduplicated === false, 'First detection is not deduplicated');
  assert(!!createdPotholeId && createdPotholeId.startsWith('POT-'), 'Assigned valid POT-XXXXXX ID', createdPotholeId);
  assert(res1.pothole?.detectionCount === 1, 'Initial detectionCount is 1');
  assert(
    Array.isArray(res1.pothole?.busesDetectedBy) &&
    res1.pothole.busesDetectedBy.length === 1 &&
    res1.pothole.busesDetectedBy[0] === 'RAAHI-01',
    'busesDetectedBy contains [RAAHI-01]'
  );

  // -------------------------------------------------------------
  // TEST 2: Second bus detects the same physical pothole
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Second bus detects the same physical pothole ---');
  const bus2Candidate = {
    type: 'pothole',
    confidence: 0.92,
    gpsTimestamp: new Date(Date.now() + 5000).toISOString(),
    location: {
      latitude: TEST_BASE_LAT + 0.000008, // ~0.89m away
      longitude: TEST_BASE_LNG + 0.000007,
      accuracy: 2.5
    },
    bus: 'RAAHI-02'
  };

  const d2 = haversineDistanceMeters(TEST_BASE_LAT, TEST_BASE_LNG, bus2Candidate.location.latitude, bus2Candidate.location.longitude);
  assert(d2 < 10.0, 'Bus 2 coordinate distance is under 10m', `${d2}m`);

  const res2 = await sendCandidate(bus2Candidate);

  assert(res2.success === true, 'Response indicates success');
  assert(res2.deduplicated === true, 'Second detection is marked as deduplicated');
  assert(res2.matchedPotholeId === createdPotholeId, 'Second bus matched the same potholeId', `${res2.matchedPotholeId} === ${createdPotholeId}`);
  assert(res2.pothole?.detectionCount === 2, 'detectionCount incremented to 2');
  assert(
    res2.pothole?.busesDetectedBy?.includes('RAAHI-01') &&
    res2.pothole?.busesDetectedBy?.includes('RAAHI-02'),
    'busesDetectedBy includes both RAAHI-01 and RAAHI-02'
  );

  // -------------------------------------------------------------
  // TEST 3: Third bus detects the same physical pothole
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Third bus detects the same physical pothole ---');
  const bus3Candidate = {
    type: 'pothole',
    confidence: 0.88,
    gpsTimestamp: new Date(Date.now() + 10000).toISOString(),
    location: {
      latitude: TEST_BASE_LAT + 0.000015, // ~1.8m away
      longitude: TEST_BASE_LNG + 0.000005,
      accuracy: 2.9
    },
    bus: 'RAAHI-03'
  };

  const d3 = haversineDistanceMeters(TEST_BASE_LAT, TEST_BASE_LNG, bus3Candidate.location.latitude, bus3Candidate.location.longitude);
  assert(d3 < 10.0, 'Bus 3 coordinate distance is under 10m', `${d3}m`);

  const res3 = await sendCandidate(bus3Candidate);

  assert(res3.success === true, 'Response indicates success');
  assert(res3.deduplicated === true, 'Third detection is marked as deduplicated');
  assert(res3.matchedPotholeId === createdPotholeId, 'Third bus matched the same potholeId', `${res3.matchedPotholeId} === ${createdPotholeId}`);

  // -------------------------------------------------------------
  // TEST 4: detectionCount becomes 3
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: detectionCount becomes 3 ---');
  assert(res3.pothole?.detectionCount === 3, 'detectionCount is exactly 3', `count = ${res3.pothole?.detectionCount}`);

  // -------------------------------------------------------------
  // TEST 5: busesDetectedBy contains all three buses
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: busesDetectedBy contains all three buses ---');
  const busesList = res3.pothole?.busesDetectedBy || [];
  assert(busesList.includes('RAAHI-01'), 'busesDetectedBy includes RAAHI-01');
  assert(busesList.includes('RAAHI-02'), 'busesDetectedBy includes RAAHI-02');
  assert(busesList.includes('RAAHI-03'), 'busesDetectedBy includes RAAHI-03');
  assert(busesList.length === 3, 'busesDetectedBy length is exactly 3', `[${busesList.join(', ')}]`);

  // -------------------------------------------------------------
  // TEST 6: No duplicate pothole document is created for the same physical location
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: No duplicate pothole document created for same physical location ---');
  const allPotholes = await getPotholes();
  const matchesForLocation = allPotholes.filter(p => {
    const dist = haversineDistanceMeters(TEST_BASE_LAT, TEST_BASE_LNG, p.location.latitude, p.location.longitude);
    return dist <= 10.0;
  });

  assert(
    matchesForLocation.length === 1,
    'Exactly ONE document exists within 10m radius of base pothole',
    `Found ${matchesForLocation.length} document(s)`
  );
  assert(
    matchesForLocation[0]?.potholeId === createdPotholeId,
    'The single matching document has the expected potholeId',
    matchesForLocation[0]?.potholeId
  );

  // -------------------------------------------------------------
  // TEST 7: A far-away pothole creates a different potholeId
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: A far-away pothole creates a different potholeId ---');
  const FAR_LAT = 28.750100;
  const FAR_LNG = 77.150200;
  const dFar = haversineDistanceMeters(TEST_BASE_LAT, TEST_BASE_LNG, FAR_LAT, FAR_LNG);
  assert(dFar > 10.0, 'Far pothole distance is well over 10m threshold', `${dFar.toFixed(2)}m`);

  const farCandidate = {
    type: 'pothole',
    confidence: 0.81,
    gpsTimestamp: new Date().toISOString(),
    location: {
      latitude: FAR_LAT,
      longitude: FAR_LNG,
      accuracy: 3.5
    },
    bus: 'RAAHI-01'
  };

  const resFar = await sendCandidate(farCandidate);
  const farPotholeId = resFar.pothole?.potholeId;

  assert(resFar.created === true, 'Far pothole created a new document');
  assert(resFar.deduplicated === false, 'Far pothole was not deduplicated into existing pothole');
  assert(farPotholeId !== createdPotholeId, 'Far pothole assigned a DIFFERENT potholeId', `${farPotholeId} !== ${createdPotholeId}`);
  assert(resFar.pothole?.detectionCount === 1, 'Far pothole has detectionCount 1');

  // -------------------------------------------------------------
  // TEST 8: Same bus repeated detection does not duplicate the bus ID
  // -------------------------------------------------------------
  console.log('\n--- TEST 8: Same bus repeated detection does not duplicate bus ID ---');
  const repeatCandidate = {
    type: 'pothole',
    confidence: 0.90,
    gpsTimestamp: new Date().toISOString(),
    location: {
      latitude: TEST_BASE_LAT + 0.000003,
      longitude: TEST_BASE_LNG + 0.000002,
      accuracy: 2.8
    },
    bus: 'RAAHI-02' // Repeat detection by RAAHI-02
  };

  const resRepeat = await sendCandidate(repeatCandidate);
  assert(resRepeat.deduplicated === true, 'Repeated detection deduplicated');
  assert(resRepeat.matchedPotholeId === createdPotholeId, 'Matched original potholeId');
  assert(resRepeat.pothole?.detectionCount === 4, 'detectionCount incremented to 4');

  const updatedBuses = resRepeat.pothole?.busesDetectedBy || [];
  const countOfBus2 = updatedBuses.filter(b => b === 'RAAHI-02').length;
  assert(countOfBus2 === 1, 'RAAHI-02 appears exactly ONCE in busesDetectedBy array', `count = ${countOfBus2}`);
  assert(
    new Set(updatedBuses).size === updatedBuses.length,
    'All entries in busesDetectedBy remain unique',
    `[${updatedBuses.join(', ')}]`
  );

  // Clean up only this test's specific synthetic coordinates
  await Pothole.deleteOne({ potholeId: createdPotholeId });
  await Pothole.deleteOne({ potholeId: farPotholeId });

  console.log('\n================================================================');
  console.log(`  TEST RESULTS: ${passedAssertions}/${totalAssertions} Assertions Passed`);
  console.log(`  Failures:     ${failedAssertions}`);
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }

  if (failedAssertions > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('\n❌ Test runner failed with unhandled exception:', err);
  process.exit(1);
});
