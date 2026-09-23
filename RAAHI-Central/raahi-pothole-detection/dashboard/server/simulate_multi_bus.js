/**
 * RAAHI Phase 18 — Multi-Bus Fleet Simulation & Cross-Bus Deduplication
 * =====================================================================
 * Demonstrates the fleet scenario where multiple transit buses (RAAHI-01,
 * RAAHI-02, RAAHI-03) travel through the same corridor, detect the same
 * physical pothole, and the backend deduplicates them into a single MongoDB
 * incident while incrementing detectionCount and tracking unique bus identifiers.
 *
 * Scenarios tested:
 *   1. Same Physical Pothole (<10m):
 *      - RAAHI-01 -> Initial detection creates POT-XXXXXX
 *      - RAAHI-02 -> Cross-bus detection within 1.04m merges into POT-XXXXXX
 *      - RAAHI-03 -> Cross-bus detection within 1.71m merges into POT-XXXXXX
 *      - Expected: 1 document, detectionCount=3, busesDetectedBy=[RAAHI-01, RAAHI-02, RAAHI-03]
 *   2. Far-Away Pothole (>10m):
 *      - RAAHI-01 at (28.704100, 77.102500) -> 14.4 km away
 *      - Expected: Creates a distinct new document (POT-YYYYYY)
 *   3. Bus Duplicate Protection:
 *      - RAAHI-01 detects base pothole again
 *      - Expected: detectionCount=4, busesDetectedBy remains [RAAHI-01, RAAHI-02, RAAHI-03] (unique)
 *
 * Usage:
 *   node dashboard/server/simulate_multi_bus.js [--clean]
 */

import { haversineDistanceMeters, getDedupRadiusMeters } from './services/potholeDeduplicationService.js';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';

const BASE_URL = process.env.SERVER_URL || 'http://localhost:5001';
const CREATE_ENDPOINT = `${BASE_URL}/api/dev/create-pothole`;
const POTHOLES_ENDPOINT = `${BASE_URL}/api/potholes`;

// Test coordinates
const BASE_POTHOLE_LOCATION = {
  latitude: 28.613905,
  longitude: 77.209008
};

const SIMULATED_DETECTIONS = {
  bus1: {
    bus: 'RAAHI-01',
    confidence: 0.86,
    location: {
      latitude: 28.613905,
      longitude: 77.209008,
      accuracy: 3.2
    },
    gpsTimestamp: '2026-09-13T12:10:00.000Z'
  },
  bus2: {
    bus: 'RAAHI-02',
    confidence: 0.91,
    location: {
      latitude: 28.613912,
      longitude: 77.209015,
      accuracy: 2.8
    },
    gpsTimestamp: '2026-09-13T12:15:30.000Z'
  },
  bus3: {
    bus: 'RAAHI-03',
    confidence: 0.88,
    location: {
      latitude: 28.613920,
      longitude: 77.209012,
      accuracy: 3.0
    },
    gpsTimestamp: '2026-09-13T12:22:15.000Z'
  },
  farPothole: {
    bus: 'RAAHI-01',
    confidence: 0.82,
    location: {
      latitude: 28.704100,
      longitude: 77.102500,
      accuracy: 4.1
    },
    gpsTimestamp: '2026-09-13T12:45:00.000Z'
  },
  bus1Repeat: {
    bus: 'RAAHI-01',
    confidence: 0.89,
    location: {
      latitude: 28.613908,
      longitude: 77.209010,
      accuracy: 3.1
    },
    gpsTimestamp: '2026-09-13T13:05:00.000Z'
  }
};

async function sendCandidate(detection) {
  const payload = {
    candidate: {
      type: 'pothole',
      confidence: detection.confidence,
      gpsTimestamp: detection.gpsTimestamp,
      location: detection.location,
      bus: detection.bus
    }
  };

  const res = await fetch(CREATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`POST ${CREATE_ENDPOINT} failed [${res.status}]: ${errorText}`);
  }

  return await res.json();
}

async function getPotholesFromApi() {
  const res = await fetch(POTHOLES_ENDPOINT);
  if (!res.ok) {
    throw new Error(`GET ${POTHOLES_ENDPOINT} failed [${res.status}]`);
  }
  const data = await res.json();
  return data.potholes || [];
}

async function cleanSimulatedRecordsIfRequested() {
  const shouldClean = process.argv.includes('--clean');
  if (!shouldClean) return;

  console.log('🧹 [--clean] Cleaning previously created simulation records (safe explicit coordinates only)...');
  await connectDB();

  // Find simulation records near the base location or far location
  const simRecords = await Pothole.find({
    $or: [
      {
        'location.latitude': { $gte: 28.6138, $lte: 28.6141 },
        'location.longitude': { $gte: 77.2089, $lte: 77.2092 }
      },
      {
        'location.latitude': 28.704100,
        'location.longitude': 77.102500
      }
    ]
  });

  for (const doc of simRecords) {
    // Extra safety: Never delete POT-000001
    if (doc.potholeId === 'POT-000001') {
      console.log('  ⚠️ Skipping POT-000001 (protected production seed record)');
      continue;
    }
    await Pothole.deleteOne({ _id: doc._id });
    console.log(`  🗑️ Removed previous simulation record: ${doc.potholeId} (${doc.location.latitude}, ${doc.location.longitude})`);
  }
  console.log('🧹 Cleanup complete.\n');
}

async function runSimulation() {
  console.log('================================================================');
  console.log('  RAAHI PHASE 18: MULTI-BUS FLEET SIMULATION & DEDUPLICATION    ');
  console.log('================================================================\n');

  // Handle optional explicit clean
  await cleanSimulatedRecordsIfRequested();

  // 1. Initial State
  const initialPotholes = await getPotholesFromApi();
  const initialCount = initialPotholes.length;
  console.log(`📊 Initial MongoDB Pothole Count: ${initialCount}`);
  initialPotholes.forEach(p => {
    console.log(`   - ${p.potholeId}: (${p.location.latitude}, ${p.location.longitude}) count=${p.detectionCount} buses=[${(p.busesDetectedBy || []).join(', ')}]`);
  });
  console.log();

  // 2. Haversine Distance Pre-Calculations
  console.log('----------------------------------------------------------------');
  console.log('  1. HAVERSINE DISTANCE VERIFICATION (< 10m THRESHOLD)          ');
  console.log('----------------------------------------------------------------');
  const dedupRadius = getDedupRadiusMeters();
  console.log(`Deduplication Radius Threshold: ${dedupRadius} meters\n`);

  const d1 = haversineDistanceMeters(
    BASE_POTHOLE_LOCATION.latitude, BASE_POTHOLE_LOCATION.longitude,
    SIMULATED_DETECTIONS.bus1.location.latitude, SIMULATED_DETECTIONS.bus1.location.longitude
  );
  const d2 = haversineDistanceMeters(
    BASE_POTHOLE_LOCATION.latitude, BASE_POTHOLE_LOCATION.longitude,
    SIMULATED_DETECTIONS.bus2.location.latitude, SIMULATED_DETECTIONS.bus2.location.longitude
  );
  const d3 = haversineDistanceMeters(
    BASE_POTHOLE_LOCATION.latitude, BASE_POTHOLE_LOCATION.longitude,
    SIMULATED_DETECTIONS.bus3.location.latitude, SIMULATED_DETECTIONS.bus3.location.longitude
  );
  const dFar = haversineDistanceMeters(
    BASE_POTHOLE_LOCATION.latitude, BASE_POTHOLE_LOCATION.longitude,
    SIMULATED_DETECTIONS.farPothole.location.latitude, SIMULATED_DETECTIONS.farPothole.location.longitude
  );

  console.log(`• RAAHI-01 distance to Base: ${d1.toFixed(2)}m (Target: 0.00m) - OK: ${d1 <= dedupRadius}`);
  console.log(`• RAAHI-02 distance to Base: ${d2.toFixed(2)}m (Target: <10m)  - OK: ${d2 <= dedupRadius}`);
  console.log(`• RAAHI-03 distance to Base: ${d3.toFixed(2)}m (Target: <10m)  - OK: ${d3 <= dedupRadius}`);
  console.log(`• Far Pothole distance to Base: ${dFar.toFixed(2)}m (Target: >10m) - OK: ${dFar > dedupRadius}\n`);

  if (d1 > dedupRadius || d2 > dedupRadius || d3 > dedupRadius || dFar <= dedupRadius) {
    throw new Error('Haversine coordinate sanity check failed. Distances do not match test requirements.');
  }

  // 3. PHASE 18.3: Same Physical Pothole Sequential Detections
  console.log('----------------------------------------------------------------');
  console.log('  2. SAME PHYSICAL POTHOLE TEST (CROSS-BUS DEDUPLICATION)       ');
  console.log('----------------------------------------------------------------');

  // Event 1: Bus 1 detection
  console.log(`\n[Event 1] Bus ${SIMULATED_DETECTIONS.bus1.bus} detects pothole at (${SIMULATED_DETECTIONS.bus1.location.latitude}, ${SIMULATED_DETECTIONS.bus1.location.longitude}), conf: ${SIMULATED_DETECTIONS.bus1.confidence}`);
  const res1 = await sendCandidate(SIMULATED_DETECTIONS.bus1);
  const basePotholeId = res1.pothole.potholeId;
  console.log(`  → Response Status: ${res1.created ? 'CREATED NEW' : 'UPDATED'}`);
  console.log(`  → Pothole ID:      ${basePotholeId}`);
  console.log(`  → Detection Count: ${res1.pothole.detectionCount}`);
  console.log(`  → Buses Detected:  [${res1.pothole.busesDetectedBy.join(', ')}]`);

  // Event 2: Bus 2 detection (same physical pothole, within 10m)
  console.log(`\n[Event 2] Bus ${SIMULATED_DETECTIONS.bus2.bus} detects same physical pothole at (${SIMULATED_DETECTIONS.bus2.location.latitude}, ${SIMULATED_DETECTIONS.bus2.location.longitude}) [dist: ${d2}m], conf: ${SIMULATED_DETECTIONS.bus2.confidence}`);
  const res2 = await sendCandidate(SIMULATED_DETECTIONS.bus2);
  console.log(`  → Response Status: ${res2.deduplicated ? 'DEDUPLICATED & MERGED' : 'CREATED (UNEXPECTED)'}`);
  console.log(`  → Matched ID:      ${res2.matchedPotholeId}`);
  console.log(`  → Distance:        ${res2.distanceMeters}m`);
  console.log(`  → Detection Count: ${res2.pothole.detectionCount}`);
  console.log(`  → Buses Detected:  [${res2.pothole.busesDetectedBy.join(', ')}]`);

  if (!res2.deduplicated || res2.matchedPotholeId !== basePotholeId) {
    throw new Error(`Event 2 failed: Expected deduplication into ${basePotholeId}, got ${res2.matchedPotholeId}`);
  }

  // Event 3: Bus 3 detection (same physical pothole, within 10m)
  console.log(`\n[Event 3] Bus ${SIMULATED_DETECTIONS.bus3.bus} detects same physical pothole at (${SIMULATED_DETECTIONS.bus3.location.latitude}, ${SIMULATED_DETECTIONS.bus3.location.longitude}) [dist: ${d3}m], conf: ${SIMULATED_DETECTIONS.bus3.confidence}`);
  const res3 = await sendCandidate(SIMULATED_DETECTIONS.bus3);
  console.log(`  → Response Status: ${res3.deduplicated ? 'DEDUPLICATED & MERGED' : 'CREATED (UNEXPECTED)'}`);
  console.log(`  → Matched ID:      ${res3.matchedPotholeId}`);
  console.log(`  → Distance:        ${res3.distanceMeters}m`);
  console.log(`  → Detection Count: ${res3.pothole.detectionCount}`);
  console.log(`  → Buses Detected:  [${res3.pothole.busesDetectedBy.join(', ')}]`);

  if (!res3.deduplicated || res3.matchedPotholeId !== basePotholeId) {
    throw new Error(`Event 3 failed: Expected deduplication into ${basePotholeId}, got ${res3.matchedPotholeId}`);
  }

  // 4. PHASE 18.4: Different Pothole Test
  console.log('\n----------------------------------------------------------------');
  console.log('  3. DIFFERENT PHYSICAL POTHOLE TEST (FAR LOCATION > 10m)       ');
  console.log('----------------------------------------------------------------');
  console.log(`\n[Event 4] Bus ${SIMULATED_DETECTIONS.farPothole.bus} detects far-away pothole at (${SIMULATED_DETECTIONS.farPothole.location.latitude}, ${SIMULATED_DETECTIONS.farPothole.location.longitude}) [dist: ${dFar}m], conf: ${SIMULATED_DETECTIONS.farPothole.confidence}`);
  const resFar = await sendCandidate(SIMULATED_DETECTIONS.farPothole);
  const farPotholeId = resFar.pothole.potholeId;
  console.log(`  → Response Status: ${resFar.created ? 'CREATED NEW' : 'UPDATED'}`);
  console.log(`  → Pothole ID:      ${farPotholeId}`);
  console.log(`  → Detection Count: ${resFar.pothole.detectionCount}`);
  console.log(`  → Buses Detected:  [${resFar.pothole.busesDetectedBy.join(', ')}]`);

  if (farPotholeId === basePotholeId) {
    throw new Error(`Event 4 failed: Far-away pothole incorrectly merged into ${basePotholeId}`);
  }

  // 5. PHASE 18.5: Bus Duplicate Protection
  console.log('\n----------------------------------------------------------------');
  console.log('  4. BUS DUPLICATE PROTECTION TEST                              ');
  console.log('----------------------------------------------------------------');
  console.log(`\n[Event 5] Bus ${SIMULATED_DETECTIONS.bus1Repeat.bus} detects the base pothole AGAIN at (${SIMULATED_DETECTIONS.bus1Repeat.location.latitude}, ${SIMULATED_DETECTIONS.bus1Repeat.location.longitude})`);
  const resRepeat = await sendCandidate(SIMULATED_DETECTIONS.bus1Repeat);
  console.log(`  → Response Status: ${resRepeat.deduplicated ? 'DEDUPLICATED & MERGED' : 'CREATED (UNEXPECTED)'}`);
  console.log(`  → Matched ID:      ${resRepeat.matchedPotholeId}`);
  console.log(`  → Detection Count: ${resRepeat.pothole.detectionCount}`);
  console.log(`  → Buses Detected:  [${resRepeat.pothole.busesDetectedBy.join(', ')}]`);

  // Verify bus array does not contain duplicates
  const buses = resRepeat.pothole.busesDetectedBy;
  const uniqueBuses = [...new Set(buses)];
  if (buses.length !== uniqueBuses.length) {
    throw new Error(`Bus duplicate protection failed: busesDetectedBy contains duplicate entries: [${buses.join(', ')}]`);
  }
  console.log(`  ✓ busesDetectedBy array uniqueness verified: exactly ${buses.length} unique buses.`);

  // 6. PHASE 18.6: Final MongoDB Query & Verification
  console.log('\n----------------------------------------------------------------');
  console.log('  5. MONGODB DATABASE VERIFICATION & AUDIT                      ');
  console.log('----------------------------------------------------------------');
  const finalPotholes = await getPotholesFromApi();
  const finalCount = finalPotholes.length;

  console.log(`📊 MongoDB Pothole Count BEFORE: ${initialCount}`);
  console.log(`📊 MongoDB Pothole Count AFTER:  ${finalCount}`);
  console.log(`📊 Net Incidents Added:          ${finalCount - initialCount}`);

  const verifiedBase = finalPotholes.find(p => p.potholeId === basePotholeId);
  const verifiedFar = finalPotholes.find(p => p.potholeId === farPotholeId);

  console.log('\nBase Pothole Incident Details:');
  console.log(`  • potholeId:       ${verifiedBase?.potholeId}`);
  console.log(`  • location:        (${verifiedBase?.location.latitude}, ${verifiedBase?.location.longitude})`);
  console.log(`  • detectionCount:  ${verifiedBase?.detectionCount}`);
  console.log(`  • busesDetectedBy: [${(verifiedBase?.busesDetectedBy || []).join(', ')}]`);
  console.log(`  • confidence:      ${verifiedBase?.confidence}`);
  console.log(`  • status:          ${verifiedBase?.status}`);
  console.log(`  • firstDetectedAt: ${verifiedBase?.firstDetectedAt}`);
  console.log(`  • lastDetectedAt:  ${verifiedBase?.lastDetectedAt}`);

  console.log('\nFar Pothole Incident Details:');
  console.log(`  • potholeId:       ${verifiedFar?.potholeId}`);
  console.log(`  • location:        (${verifiedFar?.location.latitude}, ${verifiedFar?.location.longitude})`);
  console.log(`  • detectionCount:  ${verifiedFar?.detectionCount}`);
  console.log(`  • busesDetectedBy: [${(verifiedFar?.busesDetectedBy || []).join(', ')}]`);
  console.log(`  • confidence:      ${verifiedFar?.confidence}`);
  console.log(`  • status:          ${verifiedFar?.status}`);

  console.log('\n================================================================');
  console.log('  SIMULATION COMPLETED SUCCESSFULLY!                            ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
}

runSimulation().catch(err => {
  console.error('\n❌ Simulation failed with error:', err);
  process.exit(1);
});
