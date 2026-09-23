import { matchDetectionToGps } from '../utils/gpsMatcher.js';
import * as potholeDeduplicationService from './potholeDeduplicationService.js';
import Pothole from '../models/Pothole.js';

/**
 * Live Detection & GPS Association Service (Phase 15)
 * ===================================================
 * Processes incoming live detections from YOLO11n, validates the payload,
 * associates with recent in-memory phone GPS telemetry within MAX_GPS_TIME_DELTA_MS,
 * enforces an in-memory duplicate debounce cooldown (LIVE_DETECTION_COOLDOWN_MS),
 * and routes qualifying candidates through geographical deduplication into MongoDB.
 */

// In-memory cooldown tracking (potholeId -> epoch ms)
const potholeCooldownMap = new Map();

// Recent candidate location buffer for sub-millisecond race guard
let recentDetectionCache = null;

/**
 * Gets configured cooldown in milliseconds (default: 1000ms).
 */
export function getLiveDetectionCooldownMs() {
  const envVal = process.env.LIVE_DETECTION_COOLDOWN_MS;
  if (envVal !== undefined && envVal !== null && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 1000; // Default 1 second cooldown
}

/**
 * Resets the in-memory cooldown state (primarily for automated testing).
 */
export function resetLiveDetectionCooldown() {
  potholeCooldownMap.clear();
  recentDetectionCache = null;
}

/**
 * Validates GPS coordinate values.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number|null} acc - Accuracy
 * @returns {boolean} True if coordinates are valid
 */
export function validateGpsCoordinates(lat, lng, acc) {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return false;
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return false;
  }
  if (acc !== null && acc !== undefined && (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0)) {
    return false;
  }
  return true;
}

/**
 * Processes a live YOLO detection event.
 * 
 * @param {object} detection - Live detection payload from YOLO
 * @param {Array<object>} gpsHistory - In-memory rolling GPS history buffer
 * @param {object} [options] - Optional overrides (e.g., custom cooldown or delta)
 * @returns {Promise<object>} Processing outcome
 */
export async function processLiveDetection(detection, gpsHistory = [], options = {}) {
  if (!detection || typeof detection !== 'object') {
    return {
      success: false,
      gpsMatched: false,
      reason: 'Invalid request body. Expected detection object.'
    };
  }

  // 1. Class filter: ONLY process 'pothole'
  const className = (detection.className || detection.type || '').trim().toLowerCase();
  if (className !== 'pothole') {
    return {
      success: false,
      gpsMatched: false,
      ignored: true,
      reason: `Ignored class '${detection.className || detection.type}'. Only 'pothole' class is processed.`
    };
  }

  // 2. Confidence validation (threshold: 0.35)
  const minConf = options.minConfidence !== undefined ? options.minConfidence : 0.35;
  const conf = typeof detection.confidence === 'string' ? parseFloat(detection.confidence) : detection.confidence;
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < minConf || conf > 1.0) {
    return {
      success: false,
      gpsMatched: false,
      reason: `Confidence ${conf} below threshold ${minConf} or invalid.`
    };
  }

  // 3. Determine detection timestamp (must be absolute for live mode)
  const now = Date.now();
  let detectionTimestamp = detection.timestamp;
  if (!detectionTimestamp) {
    detectionTimestamp = new Date(now).toISOString();
  }

  // 4. GPS Association using existing gpsMatcher
  const maxDeltaMs = options.maxGpsDeltaMs !== undefined
    ? options.maxGpsDeltaMs
    : parseInt(process.env.MAX_GPS_TIME_DELTA_MS || '2000', 10);

  const matchResult = matchDetectionToGps({
    detectionTime: detectionTimestamp,
    gpsSamples: gpsHistory,
    maxDeltaMs
  });

  if (!matchResult.matched || !matchResult.matchedGps) {
    return {
      success: false,
      gpsMatched: false,
      reason: matchResult.reason || 'No GPS sample within allowed time difference'
    };
  }

  const matchedGps = matchResult.matchedGps;
  const lat = matchedGps.latitude;
  const lng = matchedGps.longitude;
  const acc = matchedGps.accuracy ?? null;

  // Validate GPS coordinates
  if (!validateGpsCoordinates(lat, lng, acc)) {
    return {
      success: false,
      gpsMatched: false,
      reason: 'Malformed or out-of-range GPS coordinates in matched sample.'
    };
  }

  const cooldownMs = options.cooldownMs !== undefined ? options.cooldownMs : getLiveDetectionCooldownMs();
  const dedupRadius = potholeDeduplicationService.getDedupRadiusMeters(); // Standard 10m

  // 5. In-Memory Cooldown / Debounce Check
  // Check if a nearby pothole exists in MongoDB
  const nearbyMatch = await potholeDeduplicationService.findNearbyPothole(lat, lng, dedupRadius);

  if (nearbyMatch && nearbyMatch.pothole) {
    const existingId = nearbyMatch.pothole.potholeId;
    const lastTime = potholeCooldownMap.get(existingId) || 0;
    if (now - lastTime < cooldownMs) {
      return {
        success: false,
        gpsMatched: true,
        throttled: true,
        cooldownActive: true,
        potholeId: existingId,
        reason: `Detection suppressed: pothole ${existingId} detected within cooldown window (${cooldownMs}ms)`
      };
    }
  } else if (recentDetectionCache && (now - recentDetectionCache.time < cooldownMs)) {
    // Check if within 10m of a pothole created milliseconds ago that is still in recent memory cache
    const dist = potholeDeduplicationService.haversineDistanceMeters(
      lat, lng,
      recentDetectionCache.latitude, recentDetectionCache.longitude
    );
    if (dist <= dedupRadius) {
      return {
        success: false,
        gpsMatched: true,
        throttled: true,
        cooldownActive: true,
        potholeId: recentDetectionCache.potholeId,
        reason: `Detection suppressed: nearby pothole ${recentDetectionCache.potholeId} detected within cooldown window (${cooldownMs}ms)`
      };
    }
  }

  // 6. Build Candidate Object for Deduplication & Persistence
  const busId = (detection.busId || detection.bus || 'RAAHI-01').trim() || 'RAAHI-01';
  const candidate = {
    type: 'pothole',
    confidence: Math.round(conf * 100) / 100,
    gpsTimestamp: matchedGps.timestamp || detectionTimestamp,
    location: {
      latitude: lat,
      longitude: lng,
      accuracy: acc !== null ? Math.round(acc * 10) / 10 : null
    },
    latitude: lat,
    longitude: lng,
    accuracy: acc !== null ? Math.round(acc * 10) / 10 : null,
    bus: busId
  };

  // 7. Route through geographical deduplication service (10m radius)
  const result = await potholeDeduplicationService.createOrUpdatePothole(candidate, dedupRadius);

  const targetPotholeId = result.pothole?.potholeId || result.matchedPotholeId;
  const currentTimestamp = Date.now();

  // Update in-memory cooldown timestamp
  if (targetPotholeId) {
    potholeCooldownMap.set(targetPotholeId, currentTimestamp);
    recentDetectionCache = {
      potholeId: targetPotholeId,
      latitude: lat,
      longitude: lng,
      time: currentTimestamp
    };
  }

  // 8. Return formatted response
  const existingVideoUrl = result.pothole?.videoUrl;
  const hasVideo = !!(existingVideoUrl && typeof existingVideoUrl === 'string' && existingVideoUrl.trim().length > 0);

  if (result.deduplicated) {
    return {
      success: true,
      gpsMatched: true,
      deduplicated: true,
      potholeId: targetPotholeId,
      detectionCount: result.pothole.detectionCount,
      distanceMeters: result.distanceMeters !== null ? result.distanceMeters : 0,
      hasVideo,
      requiresEvidence: !hasVideo,
      videoUrl: hasVideo ? existingVideoUrl.trim() : ''
    };
  }

  return {
    success: true,
    gpsMatched: true,
    deduplicated: false,
    created: true,
    potholeId: targetPotholeId,
    hasVideo: false,
    requiresEvidence: true,
    videoUrl: ''
  };
}
