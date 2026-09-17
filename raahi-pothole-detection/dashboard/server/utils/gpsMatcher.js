/**
 * RAAHI GPS & YOLO Detection Association Utility
 * ===============================================
 * Associates YOLO bounding box detections with geographic GPS coordinates
 * using time-series interpolation and nearest-neighbor timestamp matching.
 */

/**
 * Parses a video-relative timestamp (e.g., "00:03.36", "01:24.50", or numeric seconds)
 * into total seconds from video start.
 * 
 * @param {string|number} timeStr - Timestamp formatted as "MM:SS.ss" or seconds number
 * @returns {number} Time in seconds
 */
export function parseVideoTimestampToSeconds(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr || typeof timeStr !== 'string') return 0;

  const parts = timeStr.trim().split(':');
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  if (parts.length === 3) {
    const hrs = parseFloat(parts[0]) || 0;
    const mins = parseFloat(parts[1]) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hrs * 3600 + mins * 60 + secs;
  }
  return parseFloat(timeStr) || 0;
}

/**
 * Parses any timestamp representation into Unix Epoch Milliseconds.
 * Supports:
 * - ISO 8601 strings (e.g., "2026-09-12T10:00:00.000Z")
 * - Date objects
 * - Numeric epoch ms (e.g., 1789207200000)
 * - Video-relative seconds offset when relativeBaseMs is provided
 *
 * @param {string|number|Date} ts
 * @param {number} [relativeBaseMs] - Optional base epoch ms for relative timestamps
 * @returns {number|null} Epoch milliseconds or null if unparseable
 */
export function toEpochMs(ts, relativeBaseMs = null) {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') {
    // If < 1e11, likely seconds instead of ms
    return ts < 1e11 ? Math.round(ts * 1000) : ts;
  }
  if (typeof ts === 'string') {
    // Check if relative format "MM:SS.ss"
    if (ts.includes(':') && !ts.includes('T')) {
      const relSec = parseVideoTimestampToSeconds(ts);
      if (relativeBaseMs !== null) {
        return relativeBaseMs + Math.round(relSec * 1000);
      }
      return Math.round(relSec * 1000); // Relative ms from 0
    }
    const parsed = Date.parse(ts);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Rates the reliability of a GPS measurement based on its horizontal accuracy radius.
 * 
 * @param {number|null} accuracy - Horizontal accuracy in metres (radius of 68% confidence)
 * @returns {object} Rating tier, description, and reliability weight
 */
export function evaluateGpsAccuracy(accuracy) {
  if (accuracy === null || accuracy === undefined || isNaN(accuracy)) {
    return {
      tier: 'unknown',
      score: 0.5,
      label: 'Unknown Accuracy',
      usable: true
    };
  }

  const acc = Math.abs(accuracy);
  if (acc <= 5) {
    return {
      tier: 'excellent',
      score: 1.0,
      label: `High Precision (±${acc}m)`,
      usable: true
    };
  } else if (acc <= 15) {
    return {
      tier: 'good',
      score: 0.85,
      label: `Good Precision (±${acc}m)`,
      usable: true
    };
  } else if (acc <= 35) {
    return {
      tier: 'moderate',
      score: 0.65,
      label: `Moderate Precision (±${acc}m)`,
      usable: true
    };
  } else {
    return {
      tier: 'degraded',
      score: 0.3,
      label: `Degraded / High Drift (±${acc}m)`,
      usable: false
    };
  }
}

/**
 * Finds the nearest GPS coordinate sample to a given detection time.
 * 
 * Supports two timing modes:
 * 1. Absolute Matching: Detection relative time + videoStartTime compared against UTC GPS samples.
 * 2. Relative Matching: Detection relative time (e.g. "00:03.36") compared against relative GPS samples.
 * 
 * @param {object} params
 * @param {string|number} params.detectionTime - "MM:SS.ss" or relative seconds, or epoch ms
 * @param {Array<object>} params.gpsSamples - List of { latitude, longitude, accuracy, timestamp }
 * @param {string|number} [params.videoStartTime] - Optional absolute UTC start time of the video clip
 * @param {number} [params.maxDeltaMs=5000] - Max allowable time delta before marking GPS as stale (default 5000ms)
 * 
 * @returns {object|null} Matched candidate metadata
 */
export function matchDetectionToGps({
  detectionTime,
  gpsSamples = [],
  videoStartTime = null,
  maxDeltaMs = 2000
}) {
  if (!gpsSamples || gpsSamples.length === 0) {
    return {
      matched: false,
      reason: 'No GPS samples available in session history buffer'
    };
  }

  // Determine target detection time in milliseconds
  let targetMs = null;
  let detectionTimestampIso = null;
  const isRelativeDetection = (typeof detectionTime === 'string' && detectionTime.includes(':') && !detectionTime.includes('T')) || (typeof detectionTime === 'number' && detectionTime < 1e7);

  if (isRelativeDetection) {
    const relSec = parseVideoTimestampToSeconds(detectionTime);
    if (videoStartTime) {
      const baseMs = toEpochMs(videoStartTime);
      if (baseMs === null) {
        return {
          matched: false,
          reason: `Invalid videoStartTime: ${videoStartTime}`
        };
      }
      targetMs = baseMs + Math.round(relSec * 1000);
      detectionTimestampIso = new Date(targetMs).toISOString();
    } else {
      targetMs = Math.round(relSec * 1000);
      detectionTimestampIso = null; // No absolute time available without videoStartTime
    }
  } else {
    targetMs = toEpochMs(detectionTime);
    if (targetMs !== null) {
      detectionTimestampIso = new Date(targetMs).toISOString();
    }
  }

  if (targetMs === null) {
    return {
      matched: false,
      reason: `Could not parse detection time: ${detectionTime}`
    };
  }

  // Find sample with minimum |gpsTimeMs - targetMs|
  let bestSample = null;
  let minDelta = Infinity;

  for (const sample of gpsSamples) {
    let sampleMs = toEpochMs(sample.timestamp);
    if (sampleMs === null) continue;

    const delta = Math.abs(sampleMs - targetMs);
    if (delta < minDelta) {
      minDelta = delta;
      bestSample = sample;
    }
  }

  if (!bestSample) {
    return {
      matched: false,
      reason: 'Could not match with any valid GPS sample in history'
    };
  }

  const accuracyEval = evaluateGpsAccuracy(bestSample.accuracy);
  const exceedsSafetyWindow = minDelta > maxDeltaMs;

  if (exceedsSafetyWindow) {
    return {
      matched: false,
      reason: `No GPS sample within allowed time window. Closest sample was ${minDelta}ms away (max allowed threshold: ${maxDeltaMs}ms).`,
      timeDeltaMs: minDelta,
      maxDeltaMs,
      detectionTimestamp: detectionTimestampIso,
      closestSample: {
        latitude: bestSample.latitude,
        longitude: bestSample.longitude,
        accuracy: bestSample.accuracy ?? null,
        timestamp: bestSample.timestamp
      }
    };
  }

  return {
    matched: true,
    detectionTimestamp: detectionTimestampIso,
    gpsTimestamp: bestSample.timestamp,
    timeDeltaMs: minDelta,
    timeDeltaSec: Math.round((minDelta / 1000) * 100) / 100,
    location: {
      latitude: bestSample.latitude,
      longitude: bestSample.longitude,
      accuracy: bestSample.accuracy ?? null
    },
    matchedGps: {
      latitude: bestSample.latitude,
      longitude: bestSample.longitude,
      accuracy: bestSample.accuracy ?? null,
      timestamp: bestSample.timestamp
    },
    accuracyEvaluation: accuracyEval,
    quality: (minDelta <= 500 && accuracyEval.usable) ? 'high' : 'medium'
  };
}

/**
 * Constructs a Pothole Incident Candidate data structure.
 * This is an ephemeral object (NOT automatically saved to MongoDB yet).
 * 
 * @param {object} detection - YOLO detection object from detections.json
 * @param {object} matchResult - Output from matchDetectionToGps
 * @param {string} [busId="RAAHI-01"] - Bus identifier
 * @returns {object} Pothole incident candidate object
 */
export function createPotholeCandidate(detection, matchResult, busId = 'RAAHI-01') {
  const gps = matchResult.matchedGps || {};
  return {
    candidateType: 'pothole_incident_candidate',
    status: 'provisional', // Provisional until deduplication & verification
    detectionId: detection.id,
    type: detection.type || 'pothole',
    confidence: detection.confidence,
    frame: detection.frame,
    videoTimestamp: detection.timestamp,
    bbox: detection.bbox,
    location: {
      latitude: gps.latitude ?? null,
      longitude: gps.longitude ?? null,
      accuracy: gps.accuracy ?? null
    },
    gpsTimestamp: gps.timestamp ?? null,
    timeDeltaMs: matchResult.timeDeltaMs ?? null,
    syncQuality: matchResult.quality || 'unknown',
    accuracyEvaluation: matchResult.accuracyEvaluation || null,
    bus: busId,
    generatedAt: new Date().toISOString()
  };
}
