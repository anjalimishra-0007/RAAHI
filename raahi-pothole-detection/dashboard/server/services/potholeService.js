import Pothole from '../models/Pothole.js';

/**
 * Pothole Persistence Service
 * ===========================
 * Handles candidate validation, sequential safe ID generation,
 * and persistence into MongoDB as permanent Pothole records.
 */

/**
 * Safely generates the next available unique potholeId (e.g. POT-000002)
 * by querying existing records in MongoDB and determining the maximum numeric suffix.
 * 
 * @returns {Promise<string>} Next unique potholeId
 */
export async function getNextPotholeId() {
  // Query all existing IDs matching POT-XXXXXX pattern
  const existingRecords = await Pothole.find(
    { potholeId: /^POT-\d+$/ },
    { potholeId: 1 }
  ).lean();

  let maxNum = 0;
  for (const record of existingRecords) {
    const match = (record.potholeId || '').match(/^POT-(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(6, '0');
  return `POT-${padded}`;
}

/**
 * Validates a pothole incident candidate payload against business rules.
 * 
 * @param {object} candidate - Provisional candidate object
 * @returns {object} { valid: boolean, error: string|null, sanitized: object|null }
 */
export function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, error: "Candidate must be a non-null object." };
  }

  // 1. Confirm candidate type is pothole
  const type = (candidate.type || '').toLowerCase();
  if (type && type !== 'pothole') {
    return { valid: false, error: `Invalid candidate type '${candidate.type}'. Expected 'pothole'.` };
  }

  // 2. Confirm location exists and coordinates are valid
  const loc = candidate.location;
  if (!loc || typeof loc !== 'object') {
    return { valid: false, error: "Candidate must contain a valid 'location' object." };
  }

  const lat = typeof loc.latitude === 'string' ? parseFloat(loc.latitude) : loc.latitude;
  const lng = typeof loc.longitude === 'string' ? parseFloat(loc.longitude) : loc.longitude;
  const acc = (loc.accuracy !== undefined && loc.accuracy !== null)
    ? (typeof loc.accuracy === 'string' ? parseFloat(loc.accuracy) : loc.accuracy)
    : null;

  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: `Invalid latitude '${loc.latitude}'. Must be a finite number between -90 and 90.` };
  }

  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: `Invalid longitude '${loc.longitude}'. Must be a finite number between -180 and 180.` };
  }

  if (acc !== null && (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0)) {
    return { valid: false, error: `Invalid accuracy '${loc.accuracy}'. Must be a non-negative number or null.` };
  }

  // 3. Confirm confidence is between 0 and 1
  const rawConf = typeof candidate.confidence === 'string' ? parseFloat(candidate.confidence) : candidate.confidence;
  if (typeof rawConf !== 'number' || !Number.isFinite(rawConf) || rawConf < 0 || rawConf > 1) {
    return { valid: false, error: `Invalid confidence '${candidate.confidence}'. Must be a number between 0.0 and 1.0.` };
  }

  // 4. Confirm GPS timestamp exists and is a valid date
  const ts = candidate.gpsTimestamp;
  if (!ts) {
    return { valid: false, error: "Missing required 'gpsTimestamp' on candidate." };
  }

  const parsedDate = new Date(ts);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, error: `Invalid gpsTimestamp '${ts}'. Must be a valid date or ISO 8601 string.` };
  }

  const bus = (candidate.busId || candidate.bus || candidate.busesDetectedBy?.[0] || 'RAAHI-01').trim();

  return {
    valid: true,
    error: null,
    sanitized: {
      latitude: lat,
      longitude: lng,
      accuracy: acc !== null ? Math.round(acc * 10) / 10 : null,
      confidence: Math.round(rawConf * 100) / 100,
      gpsTimestamp: parsedDate,
      bus: bus || 'RAAHI-01',
      type: 'pothole'
    }
  };
}

/**
 * Creates and persists a new permanent Pothole document in MongoDB
 * from a validated candidate. Handles unique ID collision safely with retries.
 * 
 * @param {object} candidate - Provisional candidate object
 * @returns {Promise<object>} Created Mongoose Pothole document
 */
export async function createFromCandidate(candidate) {
  const validation = validateCandidate(candidate);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.status = 400;
    throw err;
  }

  const { sanitized } = validation;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const nextId = await getNextPotholeId();

    const newPothole = new Pothole({
      potholeId: nextId,
      location: {
        latitude: sanitized.latitude,
        longitude: sanitized.longitude,
        accuracy: sanitized.accuracy
      },
      address: candidate.address || '',
      firstDetectedAt: sanitized.gpsTimestamp,
      lastDetectedAt: sanitized.gpsTimestamp,
      detectionCount: 1,
      busesDetectedBy: [sanitized.bus],
      confidence: sanitized.confidence,
      videoUrl: candidate.videoUrl || candidate.evidenceReference || '',
      evidenceReference: candidate.evidenceReference || candidate.videoUrl || '',
      status: 'open',
      ...(typeof candidate.edgeEventId === 'string' && candidate.edgeEventId.trim()
        ? { edgeEventId: candidate.edgeEventId.trim() }
        : {}),
      ...(typeof candidate.sourceCandidateId === 'string' && candidate.sourceCandidateId.trim()
        ? { sourceCandidateId: candidate.sourceCandidateId.trim() }
        : (typeof candidate.candidateId === 'string' && candidate.candidateId.trim()
          ? { sourceCandidateId: candidate.candidateId.trim() }
          : {})),
      ...(typeof candidate.class === 'string' && candidate.class.trim()
        ? { class: candidate.class.trim() }
        : {}),
      ...(typeof candidate.verifiedClass === 'string' && candidate.verifiedClass.trim()
        ? { verifiedClass: candidate.verifiedClass.trim() }
        : {}),
      ...(typeof candidate.edgeModel === 'string' && candidate.edgeModel.trim()
        ? { edgeModel: candidate.edgeModel.trim() }
        : {}),
      ...(candidate.boundingBox ? { boundingBox: candidate.boundingBox } : {}),
      ...(typeof candidate.centralDeliveryStatus === 'string' && candidate.centralDeliveryStatus.trim()
        ? { centralDeliveryStatus: candidate.centralDeliveryStatus.trim() }
        : {})
    });

    try {
      const savedDoc = await newPothole.save();
      console.log(`[PotholeService] Created new pothole record: ${savedDoc.potholeId} (ID: ${savedDoc._id})`);
      return savedDoc;
    } catch (err) {
      // Duplicate key error on unique index (code 11000)
      if (err.code === 11000 && attempt < maxRetries) {
        console.warn(`[PotholeService] ID collision for ${nextId}. Retrying with next available ID (attempt ${attempt + 1})...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to generate unique potholeId after multiple attempts.");
}
