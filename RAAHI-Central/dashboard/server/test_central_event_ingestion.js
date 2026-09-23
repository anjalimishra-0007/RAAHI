import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';
import CandidateEvent from './models/CandidateEvent.js';
import {
  validateEventPackage,
  normalizeEventPackage,
  ingestCandidateEvent,
  getCandidateEvents,
  getCandidateById,
  extractBoundingBox
} from './services/centralEventService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

console.log('==============================================================');
console.log('  RAAHI: CANDIDATE EVENT SEPARATION TEST SUITE (PHASE 2)      ');
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

  const TEST_EVENT_ID_1 = `TEST-EVT-${Date.now()}-001`;
  const TEST_EVENT_ID_2 = `TEST-EVT-${Date.now()}-002`;

  try {
    // Record baseline count of authoritative potholes
    const initialPotholeCount = await Pothole.countDocuments();

    // -------------------------------------------------------------
    // TEST 1: Valid Canonical Event Package
    // -------------------------------------------------------------
    console.log('--- TEST 1: Valid Canonical Event Package Validation ---');
    const validPayload = {
      eventId: TEST_EVENT_ID_1,
      eventType: "pothole",
      busId: "RAAHI-01",
      timestamp: "2026-09-15T10:30:00.000Z",
      latitude: 28.613905,
      longitude: 77.209008,
      accuracy: 3.5,
      edgeModel: "YOLO11n",
      confidence: 0.88,
      class: "pothole",
      boundingBox: { x1: 120, y1: 240, x2: 210, y2: 320 },
      evidenceReference: "https://drive.google.com/file/d/test-evidence-id/view",
      verificationStatus: "unverified",
      centralDeliveryStatus: "received"
    };

    const validRes = validateEventPackage(validPayload);
    assert(validRes.valid === true && validRes.error === null, "Valid canonical event package passes validation.");

    // -------------------------------------------------------------
    // TEST 2: Missing eventId
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Missing eventId Validation ---');
    const missingEventIdPayload = { ...validPayload, eventId: "" };
    delete missingEventIdPayload.edgeEventId;
    const res2 = validateEventPackage(missingEventIdPayload);
    assert(res2.valid === false && res2.error.includes("eventId"), "Rejects missing or empty eventId.");

    // -------------------------------------------------------------
    // TEST 3: Missing busId
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Missing busId Validation ---');
    const missingBusPayload = { ...validPayload, busId: null };
    delete missingBusPayload.bus;
    const res3 = validateEventPackage(missingBusPayload);
    assert(res3.valid === false && res3.error.includes("busId"), "Rejects missing or null busId.");

    // -------------------------------------------------------------
    // TEST 4: Invalid timestamp
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Invalid timestamp Validation ---');
    const invalidTsPayload = { ...validPayload, timestamp: "not-a-real-date-timestamp" };
    const res4 = validateEventPackage(invalidTsPayload);
    assert(res4.valid === false && res4.error.includes("timestamp"), "Rejects unparseable timestamp.");

    // -------------------------------------------------------------
    // TEST 5: Invalid latitude (< -90 or > 90)
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Invalid latitude Validation ---');
    const invalidLatPayload1 = { ...validPayload, latitude: 125.5 };
    const invalidLatPayload2 = { ...validPayload, latitude: -95.0 };
    const res5a = validateEventPackage(invalidLatPayload1);
    const res5b = validateEventPackage(invalidLatPayload2);
    assert(res5a.valid === false && res5b.valid === false, "Rejects out-of-bounds latitude (< -90 or > 90).");

    // -------------------------------------------------------------
    // TEST 6: Invalid longitude (< -180 or > 180)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Invalid longitude Validation ---');
    const invalidLngPayload = { ...validPayload, longitude: 195.0 };
    const res6 = validateEventPackage(invalidLngPayload);
    assert(res6.valid === false && res6.error.includes("longitude"), "Rejects out-of-bounds longitude (< -180 or > 180).");

    // -------------------------------------------------------------
    // TEST 7: Invalid confidence (< 0 or > 1 or non-numeric)
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Invalid confidence Validation ---');
    const invalidConfPayload1 = { ...validPayload, confidence: 1.5 };
    const invalidConfPayload2 = { ...validPayload, confidence: -0.1 };
    const invalidConfPayload3 = { ...validPayload, confidence: "very-high" };
    const res7a = validateEventPackage(invalidConfPayload1);
    const res7b = validateEventPackage(invalidConfPayload2);
    const res7c = validateEventPackage(invalidConfPayload3);
    assert(res7a.valid === false && res7b.valid === false && res7c.valid === false, "Rejects invalid confidence scores.");

    // -------------------------------------------------------------
    // TEST 8: Invalid bounding box
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Invalid bounding box Validation ---');
    const invalidBboxPayload1 = { ...validPayload, boundingBox: "box-string" };
    const invalidBboxPayload2 = { ...validPayload, boundingBox: { x1: "bad" } };
    const res8a = validateEventPackage(invalidBboxPayload1);
    const res8b = validateEventPackage(invalidBboxPayload2);
    assert(res8a.valid === false && res8b.valid === false, "Rejects malformed bounding box.");

    // Test support for alternate valid bounding box formats
    const arrayBbox = extractBoundingBox([10, 20, 110, 120]);
    const xywhBbox = extractBoundingBox({ x: 10, y: 20, width: 100, height: 100 });
    assert(arrayBbox && arrayBbox.x1 === 10 && arrayBbox.x2 === 110, "Extracts array bounding box [x1, y1, x2, y2].");
    assert(xywhBbox && xywhBbox.x1 === 10 && xywhBbox.x2 === 110, "Extracts { x, y, width, height } bounding box.");

    // -------------------------------------------------------------
    // TEST 9 & 10: Ingest Candidate Event with verificationStatus: unverified
    // (Stored in candidate_events, NOT in authoritative potholes)
    // -------------------------------------------------------------
    console.log('\n--- TEST 9 & 10: Ingestion Creates CandidateEvent in candidate_events ---');
    const ingestResult1 = await ingestCandidateEvent(validPayload);

    assert(ingestResult1.success === true, "Ingestion succeeds for valid package.");
    assert(ingestResult1.created === true, "New candidate record is created in MongoDB.");
    assert(ingestResult1.duplicate === false, "Duplicate flag is false on first ingestion.");
    assert(ingestResult1.status === 'pending', "Candidate status is strictly 'pending'.");
    assert(ingestResult1.candidateId.startsWith('CAN-'), `Generated candidateId '${ingestResult1.candidateId}' with prefix 'CAN-'.`);
    assert(ingestResult1.candidate.edgeEventId === TEST_EVENT_ID_1, "Preserves canonical edgeEventId.");
    assert(ingestResult1.candidate.edgeModel === 'YOLO11n', "Preserves edge model identifier.");
    assert(ingestResult1.candidate.status === 'pending', "Candidate status is unpromoted pending.");

    // Verify stored in CandidateEvent collection
    const storedCandidate = await CandidateEvent.findOne({ edgeEventId: TEST_EVENT_ID_1 }).lean();
    assert(storedCandidate !== null, "Stored candidate document found in candidate_events collection.");
    assert(storedCandidate.status === 'pending', "CandidateEvent document has status = 'pending'.");

    // -------------------------------------------------------------
    // TEST 11: CandidateEvent does NOT create an Authoritative Pothole
    // -------------------------------------------------------------
    console.log('\n--- TEST 11: CandidateEvent Does NOT Create Authoritative Pothole ---');
    const potholeCheck = await Pothole.findOne({ edgeEventId: TEST_EVENT_ID_1 }).lean();
    assert(potholeCheck === null, "No document created in authoritative 'potholes' collection for this candidate.");

    const postPotholeCount = await Pothole.countDocuments();
    assert(postPotholeCount === initialPotholeCount, `Authoritative Pothole count unchanged (${postPotholeCount} === ${initialPotholeCount}).`);

    // -------------------------------------------------------------
    // TEST 12: Idempotent Handling of Duplicate eventId in candidate_events
    // -------------------------------------------------------------
    console.log('\n--- TEST 12: Idempotent Handling of Duplicate eventId in candidate_events ---');
    const beforeCount = await CandidateEvent.countDocuments({ edgeEventId: TEST_EVENT_ID_1 });
    const ingestResultDuplicate = await ingestCandidateEvent(validPayload);
    const afterCount = await CandidateEvent.countDocuments({ edgeEventId: TEST_EVENT_ID_1 });

    assert(ingestResultDuplicate.success === true, "Duplicate ingestion returns success: true.");
    assert(ingestResultDuplicate.created === false, "Duplicate ingestion does NOT create new document (created: false).");
    assert(ingestResultDuplicate.duplicate === true, "Duplicate flag is true.");
    assert(ingestResultDuplicate.candidateId === storedCandidate.candidateId, "Returns same candidateId as original ingestion.");
    assert(beforeCount === 1 && afterCount === 1, "Exactly ONE document exists in candidate_events (no duplicate created).");

    // -------------------------------------------------------------
    // TEST 13: Candidate Inspection API (Filtering & Single Lookup)
    // -------------------------------------------------------------
    console.log('\n--- TEST 13: Candidate Inspection API Queries ---');
    const unverifiedList = await getCandidateEvents({ verificationStatus: 'unverified' });
    assert(unverifiedList.count >= 1, "getCandidateEvents returns list of unverified candidates.");
    assert(unverifiedList.candidates.some(c => c.edgeEventId === TEST_EVENT_ID_1), "Found candidate in unverified list.");

    const busFilterList = await getCandidateEvents({ busId: 'RAAHI-01' });
    assert(busFilterList.count >= 1, "getCandidateEvents filters candidates by busId.");

    const singleCandidate = await getCandidateById(storedCandidate.candidateId);
    assert(singleCandidate !== null && singleCandidate.candidateId === storedCandidate.candidateId, "getCandidateById retrieves candidate by candidateId.");

    // -------------------------------------------------------------
    // TEST 14: Architectural Rule Verification
    // (No GPS matching, No YOLO, No VLM, No 10m Deduplication)
    // -------------------------------------------------------------
    console.log('\n--- TEST 14: Architectural Rule Verification ---');
    assert(storedCandidate.location.latitude === 28.613905, "Stored latitude matches Edge payload exactly (no Central GPS matching).");
    assert(storedCandidate.location.longitude === 77.209008, "Stored longitude matches Edge payload exactly (no Central GPS matching).");
    assert(storedCandidate.status === 'pending', "Candidate status is pending.");
    assert(storedCandidate.promotedToPotholeId === null, "Candidate was NOT deduplicated into Pothole (promotedToPotholeId is null).");
    assert(storedCandidate.busId === 'RAAHI-01', "Preserves detecting bus ID.");

  } finally {
    // Cleanup test candidate records
    console.log('\n--- Cleaning up test candidate records ---');
    const deleteRes = await CandidateEvent.deleteMany({ edgeEventId: { $in: [TEST_EVENT_ID_1, TEST_EVENT_ID_2] } });
    console.log(`Cleaned up ${deleteRes.deletedCount} temporary test candidate records.`);
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected.');
  }

  console.log('\n==============================================================');
  console.log(`TEST SUMMARY: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('==============================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled error during tests:', err);
  process.exit(1);
});
