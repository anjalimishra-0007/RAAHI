import CandidateEvent from '../models/CandidateEvent.js';
import Pothole from '../models/Pothole.js';
import * as potholeDeduplicationService from './potholeDeduplicationService.js';

/**
 * Central Event Promotion & Cross-Bus Fusion Service
 * ===================================================
 * Bridges candidate events from the canonical Candidate buffer to the
 * authoritative Pothole collection through the existing 10m geospatial
 * deduplication engine.
 * 
 * STRICT ARCHITECTURAL PRINCIPLES:
 * 1. Validates candidate eligibility (supported authoritative class: 'pothole', 'road_damage').
 * 2. Never overwrites or recalculates authoritative Edge GPS telemetry.
 * 3. Never mutates Edge confidence score.
 * 4. Preserves original Edge classification in 'class'.
 * 5. Reuses existing 10m Haversine deduplication engine.
 * 6. Enforces idempotency: multiple promotions of the same candidate never create duplicate potholes.
 * 7. CandidateEvent remains in 'candidate_events' collection as an immutable audit record.
 */

export const SUPPORTED_AUTHORITATIVE_CLASSES = Object.freeze([
  'pothole',
  'road_damage'
]);

/**
 * Determines whether a classification is supported by the authoritative Pothole incident system.
 * 
 * @param {string} classification
 * @returns {boolean}
 */
export function isSupportedAuthoritativeClass(classification) {
  if (!classification || typeof classification !== 'string') return false;
  return SUPPORTED_AUTHORITATIVE_CLASSES.includes(classification.trim().toLowerCase());
}

/**
 * Promotes an eligible CandidateEvent into the authoritative Pothole collection.
 * 
 * @param {string} candidateId - Candidate identifier (CAN-XXXXXX or canonical edgeEventId)
 * @param {object} [options={}] - Promotion options
 * @returns {Promise<object>} Result of promotion and authoritative Pothole document
 */
export async function promoteCandidate(candidateId, options = {}) {
  if (!candidateId || typeof candidateId !== 'string' || !candidateId.trim()) {
    const err = new Error("Missing or invalid 'candidateId' parameter.");
    err.status = 400;
    throw err;
  }

  // 1. Locate CandidateEvent in MongoDB
  const trimmedId = candidateId.trim();
  const candidate = await CandidateEvent.findOne({
    $or: [{ candidateId: trimmedId }, { edgeEventId: trimmedId }]
  });

  if (!candidate) {
    const err = new Error(`Candidate event '${candidateId}' not found.`);
    err.status = 404;
    throw err;
  }

  // 2. IDEMPOTENCY CHECK: Return existing authoritative record if already promoted
  if (candidate.promotedToPotholeId) {
    const existingPothole = await Pothole.findOne({ potholeId: candidate.promotedToPotholeId });
    return {
      success: true,
      alreadyPromoted: true,
      promoted: true,
      candidateId: candidate.candidateId,
      edgeEventId: candidate.edgeEventId,
      potholeId: candidate.promotedToPotholeId,
      action: 'already_promoted',
      message: `Candidate ${candidate.candidateId} was already promoted to ${candidate.promotedToPotholeId}.`,
      pothole: existingPothole
    };
  }

  // 3. ELIGIBILITY RULE: Candidate class must match supported authoritative class
  const candidateClass = (candidate.class || '').trim().toLowerCase();
  if (!isSupportedAuthoritativeClass(candidateClass)) {
    console.warn(`[CentralPromotion] Promotion refused for ${candidate.candidateId}: Class '${candidate.class}' is not supported by Pothole system.`);
    return {
      success: false,
      status: 'UNSUPPORTED_CLASSIFICATION',
      error: 'UNSUPPORTED_CLASSIFICATION',
      message: `Classification '${candidate.class}' is not supported by the authoritative Pothole incident system. Candidate remains recorded in candidate_events.`,
      candidateId: candidate.candidateId,
      edgeEventId: candidate.edgeEventId,
      class: candidate.class
    };
  }

  // 4. ADAPTER & NORMALIZATION LAYER: Map CandidateEvent to Deduplication Payload
  // Preserves authoritative Edge telemetry verbatim (GPS, busId, Edge confidence, Edge class)
  const deduplicationPayload = {
    type: 'pothole',
    confidence: candidate.confidence, // Original Edge confidence preserved!
    location: {
      latitude: candidate.location.latitude,
      longitude: candidate.location.longitude,
      accuracy: candidate.location.accuracy
    },
    gpsTimestamp: candidate.timestamp,
    bus: candidate.busId,
    busId: candidate.busId,
    edgeEventId: candidate.edgeEventId,
    sourceCandidateId: candidate.candidateId,
    candidateId: candidate.candidateId,
    class: candidate.class, // Original Edge class preserved!
    edgeModel: candidate.edgeModel || 'YOLO11n',
    boundingBox: candidate.boundingBox,
    evidenceReference: candidate.evidenceReference || '',
    videoUrl: candidate.evidenceReference || ''
  };

  // 5. INVOKE EXISTING 10m GEOSPATIAL DEDUPLICATION ENGINE
  const dedupResult = await potholeDeduplicationService.createOrUpdatePothole(deduplicationPayload);

  // 6. RESOLVE TARGET POTHOLE ID
  const targetPotholeId = dedupResult.deduplicated
    ? dedupResult.matchedPotholeId
    : dedupResult.pothole.potholeId;

  // 7. UPDATE CANDIDATE AUDIT TRAIL
  candidate.promotedToPotholeId = targetPotholeId;
  candidate.status = 'promoted';
  await candidate.save();

  console.log(`[CentralPromotion] Successfully promoted Candidate ${candidate.candidateId} to Authoritative Pothole ${targetPotholeId} (Action: ${dedupResult.deduplicated ? 'matched_existing' : 'created'})`);

  return {
    success: true,
    promoted: true,
    candidateId: candidate.candidateId,
    edgeEventId: candidate.edgeEventId,
    potholeId: targetPotholeId,
    action: dedupResult.deduplicated ? 'matched_existing' : 'created',
    distanceMeters: dedupResult.distanceMeters,
    pothole: dedupResult.pothole
  };
}

