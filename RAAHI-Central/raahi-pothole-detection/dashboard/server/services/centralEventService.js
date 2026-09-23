import CandidateEvent from '../models/CandidateEvent.js';
import Pothole from '../models/Pothole.js';
import { promoteCandidate, isSupportedAuthoritativeClass } from './centralEventPromotionService.js';
import { createOrUpdateTrafficIncident } from './trafficIncidentService.js';

/**
 * Central Event Ingestion Service (Phase 2 & SIH Edge Integration)
 * ==============================================================
 * Implements the canonical Central Ingestion Architecture for RAAHI.
 * Accepts pre-associated, validated Event Packages from RAAHI-Edge.
 * 
 * ARCHITECTURAL CONSTRAINTS:
 * - Deterministic validation and normalization of incoming Edge packages.
 * - Idempotently persists in candidate_events.
 * - Deterministically executes 10m Haversine deduplication / cross-bus fusion for potholes.
 * - Deterministically executes 50m / 10min spatial-temporal cross-bus correlation for traffic.
 * - NO AI inference on Central (no VLM, no LLM, no Central YOLO).
 */

/**
 * Generates the next sequential candidate identifier (e.g. CAN-000001).
 * 
 * @returns {Promise<string>} Next unique candidateId
 */
export async function getNextCandidateId() {
  const existingRecords = await CandidateEvent.find(
    { candidateId: /^CAN-\d+$/ },
    { candidateId: 1 }
  ).lean();

  let maxNum = 0;
  for (const record of existingRecords) {
    const match = (record.candidateId || '').match(/^CAN-(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(6, '0');
  return `CAN-${padded}`;
}

/**
 * Validates an incoming Edge Event Package.
 * 
 * @param {object} payload - Raw event payload from RAAHI-Edge
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateEventPackage(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: "Payload must be a non-null JSON object." };
  }

  // 1. eventId / edgeEventId
  const eventId = payload.eventId || payload.edgeEventId;
  if (!eventId || typeof eventId !== 'string' || !eventId.trim()) {
    return { valid: false, error: "Missing or invalid 'eventId'. Must be a non-empty string." };
  }

  // 2. eventType
  const eventType = payload.eventType || payload.type;
  if (!eventType || typeof eventType !== 'string' || !eventType.trim()) {
    return { valid: false, error: "Missing or invalid 'eventType'. Must be a non-empty string." };
  }

  // 3. busId
  const busId = payload.busId || payload.bus;
  if (!busId || typeof busId !== 'string' || !busId.trim()) {
    return { valid: false, error: "Missing or invalid 'busId'. Must be a non-empty string." };
  }

  // 4. timestamp
  const ts = payload.timestamp || payload.gpsTimestamp;
  if (!ts) {
    return { valid: false, error: "Missing required 'timestamp'." };
  }
  const parsedDate = new Date(ts);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: `Invalid 'timestamp' value: '${ts}'. Must be a valid ISO 8601 or parseable date string.` };
  }

  // 5. GPS Coordinates (supports flat latitude/longitude or nested gps/location object)
  const loc = payload.location || payload.gps || {};
  const latRaw = payload.latitude !== undefined ? payload.latitude : loc.latitude;
  const lngRaw = payload.longitude !== undefined ? payload.longitude : loc.longitude;

  if (latRaw === undefined || latRaw === null || latRaw === '') {
    return { valid: false, error: "Missing required GPS 'latitude'." };
  }
  if (lngRaw === undefined || lngRaw === null || lngRaw === '') {
    return { valid: false, error: "Missing required GPS 'longitude'." };
  }

  const lat = typeof latRaw === 'string' ? parseFloat(latRaw) : latRaw;
  const lng = typeof lngRaw === 'string' ? parseFloat(lngRaw) : lngRaw;

  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: `Invalid GPS latitude '${latRaw}'. Must be a finite number between -90 and 90 degrees.` };
  }

  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: `Invalid GPS longitude '${lngRaw}'. Must be a finite number between -180 and 180 degrees.` };
  }

  // 6. GPS Accuracy (optional / when supplied)
  const accRaw = payload.accuracy !== undefined ? payload.accuracy : loc.accuracy;
  if (accRaw !== undefined && accRaw !== null && accRaw !== '') {
    const acc = typeof accRaw === 'string' ? parseFloat(accRaw) : accRaw;
    if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0) {
      return { valid: false, error: `Invalid GPS accuracy '${accRaw}'. Must be a non-negative finite number.` };
    }
  }

  // 7. Edge Model
  const edgeModel = payload.edgeModel || payload.edge_model || payload['edge model'];
  if (!edgeModel || typeof edgeModel !== 'string' || !edgeModel.trim()) {
    return { valid: false, error: "Missing or invalid 'edge model'. Must specify edge detector (e.g. 'YOLO11n')." };
  }

  // 8. Confidence (0.0 to 1.0)
  const confRaw = payload.confidence;
  if (confRaw === undefined || confRaw === null || confRaw === '') {
    return { valid: false, error: "Missing required 'confidence' score." };
  }
  const conf = typeof confRaw === 'string' ? parseFloat(confRaw) : confRaw;
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) {
    return { valid: false, error: `Invalid 'confidence' score '${confRaw}'. Must be a finite number between 0.0 and 1.0.` };
  }

  // 9. Class
  const cls = payload.class || payload.className || payload.detectionClass;
  if (!cls || typeof cls !== 'string' || !cls.trim()) {
    return { valid: false, error: "Missing or invalid detection 'class'. Must be a non-empty string." };
  }

  // 10. Bounding Box
  const bbox = payload.boundingBox || payload.bbox;
  if (!bbox || typeof bbox !== 'object') {
    return { valid: false, error: "Missing or invalid 'boundingBox'. Must be a coordinate object or array." };
  }

  const parsedBbox = extractBoundingBox(bbox);
  if (!parsedBbox) {
    return { valid: false, error: "Invalid 'boundingBox' format. Expected { x1, y1, x2, y2 } or { x, y, width, height } with numeric values." };
  }

  // 11. Evidence Reference (optional / string when supplied)
  const evidenceRef = payload.evidenceReference || payload.evidence_reference || payload.evidence || payload.videoUrl;
  if (evidenceRef !== undefined && evidenceRef !== null && typeof evidenceRef !== 'string') {
    return { valid: false, error: "Invalid 'evidence reference'. When provided, must be a string." };
  }

  return { valid: true, error: null };
}

/**
 * Helper to parse various bounding box conventions into { x1, y1, x2, y2 }.
 */
export function extractBoundingBox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;

  // Array format [x1, y1, x2, y2]
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [x1, y1, x2, y2] = bbox.map(v => typeof v === 'string' ? parseFloat(v) : v);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return { x1, y1, x2, y2 };
    }
    return null;
  }

  // Object format with x1, y1, x2, y2
  if (bbox.x1 !== undefined && bbox.y1 !== undefined && bbox.x2 !== undefined && bbox.y2 !== undefined) {
    const x1 = typeof bbox.x1 === 'string' ? parseFloat(bbox.x1) : bbox.x1;
    const y1 = typeof bbox.y1 === 'string' ? parseFloat(bbox.y1) : bbox.y1;
    const x2 = typeof bbox.x2 === 'string' ? parseFloat(bbox.x2) : bbox.x2;
    const y2 = typeof bbox.y2 === 'string' ? parseFloat(bbox.y2) : bbox.y2;
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      return { x1, y1, x2, y2 };
    }
    return null;
  }

  // Object format with x, y, width, height
  if (bbox.x !== undefined && bbox.y !== undefined && (bbox.width !== undefined || bbox.w !== undefined) && (bbox.height !== undefined || bbox.h !== undefined)) {
    const x = typeof bbox.x === 'string' ? parseFloat(bbox.x) : bbox.x;
    const y = typeof bbox.y === 'string' ? parseFloat(bbox.y) : bbox.y;
    const w = typeof (bbox.width ?? bbox.w) === 'string' ? parseFloat(bbox.width ?? bbox.w) : (bbox.width ?? bbox.w);
    const h = typeof (bbox.height ?? bbox.h) === 'string' ? parseFloat(bbox.height ?? bbox.h) : (bbox.height ?? bbox.h);
    if ([x, y, w, h].every(Number.isFinite)) {
      return { x1: x, y1: y, x2: x + w, y2: y + h };
    }
  }

  return null;
}

/**
 * Normalizes an incoming Edge Event Package into Central's canonical schema.
 * 
 * @param {object} payload - Validated raw event package
 * @returns {object} Canonical normalized event object
 */
export function normalizeEventPackage(payload) {
  const loc = payload.location || payload.gps || {};
  const latRaw = payload.latitude !== undefined ? payload.latitude : loc.latitude;
  const lngRaw = payload.longitude !== undefined ? payload.longitude : loc.longitude;
  const accRaw = payload.accuracy !== undefined ? payload.accuracy : loc.accuracy;

  const lat = typeof latRaw === 'string' ? parseFloat(latRaw) : latRaw;
  const lng = typeof lngRaw === 'string' ? parseFloat(lngRaw) : lngRaw;
  const acc = (accRaw !== undefined && accRaw !== null && accRaw !== '')
    ? (typeof accRaw === 'string' ? parseFloat(accRaw) : accRaw)
    : null;

  const confRaw = payload.confidence;
  const conf = typeof confRaw === 'string' ? parseFloat(confRaw) : confRaw;

  const ts = payload.timestamp || payload.gpsTimestamp;
  const parsedDate = new Date(ts);

  const eventId = (payload.eventId || payload.edgeEventId).trim();
  const eventType = (payload.eventType || payload.type || 'pothole').trim().toLowerCase();
  const busId = (payload.busId || payload.bus).trim();
  const edgeModel = (payload.edgeModel || payload.edge_model || payload['edge model']).trim();
  const cls = (payload.class || payload.className || payload.detectionClass || 'pothole').trim().toLowerCase();
  const bbox = extractBoundingBox(payload.boundingBox || payload.bbox);
  const evidenceRef = (payload.evidenceReference || payload.evidence_reference || payload.evidence || payload.videoUrl || '').trim();

  return {
    edgeEventId: eventId,
    eventType,
    busId,
    timestamp: parsedDate,
    location: {
      latitude: lat,
      longitude: lng,
      accuracy: acc !== null ? Math.round(acc * 10) / 10 : null
    },
    edgeModel,
    confidence: Math.round(conf * 100) / 100,
    class: cls,
    boundingBox: bbox,
    trafficTelemetry: payload.trafficTelemetry || null,
    evidenceReference: evidenceRef,
    status: 'pending',
    centralDeliveryStatus: 'received'
  };
}

/**
 * Ingests a canonical Edge Event Package as a Central Candidate Event,
 * and automatically triggers deterministic deduplication / incident correlation.
 * 
 * @param {object} payload - Raw event package from RAAHI-Edge
 * @returns {Promise<object>} Ingestion result with CandidateEvent and authoritative records
 */
export async function ingestCandidateEvent(payload) {
  // 1. Validation
  const validation = validateEventPackage(payload);
  if (!validation.valid) {
    const error = new Error(validation.error);
    error.status = 400;
    throw error;
  }

  // 2. Normalization
  const normalized = normalizeEventPackage(payload);

  // 3. Idempotency Check on CandidateEvent collection
  const existing = await CandidateEvent.findOne({ edgeEventId: normalized.edgeEventId });
  if (existing) {
    console.log(`[CentralIngestion] Idempotent hit: Event ${normalized.edgeEventId} already exists as Candidate ${existing.candidateId}`);
    return {
      success: true,
      created: false,
      duplicate: true,
      message: `Candidate event '${normalized.edgeEventId}' already ingested. Existing candidate returned.`,
      candidateId: existing.candidateId,
      edgeEventId: existing.edgeEventId,
      status: existing.status || 'pending',
      candidate: existing
    };
  }

  // 4. Generate sequential Candidate ID (CAN-XXXXXX)
  const nextId = await getNextCandidateId();

  // 5. Create Candidate Event in MongoDB candidate_events collection
  try {
    const candidate = new CandidateEvent({
      candidateId: nextId,
      edgeEventId: normalized.edgeEventId,
      eventType: normalized.eventType,
      class: normalized.class,
      edgeModel: normalized.edgeModel,
      location: {
        latitude: normalized.location.latitude,
        longitude: normalized.location.longitude,
        accuracy: normalized.location.accuracy
      },
      confidence: normalized.confidence,
      boundingBox: normalized.boundingBox,
      trafficTelemetry: normalized.trafficTelemetry,
      evidenceReference: normalized.evidenceReference,
      timestamp: normalized.timestamp,
      busId: normalized.busId,
      status: 'pending',
      centralDeliveryStatus: 'received',
      promotedToPotholeId: null
    });

    const savedDoc = await candidate.save();
    console.log(`[CentralIngestion] Ingested candidate event: ${savedDoc.candidateId} (Edge: ${savedDoc.edgeEventId}, Bus: ${normalized.busId})`);

    // 6. Deterministic Auto-Promotion / Spatial Deduplication / Traffic Correlation
    let promotionResult = null;
    let trafficResult = null;

    if (normalized.eventType === 'pothole' || isSupportedAuthoritativeClass(normalized.class)) {
      try {
        promotionResult = await promoteCandidate(savedDoc.candidateId);
      } catch (promoErr) {
        console.warn(`[CentralIngestion] Auto-promotion error for ${savedDoc.candidateId}:`, promoErr.message);
      }
    } else if (
      normalized.eventType === 'congestion' ||
      normalized.eventType === 'traffic' ||
      normalized.class === 'traffic_congestion'
    ) {
      try {
        trafficResult = await createOrUpdateTrafficIncident(savedDoc);
      } catch (trfErr) {
        console.warn(`[CentralIngestion] Traffic incident correlation error for ${savedDoc.candidateId}:`, trfErr.message);
      }
    }

    return {
      success: true,
      created: true,
      duplicate: false,
      message: "Candidate event ingested and processed deterministically.",
      candidateId: savedDoc.candidateId,
      edgeEventId: savedDoc.edgeEventId,
      status: savedDoc.status,
      candidate: savedDoc,
      promotion: promotionResult,
      trafficIncident: trafficResult
    };
  } catch (err) {
    // Handle concurrent duplicate key race condition safely
    if (err.code === 11000 && err.keyPattern && err.keyPattern.edgeEventId) {
      const concurrentMatch = await CandidateEvent.findOne({ edgeEventId: normalized.edgeEventId });
      if (concurrentMatch) {
        return {
          success: true,
          created: false,
          duplicate: true,
          message: `Candidate event '${normalized.edgeEventId}' already ingested. Existing candidate returned.`,
          candidateId: concurrentMatch.candidateId,
          edgeEventId: concurrentMatch.edgeEventId,
          status: concurrentMatch.status || 'pending',
          candidate: concurrentMatch
        };
      }
    }
    throw err;
  }
}

/**
 * Retrieves candidate events with optional filtering.
 */
export async function getCandidateEvents(filters = {}) {
  const query = {};

  if (filters.status) {
    query.status = filters.status.toLowerCase();
  }
  if (filters.isPromoted !== undefined) {
    if (filters.isPromoted === 'true' || filters.isPromoted === true) {
      query.promotedToPotholeId = { $ne: null };
    } else if (filters.isPromoted === 'false' || filters.isPromoted === false) {
      query.promotedToPotholeId = null;
    }
  }
  if (filters.busId) {
    query.busId = filters.busId;
  }
  if (filters.eventType) {
    query.eventType = filters.eventType.toLowerCase();
  }

  const limit = filters.limit ? parseInt(filters.limit, 10) : 100;
  const sort = filters.sort || '-createdAt';

  const candidates = await CandidateEvent.find(query)
    .sort(sort)
    .limit(limit)
    .lean();

  return {
    count: candidates.length,
    candidates
  };
}
