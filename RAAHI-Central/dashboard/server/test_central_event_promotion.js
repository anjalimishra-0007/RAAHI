import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';
import CandidateEvent from './models/CandidateEvent.js';
import { ingestCandidateEvent } from './services/centralEventService.js';
import {
  promoteCandidate,
  isSupportedAuthoritativeClass,
  SUPPORTED_AUTHORITATIVE_CLASSES
} from './services/centralEventPromotionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

console.log('==============================================================');
console.log('  RAAHI: CENTRAL EVENT PROMOTION & DEDUPLICATION TEST (PHASE 7B)');
console.log('==============================================================\n');

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASSED: ${message}`);
    totalPassed++;
  } else {
    console.error(`  FAILED: ${message}`);
    totalFailed++;
    process.exitCode = 1;
  }
}

async function runTests() {
  await connectDB();

  const createdCandidateIds = [];
  const createdPotholeIds = [];
  const testPrefix = `PHASE7B-TEST-${Date.now()}`;

  try {
    // Record baseline count of authoritative Pothole documents
    const initialPotholeCount = await Pothole.countDocuments();
    console.log(`Initial baseline Pothole document count: ${initialPotholeCount}`);

    // Helper: Ingest a candidate event
    async function createCandidate(suffix, customPayload = {}) {
      const edgeEventId = `${testPrefix}-${suffix}`;
      const payload = {
        eventId: edgeEventId,
        eventType: "pothole",
        busId: "RAAHI-01",
        timestamp: "2026-09-15T14:00:00.000Z",
        latitude: 28.650000,
        longitude: 77.250000,
        accuracy: 3.0,
        edgeModel: "YOLO11n",
        confidence: 0.85,
        class: "pothole",
        boundingBox: { x1: 100, y1: 200, x2: 250, y2: 350 },
        evidenceReference: "https://drive.google.com/file/d/test-evidence-p4/view",
        centralDeliveryStatus: "received",
        ...customPayload
      };

      const result = await ingestCandidateEvent(payload);
      createdCandidateIds.push(result.candidateId);
      return result.candidate;
    }

    // -------------------------------------------------------------
    // TEST 1: Candidate with unsupported class is refused promotion
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Unsupported Candidate Class Cannot Be Promoted ---');
    const unsupportedCand1 = await createCandidate('UNSUPPORTED-1', {
      class: 'speed_breaker'
    });
    const promoResUnsupported1 = await promoteCandidate(unsupportedCand1.candidateId);
    assert(promoResUnsupported1.success === false, "Refuses promotion for unsupported class.");
    assert(promoResUnsupported1.status === 'UNSUPPORTED_CLASSIFICATION', "Returns status: UNSUPPORTED_CLASSIFICATION.");
    const countAfterUnsupported1 = await Pothole.countDocuments();
    assert(countAfterUnsupported1 === initialPotholeCount, "Authoritative Pothole count unchanged (no Pothole created).");

    // -------------------------------------------------------------
    // TEST 2: Candidate with manhole_cover is refused promotion
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Manhole Cover Candidate Safely Refused ---');
    const manholeCand = await createCandidate('MANHOLE-1', {
      class: 'manhole_cover'
    });
    const promoResManhole = await promoteCandidate(manholeCand.candidateId);
    assert(promoResManhole.success === false, "Refuses promotion for manhole_cover.");
    assert(promoResManhole.status === 'UNSUPPORTED_CLASSIFICATION', "Status is UNSUPPORTED_CLASSIFICATION.");
    const countAfterManhole = await Pothole.countDocuments();
    assert(countAfterManhole === initialPotholeCount, "Authoritative Pothole count unchanged.");

    // -------------------------------------------------------------
    // TEST 3: Valid Candidate Promoted -> Creates new Pothole
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Valid Candidate Promoted (New Pothole Creation) ---');
    const cand1 = await createCandidate('VALID-1', {
      latitude: 28.700100,
      longitude: 77.300100,
      accuracy: 2.5,
      busId: 'RAAHI-01',
      confidence: 0.82,
      class: 'pothole'
    });

    const promoRes1 = await promoteCandidate(cand1.candidateId);
    assert(promoRes1.success === true, "Promotion returns success: true.");
    assert(promoRes1.promoted === true, "Promotion returns promoted: true.");
    assert(promoRes1.action === 'created', "Action is 'created' (no nearby existing pothole).");
    assert(typeof promoRes1.potholeId === 'string' && promoRes1.potholeId.startsWith('POT-'), "Assigned valid POT-XXXXXX ID.");
    createdPotholeIds.push(promoRes1.potholeId);

    // Verify CandidateEvent record updated with reference and promoted status
    const cand1AfterPromo = await CandidateEvent.findOne({ candidateId: cand1.candidateId });
    assert(cand1AfterPromo.promotedToPotholeId === promoRes1.potholeId, "CandidateEvent.promotedToPotholeId updated with created potholeId.");
    assert(cand1AfterPromo.status === 'promoted', "CandidateEvent.status is 'promoted'.");

    // Verify authoritative Pothole document
    const createdPot1 = await Pothole.findOne({ potholeId: promoRes1.potholeId });
    assert(createdPot1 !== null, "Authoritative Pothole document exists in MongoDB.");
    assert(createdPot1.location.latitude === 28.700100, "Pothole latitude matches Edge GPS exactly (no Central GPS matching).");
    assert(createdPot1.location.longitude === 77.300100, "Pothole longitude matches Edge GPS exactly (no Central GPS matching).");
    assert(createdPot1.location.accuracy === 2.5, "Pothole accuracy matches Edge GPS accuracy.");
    assert(createdPot1.confidence === 0.82, "Pothole confidence preserves original Edge confidence 0.82.");
    assert(createdPot1.class === 'pothole', "Pothole class preserves original Edge class 'pothole'.");
    assert(createdPot1.edgeEventId === cand1.edgeEventId, "Pothole edgeEventId matches canonical Edge event ID.");
    assert(createdPot1.sourceCandidateId === cand1.candidateId, "Pothole sourceCandidateId references CandidateEvent ID.");
    assert(createdPot1.detectionCount === 1, "Initial detectionCount is 1.");
    assert(createdPot1.busesDetectedBy.length === 1 && createdPot1.busesDetectedBy[0] === 'RAAHI-01', "busesDetectedBy contains ['RAAHI-01'].");
    assert(createdPot1.status === 'open', "Pothole status is 'open'.");

    // -------------------------------------------------------------
    // TEST 4: Authoritative Pothole count increased by exactly 1
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Authoritative Count Increments by Exactly One ---');
    const countAfterPromo1 = await Pothole.countDocuments();
    assert(countAfterPromo1 === initialPotholeCount + 1, `Authoritative Pothole count increased by exactly 1 (${initialPotholeCount} -> ${countAfterPromo1}).`);

    // -------------------------------------------------------------
    // TEST 5: Idempotency - Repeated promotion of same candidate returns existing Pothole
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Idempotent Promotion of Already-Promoted Candidate ---');
    const repeatPromoRes = await promoteCandidate(cand1.candidateId);
    assert(repeatPromoRes.success === true, "Repeat promotion returns success: true.");
    assert(repeatPromoRes.alreadyPromoted === true, "Repeat promotion returns alreadyPromoted: true.");
    assert(repeatPromoRes.action === 'already_promoted', "Action is 'already_promoted'.");
    assert(repeatPromoRes.potholeId === promoRes1.potholeId, "Returns same potholeId without creating duplicate.");

    const countAfterRepeat = await Pothole.countDocuments();
    assert(countAfterRepeat === countAfterPromo1, "Authoritative Pothole count did NOT increase on idempotent retry.");

    // -------------------------------------------------------------
    // TEST 6: Cross-Bus Spatial Deduplication (Second bus within 10m threshold)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Cross-Bus Fusion (Second Bus within 10m) ---');
    // Bus 2 detects same physical pothole ~2.2m away
    const cand2 = await createCandidate('BUS2-NEARBY', {
      latitude: 28.700115, // ~2.2 meters away from (28.700100, 77.300100)
      longitude: 77.300110,
      accuracy: 2.8,
      busId: 'RAAHI-02',
      confidence: 0.89,
      class: 'pothole'
    });

    const promoRes2 = await promoteCandidate(cand2.candidateId);
    assert(promoRes2.success === true, "Second bus promotion returns success: true.");
    assert(promoRes2.action === 'matched_existing', "Second bus matched existing pothole within 10m.");
    assert(promoRes2.potholeId === promoRes1.potholeId, "Second bus matched same potholeId (Cross-bus fusion succeeded).");
    assert(promoRes2.distanceMeters !== null && promoRes2.distanceMeters <= 10.0, `Distance (${promoRes2.distanceMeters}m) is under 10m threshold.`);

    // Check candidate audit trail
    const cand2AfterPromo = await CandidateEvent.findOne({ candidateId: cand2.candidateId });
    assert(cand2AfterPromo.promotedToPotholeId === promoRes1.potholeId, "Candidate 2 linked to shared authoritative Pothole ID.");
    assert(cand2AfterPromo.status === 'promoted', "Candidate 2 status is 'promoted'.");

    // Check authoritative Pothole document aggregations
    const potAfterBus2 = await Pothole.findOne({ potholeId: promoRes1.potholeId });
    assert(potAfterBus2.detectionCount === 2, "detectionCount incremented to 2.");
    assert(potAfterBus2.busesDetectedBy.includes('RAAHI-01'), "busesDetectedBy preserves RAAHI-01.");
    assert(potAfterBus2.busesDetectedBy.includes('RAAHI-02'), "busesDetectedBy now includes RAAHI-02.");
    assert(potAfterBus2.busesDetectedBy.length === 2, "busesDetectedBy contains exactly 2 buses.");

    const countAfterBus2 = await Pothole.countDocuments();
    assert(countAfterBus2 === countAfterPromo1, "Authoritative count did NOT increase (deduplicated into existing record).");

    // -------------------------------------------------------------
    // TEST 7: Third Bus detects same location -> Cross-Bus 3rd aggregation
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Third Bus Fusion (Same Pothole Aggregation) ---');
    const cand3 = await createCandidate('BUS3-NEARBY', {
      latitude: 28.700108, // ~1.5 meters away
      longitude: 77.300105,
      accuracy: 3.1,
      busId: 'RAAHI-03',
      confidence: 0.91,
      class: 'pothole'
    });

    const promoRes3 = await promoteCandidate(cand3.candidateId);
    assert(promoRes3.potholeId === promoRes1.potholeId, "Third bus matched same potholeId.");

    const potAfterBus3 = await Pothole.findOne({ potholeId: promoRes1.potholeId });
    assert(potAfterBus3.detectionCount === 3, "detectionCount incremented to 3.");
    assert(potAfterBus3.busesDetectedBy.includes('RAAHI-03'), "busesDetectedBy includes RAAHI-03.");
    assert(potAfterBus3.busesDetectedBy.length === 3, "busesDetectedBy has exactly 3 unique buses.");

    // -------------------------------------------------------------
    // TEST 8: Same Bus Repeated Detection -> Increments count, no duplicate bus ID
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Same-Bus Repeated Detection Deduplication ---');
    const cand4 = await createCandidate('BUS1-REPEAT', {
      latitude: 28.700102,
      longitude: 77.300101,
      accuracy: 2.1,
      busId: 'RAAHI-01', // Same bus again!
      confidence: 0.88,
      class: 'pothole'
    });

    const promoRes4 = await promoteCandidate(cand4.candidateId);
    assert(promoRes4.potholeId === promoRes1.potholeId, "Repeated trip matched existing pothole.");

    const potAfterRepeat = await Pothole.findOne({ potholeId: promoRes1.potholeId });
    assert(potAfterRepeat.detectionCount === 4, "detectionCount incremented to 4.");
    assert(potAfterRepeat.busesDetectedBy.length === 3, "busesDetectedBy still has 3 unique buses (no duplicate 'RAAHI-01').");
    const countOfBus1 = potAfterRepeat.busesDetectedBy.filter(b => b === 'RAAHI-01').length;
    assert(countOfBus1 === 1, "'RAAHI-01' appears exactly once in busesDetectedBy array.");

    // -------------------------------------------------------------
    // TEST 9: Candidate beyond 10m threshold creates a separate Pothole
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Candidate Beyond 10m Creates Separate Incident ---');
    const candFar = await createCandidate('FAR-AWAY', {
      latitude: 28.700600, // ~55 meters away from 28.700100
      longitude: 77.300100,
      accuracy: 2.0,
      busId: 'RAAHI-01',
      confidence: 0.84,
      class: 'pothole'
    });

    const promoResFar = await promoteCandidate(candFar.candidateId);
    assert(promoResFar.action === 'created', "Far candidate created a new pothole.");
    assert(promoResFar.potholeId !== promoRes1.potholeId, "Assigned DIFFERENT potholeId.");
    createdPotholeIds.push(promoResFar.potholeId);

    const countAfterFar = await Pothole.countDocuments();
    assert(countAfterFar === countAfterPromo1 + 1, "Authoritative count incremented for independent physical pothole.");

    // -------------------------------------------------------------
    // TEST 10: Supported Classification (road_damage) Promotes Correctly
    // -------------------------------------------------------------
    console.log('\n--- TEST 10: Supported Classification (road_damage) Promotes Correctly ---');
    assert(isSupportedAuthoritativeClass('road_damage') === true, "road_damage is supported authoritative classification.");

    const candRoadDamage = await createCandidate('ROAD-DAMAGE-1', {
      latitude: 28.702000,
      longitude: 77.302000,
      busId: 'RAAHI-04',
      confidence: 0.75,
      class: 'road_damage'
    });

    const promoResRoadDamage = await promoteCandidate(candRoadDamage.candidateId);
    assert(promoResRoadDamage.success === true, "Supported road_damage promotion succeeded.");
    assert(promoResRoadDamage.promoted === true, "promoted is true.");
    createdPotholeIds.push(promoResRoadDamage.potholeId);

    const potRoadDamage = await Pothole.findOne({ potholeId: promoResRoadDamage.potholeId });
    assert(potRoadDamage.class === 'road_damage', "Pothole preserves class 'road_damage'.");
    assert(potRoadDamage.detectionCount === 1, "Pothole detectionCount is 1.");

    // -------------------------------------------------------------
    // TEST 11: End-to-End Chain: Edge Ingest -> Promotion -> 10m Deduplication
    // -------------------------------------------------------------
    console.log('\n--- TEST 11: End-to-End Direct Central Pipeline Chain ---');
    // 1. Edge ingestion
    const e2eEdgePayload = {
      eventId: `${testPrefix}-E2E-DIRECT`,
      eventType: "pothole",
      busId: "RAAHI-08",
      timestamp: "2026-09-15T15:30:00.000Z",
      latitude: 28.705000,
      longitude: 77.305000,
      accuracy: 3.5,
      edgeModel: "YOLO11n",
      confidence: 0.87,
      class: "pothole",
      boundingBox: { x1: 150, y1: 220, x2: 280, y2: 360 },
      evidenceReference: "https://drive.google.com/file/d/e2e-evidence-id/view",
      centralDeliveryStatus: "received"
    };

    const ingestRes = await ingestCandidateEvent(e2eEdgePayload);
    assert(ingestRes.success === true, "E2E Step 1: Ingested canonical event package.");
    assert(ingestRes.candidate.status === 'pending', "E2E Step 1: Candidate status is pending.");
    createdCandidateIds.push(ingestRes.candidateId);

    // 2. Direct Central Promotion (without VLM)
    const promoteE2e = await promoteCandidate(ingestRes.candidateId);
    assert(promoteE2e.success === true, "E2E Step 2: Direct promotion succeeded without VLM.");
    assert(promoteE2e.promoted === true, "E2E Step 2: Candidate promoted.");
    assert(promoteE2e.action === 'created', "E2E Step 2: New authoritative incident created.");
    createdPotholeIds.push(promoteE2e.potholeId);

    // 3. Verify Authoritative Pothole in MongoDB
    const authoritativeE2ePot = await Pothole.findOne({ potholeId: promoteE2e.potholeId });
    assert(authoritativeE2ePot !== null, "E2E Step 3: Authoritative Pothole found in MongoDB.");
    assert(authoritativeE2ePot.location.latitude === 28.705000, "E2E Step 3: Authoritative latitude matches Edge telemetry.");
    assert(authoritativeE2ePot.confidence === 0.87, "E2E Step 3: Edge confidence 0.87 preserved.");
    assert(authoritativeE2ePot.edgeEventId === `${testPrefix}-E2E-DIRECT`, "E2E Step 3: Edge event ID preserved.");
    assert(authoritativeE2ePot.sourceCandidateId === ingestRes.candidateId, "E2E Step 3: Source Candidate ID preserved.");
    assert(authoritativeE2ePot.evidenceReference === 'https://drive.google.com/file/d/e2e-evidence-id/view', "E2E Step 3: Evidence reference preserved.");

  } finally {
    // Teardown temporary test candidate and pothole records
    console.log('\n--- Cleaning up temporary test records ---');
    if (createdCandidateIds.length > 0) {
      const delCand = await CandidateEvent.deleteMany({ candidateId: { $in: createdCandidateIds } });
      console.log(`Cleaned up ${delCand.deletedCount} temporary test candidate records.`);
    }
    if (createdPotholeIds.length > 0) {
      const delPot = await Pothole.deleteMany({ potholeId: { $in: createdPotholeIds } });
      console.log(`Cleaned up ${delPot.deletedCount} temporary test Pothole records.`);
    }
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected.');
  }

  console.log('\n==============================================================');
  console.log(`PHASE 7B TEST SUMMARY: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('==============================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled error during Phase 7B tests:', err);
  process.exit(1);
});
