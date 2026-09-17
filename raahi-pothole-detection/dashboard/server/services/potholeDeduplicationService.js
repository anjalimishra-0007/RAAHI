import Pothole from '../models/Pothole.js';
import * as potholeService from './potholeService.js';

/**
 * Pothole Geographical Deduplication Service
 * =========================================
 * Evaluates candidate pothole coordinates against existing database records.
 * Uses the spherical Haversine formula to identify repeat detections of the same
 * physical pothole within a configurable radius (default: 10 meters).
 */

const EARTH_RADIUS_METERS = 6371000; // Mean Earth radius in meters

/**
 * Calculates the great-circle distance between two geographic coordinates
 * using the Haversine formula.
 * 
 * @param {number} lat1 - Latitude of first point in decimal degrees
 * @param {number} lon1 - Longitude of first point in decimal degrees
 * @param {number} lat2 - Latitude of second point in decimal degrees
 * @param {number} lon2 - Longitude of second point in decimal degrees
 * @returns {number} Great-circle distance in meters (rounded to 2 decimals)
 */
export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaPhi = (lat2 - lat1) * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_METERS * c;

  return Math.round(distance * 100) / 100;
}

/**
 * Retrieves the configured deduplication radius in meters from environment variables.
 * Defaults to 10 meters if not set or invalid.
 * 
 * @returns {number} Deduplication radius in meters
 */
export function getDedupRadiusMeters() {
  const envVal = process.env.POTHOLE_DEDUP_RADIUS_METERS;
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10.0; // Standard default 10m
}

/**
 * Searches MongoDB for an existing pothole located within radiusMeters of (latitude, longitude).
 * If multiple potholes are within the threshold, selects the closest one.
 * 
 * @param {number} latitude - Target latitude
 * @param {number} longitude - Target longitude
 * @param {number} [radiusMeters] - Search radius threshold in meters (defaults to configured env)
 * @returns {Promise<{ pothole: object, distanceMeters: number } | null>} Closest match or null
 */
export async function findNearbyPothole(latitude, longitude, radiusMeters) {
  const effectiveRadius = (typeof radiusMeters === 'number' && radiusMeters > 0)
    ? radiusMeters
    : getDedupRadiusMeters();

  // Retrieve existing potholes from MongoDB that are open or investigating
  const existingPotholes = await Pothole.find({
    status: { $ne: 'ignored' },
    'location.latitude': { $exists: true, $ne: null },
    'location.longitude': { $exists: true, $ne: null }
  });

  let closestMatch = null;
  let minDistance = Infinity;

  for (const doc of existingPotholes) {
    const lat = doc.location?.latitude;
    const lng = doc.location?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      continue;
    }

    const dist = haversineDistanceMeters(latitude, longitude, lat, lng);
    if (dist <= effectiveRadius && dist < minDistance) {
      minDistance = dist;
      closestMatch = {
        pothole: doc,
        distanceMeters: dist
      };
    }
  }

  return closestMatch;
}

/**
 * Updates an existing Pothole document in MongoDB when a repeat detection is verified.
 * - Increments detectionCount by 1
 * - Updates lastDetectedAt to candidate's GPS timestamp
 * - Updates confidence to latest detection confidence
 * - Appends the detecting bus ID without creating duplicates
 * 
 * @param {object} existingPothole - Mongoose Pothole document
 * @param {object} candidate - Sanitized candidate object
 * @returns {Promise<object>} Saved Mongoose document
 */
export async function updateExistingPothole(existingPothole, candidate) {
  // Increment detection counter
  existingPothole.detectionCount = (existingPothole.detectionCount || 1) + 1;

  // Update latest observation timestamp
  const ts = candidate.gpsTimestamp ? new Date(candidate.gpsTimestamp) : new Date();
  existingPothole.lastDetectedAt = ts;

  // Update latest detection confidence
  if (typeof candidate.confidence === 'number' && !isNaN(candidate.confidence)) {
    existingPothole.confidence = candidate.confidence;
  }

  // Update busesDetectedBy avoiding duplicates
  const bus = (candidate.busId || candidate.bus || candidate.busesDetectedBy?.[0] || 'RAAHI-01').trim();
  if (bus) {
    if (!Array.isArray(existingPothole.busesDetectedBy)) {
      existingPothole.busesDetectedBy = [];
    }
    if (!existingPothole.busesDetectedBy.includes(bus)) {
      existingPothole.busesDetectedBy.push(bus);
    }
  }

  // Preserve evidence if existing pothole lacked it
  const incomingEvidence = candidate.evidenceReference || candidate.videoUrl;
  if (incomingEvidence) {
    if (!existingPothole.videoUrl) {
      existingPothole.videoUrl = incomingEvidence;
    }
    if (!existingPothole.evidenceReference) {
      existingPothole.evidenceReference = incomingEvidence;
    }
  }

  const updatedDoc = await existingPothole.save();
  console.log(`[DeduplicationService] Updated existing pothole ${updatedDoc.potholeId}: count=${updatedDoc.detectionCount}, buses=[${updatedDoc.busesDetectedBy.join(', ')}]`);
  return updatedDoc;
}

/**
 * Core entry point: Ingests a candidate, searches for an existing pothole within radius,
 * and either updates the existing record (deduplication) or creates a new one.
 * 
 * @param {object} candidate - Raw candidate object
 * @param {number} [customRadius] - Optional custom radius in meters
 * @returns {Promise<object>} Result metadata and Mongoose document
 */
export async function createOrUpdatePothole(candidate, customRadius) {
  // Validate candidate using existing Phase 9 validator
  const validation = potholeService.validateCandidate(candidate);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.status = 400;
    throw err;
  }

  const { sanitized } = validation;
  const radius = (typeof customRadius === 'number' && customRadius > 0)
    ? customRadius
    : getDedupRadiusMeters();

  // Search for an existing pothole within radius
  const nearbyMatch = await findNearbyPothole(sanitized.latitude, sanitized.longitude, radius);

  if (nearbyMatch) {
    // Found existing physical pothole -> Deduplicate & update
    const updatePayload = { ...candidate, ...sanitized };
    const updatedPothole = await updateExistingPothole(nearbyMatch.pothole, updatePayload);
    return {
      success: true,
      created: false,
      updated: true,
      deduplicated: true,
      matchedPotholeId: updatedPothole.potholeId,
      distanceMeters: nearbyMatch.distanceMeters,
      radiusMeters: radius,
      pothole: updatedPothole
    };
  }

  // Outside threshold -> Create new pothole using Phase 9 logic
  const createdPothole = await potholeService.createFromCandidate(candidate);
  return {
    success: true,
    created: true,
    updated: false,
    deduplicated: false,
    matchedPotholeId: null,
    distanceMeters: null,
    radiusMeters: radius,
    pothole: createdPothole
  };
}
