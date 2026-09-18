import TrafficIncident from '../models/TrafficIncident.js';
import { haversineDistanceMeters } from './potholeDeduplicationService.js';

const DEFAULT_TRAFFIC_SPATIAL_RADIUS_METERS = 50.0;
const DEFAULT_TRAFFIC_TEMPORAL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generates the next sequential traffic incident identifier (e.g. TRF-INC-000001).
 */
export async function getNextTrafficIncidentId() {
  const existingRecords = await TrafficIncident.find(
    { incidentId: /^TRF-INC-\d+$/ },
    { incidentId: 1 }
  ).lean();

  let maxNum = 0;
  for (const record of existingRecords) {
    const match = (record.incidentId || '').match(/^TRF-INC-(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(6, '0');
  return `TRF-INC-${padded}`;
}

/**
 * Searches for an existing active traffic incident within spatial and temporal thresholds.
 */
export async function findNearbyTrafficIncident(latitude, longitude, timestamp, radiusMeters = DEFAULT_TRAFFIC_SPATIAL_RADIUS_METERS) {
  const targetTime = timestamp ? new Date(timestamp).getTime() : Date.now();
  const windowStart = new Date(targetTime - DEFAULT_TRAFFIC_TEMPORAL_WINDOW_MS);

  const activeIncidents = await TrafficIncident.find({
    status: 'active',
    lastDetectedAt: { $gte: windowStart },
    'location.latitude': { $exists: true, $ne: null },
    'location.longitude': { $exists: true, $ne: null }
  });

  let closestMatch = null;
  let minDistance = Infinity;

  for (const doc of activeIncidents) {
    const lat = doc.location?.latitude;
    const lng = doc.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const dist = haversineDistanceMeters(latitude, longitude, lat, lng);
    if (dist <= radiusMeters && dist < minDistance) {
      minDistance = dist;
      closestMatch = {
        incident: doc,
        distanceMeters: dist
      };
    }
  }

  return closestMatch;
}

/**
 * Ingests a candidate traffic event and correlates it into MongoDB TrafficIncident collection.
 */
export async function createOrUpdateTrafficIncident(candidate) {
  const lat = candidate.location?.latitude;
  const lng = candidate.location?.longitude;
  const acc = candidate.location?.accuracy;
  const ts = candidate.timestamp ? new Date(candidate.timestamp) : new Date();
  const busId = (candidate.busId || 'RAAHI-001').trim();
  const edgeEventId = candidate.edgeEventId || candidate.candidateId;

  const telemetry = candidate.trafficTelemetry || {};
  const activeVehicles = telemetry.activeVehicles || 0;
  const vehiclesInRoi = telemetry.vehiclesInRoi || 0;
  const occupancyRatio = telemetry.occupancyRatio || 0.0;
  const flowVpm = telemetry.flowVpm || 0.0;
  const trafficState = telemetry.trafficState || 'CONGESTED';

  // 1. Search for matching nearby active incident
  const match = await findNearbyTrafficIncident(lat, lng, ts);

  if (match) {
    // 2. Correlate with existing incident
    const incident = match.incident;
    incident.detectionCount = (incident.detectionCount || 1) + 1;
    incident.lastDetectedAt = ts;

    if (!Array.isArray(incident.busesReportedBy)) {
      incident.busesReportedBy = [];
    }
    if (!incident.busesReportedBy.includes(busId)) {
      incident.busesReportedBy.push(busId);
    }

    if (!Array.isArray(incident.edgeEventIds)) {
      incident.edgeEventIds = [];
    }
    if (edgeEventId && !incident.edgeEventIds.includes(edgeEventId)) {
      incident.edgeEventIds.push(edgeEventId);
    }

    // Update metrics to latest
    incident.metrics = {
      activeVehicles,
      vehiclesInRoi,
      occupancyRatio,
      flowVpm
    };
    incident.trafficState = trafficState;

    // Multi-bus correlation elevates severity
    if (incident.busesReportedBy.length >= 2) {
      incident.severity = 'critical';
    } else if (occupancyRatio > 0.6) {
      incident.severity = 'high';
    } else {
      incident.severity = 'medium';
    }

    const saved = await incident.save();
    console.log(`[TrafficIncidentService] Correlated event ${edgeEventId} into incident ${saved.incidentId} (buses: [${saved.busesReportedBy.join(', ')}], count: ${saved.detectionCount})`);
    return {
      success: true,
      action: 'correlated',
      incident: saved,
      distanceMeters: match.distanceMeters
    };
  }

  // 3. Create new traffic incident
  const nextId = await getNextTrafficIncidentId();
  const severity = occupancyRatio > 0.6 ? 'high' : 'medium';

  const newIncident = new TrafficIncident({
    incidentId: nextId,
    edgeEventId,
    eventType: candidate.eventType || 'congestion',
    trafficState,
    severity,
    location: {
      latitude: lat,
      longitude: lng,
      accuracy: acc
    },
    firstDetectedAt: ts,
    lastDetectedAt: ts,
    detectionCount: 1,
    busesReportedBy: [busId],
    metrics: {
      activeVehicles,
      vehiclesInRoi,
      occupancyRatio,
      flowVpm
    },
    status: 'active',
    edgeEventIds: edgeEventId ? [edgeEventId] : [],
    evidenceReference: candidate.evidenceReference || '',
    videoUrl: candidate.videoUrl || ''
  });

  const saved = await newIncident.save();
  console.log(`[TrafficIncidentService] Created new traffic incident ${saved.incidentId} from event ${edgeEventId} (Bus: ${busId})`);
  return {
    success: true,
    action: 'created',
    incident: saved
  };
}
