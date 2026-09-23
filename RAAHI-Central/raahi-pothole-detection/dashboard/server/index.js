import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { connectDB, isDbConnected, getDbInfo } from './db.js';
import Pothole from './models/Pothole.js';
import { matchDetectionToGps, createPotholeCandidate, evaluateGpsAccuracy } from './utils/gpsMatcher.js';
import * as potholeService from './services/potholeService.js';
import * as potholeDeduplicationService from './services/potholeDeduplicationService.js';
import * as geocodingService from './services/geocodingService.js';
import * as videoEvidenceService from './services/videoEvidenceService.js';
import * as googleDriveService from './services/googleDriveService.js';
import * as liveDetectionService from './services/liveDetectionService.js';
import * as liveEvidenceService from './services/liveEvidenceService.js';
import * as centralEventService from './services/centralEventService.js';
import * as centralEventPromotionService from './services/centralEventPromotionService.js';
import http from 'http';
import CandidateEvent from './models/CandidateEvent.js';
import TrafficIncident from './models/TrafficIncident.js';
import * as trafficIncidentService from './services/trafficIncidentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from dashboard/.env or project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();

// Paths to project artifacts
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ANNOTATED_VIDEO_PATH = path.join(PROJECT_ROOT, 'videos/output/annotated_potholes.mp4');
const INPUT_VIDEO_PATH = path.join(PROJECT_ROOT, 'videos/input/cityRoad_potHoles-side.mp4');
const MODEL_WEIGHTS_PATH = path.join(PROJECT_ROOT, 'runs/detect/runs/pothole_yolo11n/weights/best.pt');
const RESULTS_DETECTIONS_PATH = path.join(PROJECT_ROOT, 'results/detections.json');
const RESULTS_SUMMARY_PATH = path.join(PROJECT_ROOT, 'results/summary.json');

app.use(cors());
app.use(express.json());
app.use('/evidence', express.static(path.join(PROJECT_ROOT, 'videos/evidence')));

// In-memory active fleet registry for connected Edge devices
const activeFleet = new Map();

// In-memory store for latest phone GPS position (Phase 7 prototype)
let latestGps = null;

// Temporary in-memory GPS session history buffer (Phase: Session History)
// NOTE: This is temporary in-memory session data, NOT permanent MongoDB storage.
const MAX_GPS_HISTORY = parseInt(process.env.MAX_GPS_HISTORY || '1000', 10);
const MAX_GPS_TIME_DELTA_MS = parseInt(process.env.MAX_GPS_TIME_DELTA_MS || '2000', 10);
const gpsHistory = [];

// Dynamic loader for actual YOLO detection results
function loadDetectionsData() {
  let detections = [];
  let summary = {
    totalDetections: 0,
    potholeDetections: 0,
    framesProcessed: 608,
    videoFps: 25.0,
    videoDuration: 24.32,
    model: "YOLO11n",
    video: "cityRoad_potHoles-side.mp4"
  };

  if (fs.existsSync(RESULTS_DETECTIONS_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(RESULTS_DETECTIONS_PATH, 'utf-8'));
      if (Array.isArray(raw)) {
        detections = raw;
      } else if (raw && Array.isArray(raw.detections)) {
        detections = raw.detections;
        if (raw.summary) {
          summary = { ...summary, ...raw.summary };
        }
      }
    } catch (err) {
      console.error('Warning: Could not parse results/detections.json:', err.message);
    }
  }

  if (fs.existsSync(RESULTS_SUMMARY_PATH)) {
    try {
      const rawSummary = JSON.parse(fs.readFileSync(RESULTS_SUMMARY_PATH, 'utf-8'));
      summary = { ...summary, ...rawSummary };
    } catch (err) {
      console.error('Warning: Could not parse results/summary.json:', err.message);
    }
  }

  if (!summary.totalDetections) {
    summary.totalDetections = detections.length;
  }
  if (!summary.potholeDetections) {
    summary.potholeDetections = detections.filter(d => (d.type || '').toLowerCase().includes('pothole')).length;
  }

  return { detections, summary };
}

// ==============================================================
// CANONICAL CENTRAL EVENT INGESTION & CANDIDATE APIS (PHASE 2)
// ==============================================================
/**
 * POST /api/central/events
 * Canonical Central ingestion endpoint.
 * Accepts Edge Event Package from RAAHI-Edge, validates fields,
 * normalizes payload, enforces idempotency, and stores Candidate Event
 * in the 'candidate_events' collection with verificationStatus = 'unverified'.
 * 
 * ARCHITECTURAL CONSTRAINTS:
 * - Creates CandidateEvent, NOT authoritative Pothole.
 * - NO real-time camera inference.
 * - NO Central-side GPS timestamp matching.
 * - GPS coordinates are accepted directly from Edge.
 */
app.post('/api/central/events', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: "Database not connected",
        message: "MongoDB connection is not active. Central cannot ingest events without database."
      });
    }

    const result = await centralEventService.ingestCandidateEvent(req.body);

    if (req.body && (req.body.busId || req.body.bus)) {
      const bId = (req.body.busId || req.body.bus).trim();
      const loc = req.body.location || req.body.gps || {};
      const bLat = req.body.latitude !== undefined ? parseFloat(req.body.latitude) : parseFloat(loc.latitude);
      const bLng = req.body.longitude !== undefined ? parseFloat(req.body.longitude) : parseFloat(loc.longitude);
      if (!isNaN(bLat) && !isNaN(bLng)) {
        activeFleet.set(bId, {
          id: bId,
          route: 'Active Route',
          lat: bLat,
          lng: bLng,
          speed: 0,
          status: 'online',
          camera: true,
          lastSeen: 'Now',
          updatedAt: Date.now()
        });
      }
    }
    const statusCode = result.duplicate ? 200 : 201;
    return res.status(statusCode).json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status !== 500) {
      return res.status(status).json({
        success: false,
        error: "Validation Error",
        message: err.message
      });
    }
    console.error('[CentralEvents] Error ingesting event package:', err);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: err.message || "Failed to ingest event package"
    });
  }
});

// GET /api/central/candidates - List candidate events with optional filters (Phase 2)

/**
 * POST /api/central/evidence/upload
 * Canonical Central Evidence Upload endpoint.
 * Accepts raw binary MP4 video data from RAAHI-Edge, stages locally,
 * uploads to Google Drive (if authenticated), and attaches to CandidateEvent/Pothole/TrafficIncident.
 */
app.post('/api/central/evidence/upload', express.raw({ limit: '100mb', type: ['video/mp4', 'application/octet-stream'] }), async (req, res) => {
  try {
    const eventId = req.headers['x-event-id'] || req.query.eventId;
    const rawFileName = req.headers['x-file-name'] || req.query.fileName;
    const fileName = (rawFileName ? path.basename(rawFileName) : `${eventId || Date.now()}_evidence.mp4`);

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing file body',
        message: 'No binary video data received in request body.'
      });
    }

    const evidenceDir = path.join(PROJECT_ROOT, 'videos/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const targetPath = path.join(evidenceDir, fileName);
    fs.writeFileSync(targetPath, req.body);
    console.log(`[CentralEvidence] Saved evidence clip for ${eventId} (${req.body.length} bytes) to ${targetPath}`);

    let driveResult = null;
    let driveUrl = null;
    let driveFileId = null;

    if (googleDriveService.isAuthenticated()) {
      try {
        driveResult = await googleDriveService.uploadEvidenceClip({
          filePath: targetPath,
          fileName,
          mimeType: 'video/mp4',
          makePublic: true
        });
        driveUrl = driveResult.url;
        driveFileId = driveResult.fileId;
        console.log(`[CentralEvidence] Evidence uploaded to Google Drive: ${driveUrl}`);
      } catch (driveErr) {
        console.warn(`[CentralEvidence] Google Drive upload failed (clip staged locally): ${driveErr.message}`);
      }
    } else {
      console.log(`[CentralEvidence] Google Drive not authenticated; clip staged locally.`);
    }

    const localServeUrl = `/evidence/${fileName}`;
    const authoritativeUrl = driveUrl || localServeUrl;

    if (eventId && isDbConnected()) {
      try {
        await CandidateEvent.updateMany(
          { $or: [{ edgeEventId: eventId }, { candidateId: eventId }] },
          {
            $set: {
              evidenceReference: fileName,
              videoUrl: authoritativeUrl,
              driveFileId: driveFileId,
              driveWebViewLink: driveUrl
            }
          }
        );

        await Pothole.updateMany(
          { edgeEventId: eventId },
          {
            $set: {
              evidenceReference: fileName,
              videoUrl: authoritativeUrl,
              driveFileId: driveFileId,
              driveWebViewLink: driveUrl
            }
          }
        );

        await TrafficIncident.updateMany(
          { $or: [{ edgeEventId: eventId }, { edgeEventIds: eventId }] },
          {
            $set: {
              evidenceReference: fileName,
              videoUrl: authoritativeUrl,
              driveFileId: driveFileId,
              driveWebViewLink: driveUrl
            }
          }
        );
      } catch (dbErr) {
        console.warn(`[CentralEvidence] DB update warning: ${dbErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      eventId,
      fileName,
      sizeBytes: req.body.length,
      localUrl: localServeUrl,
      driveUrl: driveUrl,
      driveFileId: driveFileId,
      message: 'Evidence clip staged and linked successfully.'
    });
  } catch (err) {
    console.error('[CentralEvidence] Error uploading evidence clip:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: err.message || 'Failed to process evidence clip'
    });
  }
});

app.get('/api/central/candidates', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: "Database not connected",
        message: "MongoDB connection is not active."
      });
    }

    const { verificationStatus, busId, eventType, limit, sort } = req.query;
    const result = await centralEventService.getCandidateEvents({
      verificationStatus,
      busId,
      eventType,
      limit,
      sort
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[CentralCandidates] Error fetching candidate events:', err);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: err.message
    });
  }
});

// GET /api/central/candidates/:candidateId - Retrieve single candidate event (Phase 2)
app.get('/api/central/candidates/:candidateId', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: "Database not connected",
        message: "MongoDB connection is not active."
      });
    }

    const { candidateId } = req.params;
    const candidate = await centralEventService.getCandidateById(candidateId);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: "Not Found",
        message: `Candidate event '${candidateId}' not found.`
      });
    }

    return res.status(200).json({
      success: true,
      candidate
    });
  } catch (err) {
    console.error(`[CentralCandidates] Error fetching candidate ${req.params.candidateId}:`, err);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: err.message
    });
  }
});

// ==============================================================
// CENTRAL EVENT PROMOTION & CROSS-BUS FUSION
// ==============================================================
/**
 * POST /api/central/candidates/:candidateId/promote
 * Bridges candidate events directly to authoritative Pothole records
 * via the existing 10m geospatial deduplication engine.
 * 
 * STRICT ARCHITECTURAL CONSTRAINTS:
 * - Refuses unsupported classifications
 * - Idempotent: repeated calls do NOT create duplicate Pothole records
 * - Preserves authoritative Edge GPS, busId, Edge class, and Edge confidence
 * - Reuses existing 10m Haversine deduplication algorithm
 */
app.post('/api/central/candidates/:candidateId/promote', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: "Database not connected",
        message: "MongoDB connection is not active. Central cannot promote candidates without database."
      });
    }

    const { candidateId } = req.params;
    const options = req.body || {};

    const result = await centralEventPromotionService.promoteCandidate(candidateId, options);
    const statusCode = result.action === 'created' ? 201 : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status !== 500) {
      return res.status(status).json({
        success: false,
        error: err.code || err.name || "Promotion Error",
        message: err.message
      });
    }
    console.error(`[CentralPromotion] Error promoting candidate ${req.params.candidateId}:`, err);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message: err.message || "Candidate promotion failed unexpectedly"
    });
  }
});

// ==========================================
// 1. GET /api/status - Current System Status
// ==========================================
app.get('/api/status', (req, res) => {
  const { detections, summary } = loadDetectionsData();
  const videoExists = fs.existsSync(ANNOTATED_VIDEO_PATH);
  const inputExists = fs.existsSync(INPUT_VIDEO_PATH);
  const modelExists = fs.existsSync(MODEL_WEIGHTS_PATH);

  res.json({
    detectionSystem: "Online",
    model: "YOLO11n",
    video: "cityRoad_potHoles-side.mp4",
    frames: summary.framesProcessed || 608,
    detections: summary.totalDetections || detections.length,
    potholeDetections: summary.potholeDetections || summary.totalDetections || detections.length,
    system: "Online",
    fps: summary.videoFps || 25.0,
    resolution: "640x360",
    durationSeconds: summary.videoDuration || 24.32,
    confidenceThreshold: 0.35,
    inferenceDevice: "Apple Silicon MPS",
    annotatedVideoReady: videoExists,
    inputVideoReady: inputExists,
    modelReady: modelExists,
    gpsStatus: (latestGps && latestGps.connected)
      ? `GPS: Connected (${latestGps.latitude.toFixed(4)}, ${latestGps.longitude.toFixed(4)})`
      : "GPS: Not connected",
    gpsConnected: Boolean(latestGps && latestGps.connected),
    latestGps: latestGps ? {
      latitude: latestGps.latitude,
      longitude: latestGps.longitude,
      accuracy: latestGps.accuracy,
      timestamp: latestGps.timestamp
    } : null,
    fleetStatus: "DEMO (12 Simulated Connected Buses)",
    database: getDbInfo(),
    classes: [
      "Drain Hole",
      "circle-drain-clean-",
      "drain-clean-",
      "drain-not clean-",
      "hole",
      "manhole",
      "pothole",
      "sewer cover"
    ],
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 2. GET /api/detections - Real Detections
// ==========================================
app.get('/api/detections', (req, res) => {
  const { detections, summary } = loadDetectionsData();
  const { type, minConfidence, severity, limit } = req.query;

  // Map each real detection according to the required schema
  let items = detections.map(d => {
    const rawConf = typeof d.confidence === 'number' ? d.confidence : parseFloat(d.confidence);
    const displayConf = rawConf <= 1.0 ? Math.round(rawConf * 100) : Math.round(rawConf);
    const box = d.bbox || {};
    const boxWidth = (typeof box.x2 === 'number' && typeof box.x1 === 'number') ? (box.x2 - box.x1) : 0;
    const boxHeight = (typeof box.y2 === 'number' && typeof box.y1 === 'number') ? (box.y2 - box.y1) : 0;
    const sizeStr = (boxWidth > 0 && boxHeight > 0) ? `${boxWidth} × ${boxHeight} px` : "Detection box";

    return {
      id: d.id,
      type: d.type ? (d.type.charAt(0).toUpperCase() + d.type.slice(1)) : "Pothole",
      rawClass: d.type || "pothole",
      confidence: displayConf,
      confidenceScore: rawConf,
      frame: d.frame,
      timestamp: d.timestamp,
      time: `${d.timestamp} (Frame ${d.frame})`,
      bbox: d.bbox,
      size: sizeStr,
      severity: displayConf >= 75 ? "high" : displayConf >= 50 ? "medium" : "low",
      bus: "RAAHI-01",
      gps: "Not connected",
      gpsStatus: "GPS: Not connected",
      isDemoGps: false,
      status: "open",
      evidence: "/api/video",
      isReal: true,
      videoSource: "cityRoad_potHoles-side.mp4"
    };
  });

  if (type) {
    items = items.filter(d => d.type.toLowerCase() === type.toLowerCase() || d.rawClass.toLowerCase() === type.toLowerCase());
  }
  if (minConfidence) {
    const minC = parseFloat(minConfidence);
    items = items.filter(d => d.confidence >= minC || d.confidenceScore >= minC);
  }
  if (severity) {
    items = items.filter(d => d.severity.toLowerCase() === severity.toLowerCase());
  }
  if (limit) {
    items = items.slice(0, parseInt(limit, 10));
  }

  res.json({
    summary: {
      video: "cityRoad_potHoles-side.mp4",
      model: "YOLO11n",
      totalFrames: summary.framesProcessed || 608,
      totalDetections: summary.totalDetections || detections.length,
      potholeDetections: summary.potholeDetections || summary.totalDetections || detections.length,
      returnedCount: items.length,
      confidenceThreshold: 0.35,
      isRealData: true,
      gpsMode: "GPS: Not connected"
    },
    detections: items
  });
});

// ==============================================================
// 3. GET /api/video - Annotated Video Stream
// [LEGACY / PROTOTYPE ENDPOINT - PRESERVED FOR BACKWARD COMPATIBILITY]
// ==============================================================
app.get('/api/video', (req, res) => {
  if (!fs.existsSync(ANNOTATED_VIDEO_PATH)) {
    return res.status(404).json({
      error: "Annotated video not found at videos/output/annotated_potholes.mp4"
    });
  }

  const stat = fs.statSync(ANNOTATED_VIDEO_PATH);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // HTTP 206 Partial Content for efficient seeking and streaming
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(ANNOTATED_VIDEO_PATH, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(ANNOTATED_VIDEO_PATH).pipe(res);
  }
});

// ==============================================================
// 4. Phone GPS Telemetry Endpoints (Phase 7)
// [LEGACY / PROTOTYPE ENDPOINT - PRESERVED FOR BACKWARD COMPATIBILITY]
// Note: Final architecture receives GPS directly inside the Edge Event Package.
// ==============================================================
// POST /api/gps - Receive GPS telemetry from phone or external device
app.post('/api/gps', (req, res) => {
  const { latitude, longitude, accuracy, timestamp } = req.body || {};

  const lat = typeof latitude === 'string' ? parseFloat(latitude) : latitude;
  const lng = typeof longitude === 'string' ? parseFloat(longitude) : longitude;
  const acc = (accuracy !== undefined && accuracy !== null)
    ? (typeof accuracy === 'string' ? parseFloat(accuracy) : accuracy)
    : null;

  // Validate that latitude and longitude are valid numbers
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({
      error: "Invalid coordinates. 'latitude' and 'longitude' must be valid finite numbers."
    });
  }

  // Reject obviously invalid coordinates
  if (lat < -90 || lat > 90) {
    return res.status(400).json({
      error: "Invalid latitude. Must be between -90 and 90 degrees."
    });
  }

  if (lng < -180 || lng > 180) {
    return res.status(400).json({
      error: "Invalid longitude. Must be between -180 and 180 degrees."
    });
  }

  const sample = {
    latitude: lat,
    longitude: lng,
    accuracy: (acc !== null && Number.isFinite(acc)) ? acc : null,
    timestamp: timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString()
  };

  latestGps = {
    connected: true,
    ...sample
  };

  // Update active fleet entry
  const busId = (req.body && req.body.busId) ? String(req.body.busId).trim() : 'RAAHI-01';
  activeFleet.set(busId, {
    id: busId,
    route: 'Active Route',
    lat,
    lng,
    accuracy: (acc !== null && Number.isFinite(acc)) ? acc : null,
    speed: req.body?.speed || 0,
    status: 'online',
    camera: true,
    lastSeen: 'Now',
    updatedAt: Date.now()
  });

  // Forward GPS telemetry to Edge server on port 5050
  try {
    const fwdReq = http.request({
      hostname: '127.0.0.1',
      port: 5050,
      path: '/api/gps',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 1000
    });
    fwdReq.on('error', () => {});
    fwdReq.write(JSON.stringify(req.body));
    fwdReq.end();
  } catch (fwdErr) {}

  // Append to temporary rolling session history buffer (Task 2 & 3)
  gpsHistory.push(sample);
  if (gpsHistory.length > MAX_GPS_HISTORY) {
    gpsHistory.shift(); // Evict oldest sample to maintain rolling window limit
  }

  res.status(200).json({
    status: "ok",
    message: "GPS telemetry updated successfully",
    data: latestGps,
    historyCount: gpsHistory.length
  });
});

// GET /api/gps - Query latest phone GPS position
app.get('/api/gps', (req, res) => {
  if (latestGps && latestGps.connected) {
    return res.json({
      connected: true,
      latitude: latestGps.latitude,
      longitude: latestGps.longitude,
      accuracy: latestGps.accuracy,
      timestamp: latestGps.timestamp
    });
  }
  res.json({
    connected: false
  });
});

// GET /api/gps/history - Query recent in-memory GPS session samples (Task 2)
app.get('/api/gps/history', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
  const samples = limit > 0 ? gpsHistory.slice(-limit) : gpsHistory;

  res.json({
    count: gpsHistory.length,
    bufferLimit: MAX_GPS_HISTORY,
    returnedCount: samples.length,
    samples
  });
});

// Live Phone Camera Stream Hook
app.get('/api/camera/live', (req, res) => {
  res.json({
    status: "idle",
    message: "Live phone camera endpoint ready for WebRTC/RTSP stream",
    fallbackToRecorded: true,
    activeFeed: "/api/video"
  });
});

// Mobile GPS Sender standalone page (for direct phone access on Express port)
app.get('/gps', (req, res) => {
  const gpsHtmlPath = path.join(__dirname, 'public/gps.html');
  if (fs.existsSync(gpsHtmlPath)) {
    res.sendFile(gpsHtmlPath);
  } else {
    res.redirect('/api/gps');
  }
});

// ==============================================================
// 5. GPS + YOLO Detection Association Endpoints (Phase Design)
// ==============================================================

// POST /api/dev/match-gps - Associate detection timestamp with nearest GPS sample
app.post('/api/dev/match-gps', (req, res) => {
  const { detection, gpsSamples, videoStartTime } = req.body || {};
  if (!detection) {
    return res.status(400).json({ error: "Missing 'detection' object in request body" });
  }
  if (!gpsSamples || !Array.isArray(gpsSamples)) {
    return res.status(400).json({ error: "Missing 'gpsSamples' array in request body" });
  }

  const matchResult = matchDetectionToGps({
    detectionTime: detection.timestamp || detection.time || 0,
    gpsSamples,
    videoStartTime
  });

  const candidate = createPotholeCandidate(detection, matchResult);

  res.json({
    success: true,
    matchResult,
    candidate
  });
});

// POST /api/dev/associate-detection - Match a detection against live in-memory GPS history
app.post('/api/dev/associate-detection', (req, res) => {
  const { detection, videoStartTime, maxDeltaMs } = req.body || {};

  if (!detection) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing 'detection' object in request body."
    });
  }

  if (!videoStartTime) {
    return res.status(400).json({
      error: "Bad Request",
      message: "Missing 'videoStartTime' (ISO 8601 UTC string). Required to anchor video-relative timestamps to absolute GPS time."
    });
  }

  const effectiveMaxDelta = (typeof maxDeltaMs === 'number' && maxDeltaMs > 0)
    ? maxDeltaMs
    : MAX_GPS_TIME_DELTA_MS;

  const matchResult = matchDetectionToGps({
    detectionTime: detection.timestamp || detection.time || 0,
    gpsSamples: gpsHistory,
    videoStartTime,
    maxDeltaMs: effectiveMaxDelta
  });

  if (!matchResult.matched) {
    return res.json({
      matched: false,
      reason: matchResult.reason,
      timeDeltaMs: matchResult.timeDeltaMs ?? null,
      maxDeltaMs: effectiveMaxDelta,
      detectionTimestamp: matchResult.detectionTimestamp ?? null,
      closestSample: matchResult.closestSample ?? null,
      totalGpsSamplesAvailable: gpsHistory.length
    });
  }

  const candidate = createPotholeCandidate(detection, matchResult);

  res.json({
    matched: true,
    detectionTimestamp: matchResult.detectionTimestamp,
    gpsTimestamp: matchResult.gpsTimestamp,
    timeDeltaMs: matchResult.timeDeltaMs,
    location: matchResult.location,
    accuracyEvaluation: matchResult.accuracyEvaluation,
    candidate,
    totalGpsSamplesAvailable: gpsHistory.length
  });
});

// POST /api/dev/create-pothole - Ingest pothole candidate with Geographical Deduplication (Phase 10)
app.post('/api/dev/create-pothole', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active. Start MongoDB server before creating records."
      });
    }

    const { candidate, radiusMeters } = req.body || {};
    if (!candidate) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing 'candidate' object in request body."
      });
    }

    const result = await potholeDeduplicationService.createOrUpdatePothole(candidate, radiusMeters);

    const statusCode = result.created ? 201 : 200;
    res.status(statusCode).json({
      success: true,
      created: result.created,
      updated: result.updated,
      deduplicated: result.deduplicated,
      matchedPotholeId: result.matchedPotholeId,
      distanceMeters: result.distanceMeters,
      radiusMeters: result.radiusMeters,
      pothole: {
        potholeId: result.pothole.potholeId,
        location: result.pothole.location,
        confidence: result.pothole.confidence,
        detectionCount: result.pothole.detectionCount,
        busesDetectedBy: result.pothole.busesDetectedBy,
        firstDetectedAt: result.pothole.firstDetectedAt,
        lastDetectedAt: result.pothole.lastDetectedAt,
        status: result.pothole.status,
        address: result.pothole.address,
        videoUrl: result.pothole.videoUrl,
        _id: result.pothole._id,
        createdAt: result.pothole.createdAt,
        updatedAt: result.pothole.updatedAt
      }
    });
  } catch (error) {
    console.error('[API] Error in create-pothole deduplication endpoint:', error);
    res.status(error.status || 500).json({
      error: error.status === 400 ? "Invalid Candidate" : "Internal Server Error",
      message: error.message
    });
  }
});

// POST /api/dev/geocode-pothole/:potholeId - Reverse geocode an existing pothole (Phase 11)
app.post('/api/dev/geocode-pothole/:potholeId', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active. Start MongoDB server before geocoding records."
      });
    }

    const { potholeId } = req.params;
    if (!potholeId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing 'potholeId' route parameter."
      });
    }

    const result = await geocodingService.updatePotholeAddress(potholeId);

    res.status(200).json({
      success: true,
      geocoded: result.geocoded,
      cached: result.cached,
      alreadyGeocoded: result.alreadyGeocoded,
      potholeId: result.potholeId,
      address: result.address,
      pothole: {
        potholeId: result.pothole.potholeId,
        location: result.pothole.location,
        confidence: result.pothole.confidence,
        detectionCount: result.pothole.detectionCount,
        busesDetectedBy: result.pothole.busesDetectedBy,
        firstDetectedAt: result.pothole.firstDetectedAt,
        lastDetectedAt: result.pothole.lastDetectedAt,
        status: result.pothole.status,
        address: result.pothole.address,
        videoUrl: result.pothole.videoUrl,
        _id: result.pothole._id,
        createdAt: result.pothole.createdAt,
        updatedAt: result.pothole.updatedAt
      }
    });
  } catch (error) {
    console.error(`[API] Error in geocode-pothole for ${req.params.potholeId}:`, error.message);
    res.status(error.status || 500).json({
      error: error.status === 404 ? "Not Found" : (error.status === 400 || error.status === 422 ? "Bad Request" : "Internal Server Error"),
      message: error.message
    });
  }
});

// ==============================================================
// 6. Google Drive Video Evidence Endpoints (Phase 12)
// ==============================================================

// GET /api/dev/auth/google/status - Check Google Drive OAuth status
app.get('/api/dev/auth/google/status', (req, res) => {
  const status = googleDriveService.getServiceStatus();
  res.json({
    success: true,
    ...status,
    authLoginUrl: status.configured && !status.authenticated ? '/api/dev/auth/google/login' : null
  });
});

// GET /api/dev/auth/google/login - Initiate Google OAuth consent flow
app.get('/api/dev/auth/google/login', (req, res) => {
  try {
    if (!googleDriveService.isConfigured()) {
      return res.status(503).json({
        error: "Not Configured",
        message: "Google Drive OAuth credentials not found. Please configure GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in dashboard/.env."
      });
    }
    const authUrl = googleDriveService.getAuthUrl();
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dev/auth/google/callback - Google OAuth callback handler
app.get('/api/dev/auth/google/callback', async (req, res) => {
  const queryKeys = Object.keys(req.query);
  const hasCode = !!req.query.code;
  const hasError = !!req.query.error;

  console.log('[GoogleOAuth Callback Diagnostics]');
  console.log('  req.originalUrl:', req.originalUrl);
  console.log('  queryKeys:      ', JSON.stringify(queryKeys));
  console.log('  hasCode:        ', hasCode);
  console.log('  hasError:       ', hasError);
  if (hasError) {
    console.log('  error:          ', req.query.error);
    if (req.query.error_description) {
      console.log('  error_desc:     ', req.query.error_description);
    }
  }

  const { code, error, error_description } = req.query;
  if (error) {
    const errorDetails = error_description ? `: ${error_description}` : '';
    return res.status(400).send(`<h3>Google OAuth Error (${error})${errorDetails}</h3>`);
  }
  if (!code) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>RAAHI - OAuth Callback</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
        <h2 style="color: #f87171;">Missing authorization code from Google redirect</h2>
        <p>This endpoint receives the OAuth redirect from Google with an authorization code parameter (?code=...).</p>
        <p>If you visited this URL directly, please initiate the login flow here:</p>
        <p><a href="/api/dev/auth/google/login" style="color: #38bdf8; font-weight: bold; text-decoration: underline;">Click here to start Google Drive Authorization (/api/dev/auth/google/login)</a></p>
      </body>
      </html>
    `);
  }

  try {
    await googleDriveService.handleAuthCallback(code);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>RAAHI - Google Drive Authorized</title></head>
      <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
        <h2 style="color: #38bdf8;">✓ Google Drive Authorized Successfully</h2>
        <p>RAAHI has stored your OAuth tokens and is now ready to upload video evidence to Google Drive.</p>
        <p style="color: #94a3b8; font-size: 14px;">You can now return to your terminal or API client.</p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[GoogleDrive] Callback failed:', err.message);
    res.status(500).send(`<h3>Authentication Failed:</h3><p>${err.message}</p>`);
  }
});

// POST /api/dev/upload-pothole-video/:potholeId - Extract evidence clip & upload to Google Drive
app.post('/api/dev/upload-pothole-video/:potholeId', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active."
      });
    }

    const { potholeId } = req.params;
    const { detectionId = 85, videoTimestamp = '00:03.60', forceReupload = false, sharePublic = false } = req.body || {};

    if (!potholeId || typeof potholeId !== 'string' || !potholeId.trim()) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing or invalid potholeId parameter."
      });
    }

    const pothole = await Pothole.findOne({ potholeId: potholeId.trim() });
    if (!pothole) {
      return res.status(404).json({
        error: "Not Found",
        message: `Pothole '${potholeId}' not found in MongoDB.`
      });
    }

    // Repeated upload protection: if already uploaded and not forcing replacement
    if (pothole.videoUrl && pothole.videoUrl.trim() !== '' && !forceReupload) {
      console.log(`[API] Pothole ${potholeId} already has videoUrl: ${pothole.videoUrl}. Returning existing.`);
      return res.status(200).json({
        success: true,
        uploaded: false,
        alreadyUploaded: true,
        potholeId: pothole.potholeId,
        videoUrl: pothole.videoUrl,
        message: "Pothole already has videoUrl. Pass 'forceReupload: true' to replace.",
        pothole
      });
    }

    // 1. Extract 5-second evidence clip locally
    let clipResult;
    try {
      clipResult = await videoEvidenceService.extractClip({
        potholeId: pothole.potholeId,
        detectionId,
        videoTimestamp
      });
    } catch (extractErr) {
      const isClientErr = extractErr.message.includes('Invalid') || extractErr.message.includes('Missing');
      return res.status(isClientErr ? 400 : 500).json({
        error: isClientErr ? "Bad Request" : "Extraction Failed",
        message: extractErr.message
      });
    }

    // 2. Check Google Drive authentication
    if (!googleDriveService.isAuthenticated()) {
      return res.status(503).json({
        error: "Google Drive Not Authenticated",
        message: "Google Drive is not authenticated. Open http://localhost:5001/api/dev/auth/google/login to authorize.",
        authUrl: googleDriveService.isConfigured() ? googleDriveService.getAuthUrl() : null,
        clip: clipResult
      });
    }

    // 3. Upload to Google Drive
    const uploadResult = await googleDriveService.uploadEvidenceClip({
      filePath: clipResult.localPath,
      fileName: clipResult.fileName,
      mimeType: 'video/mp4',
      makePublic: sharePublic
    });

    // 4. Update MongoDB document videoUrl
    pothole.videoUrl = uploadResult.url;
    const updatedPothole = await pothole.save();

    console.log(`[API] Successfully attached video evidence to ${updatedPothole.potholeId}: ${uploadResult.url}`);

    res.status(200).json({
      success: true,
      uploaded: true,
      potholeId: updatedPothole.potholeId,
      detectionId,
      videoTimestamp,
      clip: {
        fileName: clipResult.fileName,
        durationSeconds: clipResult.durationSeconds,
        startTime: clipResult.startTime,
        endTime: clipResult.endTime,
        localPath: clipResult.localPath
      },
      drive: {
        fileId: uploadResult.fileId,
        url: uploadResult.url
      },
      pothole: updatedPothole
    });
  } catch (error) {
    console.error(`[API] Error uploading pothole video for ${req.params.potholeId}:`, error.message);
    res.status(error.status || 500).json({
      error: error.status === 404 ? "Not Found" : (error.status === 400 ? "Bad Request" : "Internal Server Error"),
      message: error.message
    });
  }
});


// GET /api/dev/match-gps-demo - Live demonstration of Task 5 example
app.get('/api/dev/match-gps-demo', (req, res) => {
  const sampleDetection = {
    id: 84,
    type: "pothole",
    confidence: 0.87,
    frame: 84,
    timestamp: "00:03.36",
    bbox: { x1: 120, y1: 240, x2: 210, y2: 320 }
  };

  const sampleGpsPoints = [
    { timestamp: "00:03.20", latitude: 28.6130, longitude: 77.2085, accuracy: 4.5, name: "Location A" },
    { timestamp: "00:03.40", latitude: 28.6139, longitude: 77.2090, accuracy: 5.0, name: "Location B" },
    { timestamp: "00:03.60", latitude: 28.6148, longitude: 77.2095, accuracy: 8.2, name: "Location C" }
  ];

  const matchResult = matchDetectionToGps({
    detectionTime: sampleDetection.timestamp,
    gpsSamples: sampleGpsPoints
  });

  const candidate = createPotholeCandidate(sampleDetection, matchResult, "RAAHI-01");

  res.json({
    scenario: "TASK 5 Demonstration: Nearest GPS sample lookup for relative detection 00:03.36",
    detection: sampleDetection,
    availableGpsSamples: sampleGpsPoints,
    matchedSample: matchResult.matchedGps,
    timeDeltaMs: matchResult.timeDeltaMs,
    potholeCandidate: candidate
  });
});

// ==============================================================
// 5. Persistent Potholes API (MongoDB)
// ==============================================================


// GET /api/fleet/buses - Real active fleet tracking for connected Edge devices
app.get('/api/fleet/buses', (req, res) => {
  const buses = [];
  const now = Date.now();
  for (const [bId, busInfo] of activeFleet.entries()) {
    const isOnline = (now - busInfo.updatedAt) < 60000;
    buses.push({
      ...busInfo,
      status: isOnline ? 'online' : 'offline'
    });
  }
  if (buses.length === 0) {
    if (latestGps && latestGps.connected) {
      buses.push({
        id: 'RAAHI-01',
        route: 'Active Route 1',
        lat: latestGps.latitude,
        lng: latestGps.longitude,
        speed: 0,
        status: 'online',
        camera: true,
        lastSeen: 'Now'
      });
    }
  }
  res.json({ success: true, count: buses.length, buses });
});

// GET /api/traffic/incidents - Retrieve correlated traffic incidents from MongoDB
app.get('/api/traffic/incidents', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.json({ success: true, count: 0, incidents: [] });
    }
    const incidents = await TrafficIncident.find().sort('-lastDetectedAt').limit(100).lean();
    res.json({ success: true, count: incidents.length, incidents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/potholes - Retrieve potholes stored in MongoDB
app.get('/api/potholes', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active. Check MONGODB_URI and verify MongoDB is running.",
        database: getDbInfo(),
        count: 0,
        potholes: []
      });
    }

    const { status, bus, limit = 100, sort = '-createdAt' } = req.query;
    const filter = {};
    if (status) {
      filter.status = status.toLowerCase();
    }
    if (bus) {
      filter.busesDetectedBy = bus;
    }

    const potholes = await Pothole.find(filter)
      .sort(sort)
      .limit(parseInt(limit, 10))
      .lean();

    res.json({
      success: true,
      count: potholes.length,
      potholes
    });
  } catch (error) {
    console.error('[API] Error fetching potholes from MongoDB:', error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
});

// GET /api/potholes/stats - Aggregated pothole statistics (Phase 17)
app.get('/api/potholes/stats', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active.",
        stats: { total: 0, open: 0, investigating: 0, repaired: 0, ignored: 0 }
      });
    }

    const allPotholes = await Pothole.find({}, { status: 1 }).lean();
    const stats = {
      total: allPotholes.length,
      open: allPotholes.filter(p => p.status === 'open').length,
      investigating: allPotholes.filter(p => p.status === 'investigating').length,
      repaired: allPotholes.filter(p => p.status === 'repaired').length,
      ignored: allPotholes.filter(p => p.status === 'ignored').length
    };

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[API] Error fetching pothole stats:', error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
});

// GET /api/potholes/:potholeId - Retrieve one pothole by potholeId
app.get('/api/potholes/:potholeId', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active."
      });
    }

    const { potholeId } = req.params;
    const pothole = await Pothole.findOne({ potholeId: potholeId.trim() }).lean();

    if (!pothole) {
      return res.status(404).json({
        error: "Not Found",
        message: `Pothole '${potholeId}' not found in MongoDB.`
      });
    }

    res.json({
      success: true,
      pothole
    });
  } catch (error) {
    console.error(`[API] Error fetching pothole ${req.params.potholeId}:`, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
});

// PATCH /api/potholes/:potholeId/status - Update pothole incident status (Phase 17)
const ALLOWED_STATUSES = ['open', 'investigating', 'repaired', 'ignored'];

app.patch('/api/potholes/:potholeId/status', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB connection is not active."
      });
    }

    const { potholeId } = req.params;
    const { status } = req.body || {};

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing or invalid 'status' in request body."
      });
    }

    const normalizedStatus = status.trim().toLowerCase();
    if (!ALLOWED_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        error: "Bad Request",
        message: `Invalid status '${status}'. Allowed values: ${ALLOWED_STATUSES.join(', ')}`
      });
    }

    const pothole = await Pothole.findOne({ potholeId: potholeId.trim() });
    if (!pothole) {
      return res.status(404).json({
        error: "Not Found",
        message: `Pothole '${potholeId}' not found in MongoDB.`
      });
    }

    pothole.status = normalizedStatus;
    const updatedPothole = await pothole.save();

    console.log(`[API] Pothole ${potholeId} status updated to '${normalizedStatus}'`);

    res.json({
      success: true,
      potholeId: updatedPothole.potholeId,
      status: updatedPothole.status,
      pothole: updatedPothole
    });
  } catch (error) {
    console.error(`[API] Error updating pothole status for ${req.params.potholeId}:`, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
});


// POST /api/potholes/test-seed - Helper to seed/reset one test pothole document
app.post('/api/potholes/test-seed', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        error: "Database not connected",
        message: "MongoDB is not connected. Start MongoDB before seeding."
      });
    }

    const testData = {
      potholeId: 'POT-000001',
      location: {
        latitude: 28.4595,
        longitude: 77.0266,
        accuracy: 4.8
      },
      address: 'MG Road, Sector 14, Gurugram (TEST RECORD)',
      firstDetectedAt: new Date('2026-09-12T10:15:00.000Z'),
      lastDetectedAt: new Date('2026-09-12T10:15:00.000Z'),
      detectionCount: 1,
      busesDetectedBy: ['RAAHI-01'],
      confidence: 0.88,
      videoUrl: 'https://drive.google.com/file/d/sample-drive-id/view?usp=sharing',
      status: 'open'
    };

    const doc = await Pothole.findOneAndUpdate(
      { potholeId: testData.potholeId },
      testData,
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    res.status(201).json({
      success: true,
      message: "Test pothole POT-000001 created/updated successfully in MongoDB",
      pothole: doc
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================
// PHASE 14: LIVE PHONE-CAMERA INGESTION & STREAMING PIPELINE
// [LEGACY / PROTOTYPE ENDPOINT - PRESERVED FOR BACKWARD COMPATIBILITY]
// Note: Central must not continuously receive raw camera frames in final architecture.
// ==============================================================
let latestLiveFrameBuffer = null;
let latestLiveFrameTimestamp = 0;
let latestLiveFrameNumber = 0;
let liveFrameFps = 0;
let liveFrameFpsCounter = 0;
let liveFrameFpsTimer = Date.now();
const mjpegSubscribers = new Set();

// POST /api/live/frame - Ingest binary JPEG frame from phone camera
app.post('/api/live/frame', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '10mb' }), (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: "Bad Request", message: "Empty frame buffer" });
  }

  const now = Date.now();
  latestLiveFrameBuffer = req.body;
  latestLiveFrameTimestamp = now;
  latestLiveFrameNumber++;

  // Calculate moving FPS
  liveFrameFpsCounter++;
  if (now - liveFrameFpsTimer >= 1000) {
    liveFrameFps = Math.round((liveFrameFpsCounter * 1000) / (now - liveFrameFpsTimer) * 10) / 10;
    liveFrameFpsCounter = 0;
    liveFrameFpsTimer = now;
  }

  // Broadcast to all connected MJPEG stream subscribers (OpenCV, browser, etc.)
  if (mjpegSubscribers.size > 0) {
    const boundaryHeader = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestLiveFrameBuffer.length}\r\n\r\n`;
    for (const client of mjpegSubscribers) {
      try {
        client.write(boundaryHeader);
        client.write(latestLiveFrameBuffer);
        client.write('\r\n');
      } catch (err) {
        mjpegSubscribers.delete(client);
      }
    }
  }

  res.status(200).json({
    success: true,
    frame: latestLiveFrameNumber,
    fps: liveFrameFps,
    bytes: latestLiveFrameBuffer.length,
    subscribers: mjpegSubscribers.size
  });
});

// GET /api/live/stream - Multipart MJPEG stream for OpenCV cv2.VideoCapture & browser <img>
app.get('/api/live/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'close',
    'Pragma': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });

  // If a frame is already cached, send it immediately
  if (latestLiveFrameBuffer) {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestLiveFrameBuffer.length}\r\n\r\n`);
    res.write(latestLiveFrameBuffer);
    res.write('\r\n');
  }

  mjpegSubscribers.add(res);

  req.on('close', () => {
    mjpegSubscribers.delete(res);
  });
});

// GET /api/live/frame - Retrieve the single latest JPEG frame
app.get('/api/live/frame', (req, res) => {
  const isStreaming = latestLiveFrameTimestamp > 0 && (Date.now() - latestLiveFrameTimestamp < 3500);

  if (!latestLiveFrameBuffer) {
    return res.status(503).json({
      error: "No Frame Available",
      message: "Phone camera has not transmitted any frames yet.",
      streaming: false
    });
  }

  res.set({
    'Content-Type': 'image/jpeg',
    'Content-Length': latestLiveFrameBuffer.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'X-Frame-Number': latestLiveFrameNumber,
    'X-Frame-Timestamp': latestLiveFrameTimestamp,
    'X-Streaming': isStreaming ? 'true' : 'false',
    'X-Stream-FPS': liveFrameFps
  });

  res.send(latestLiveFrameBuffer);
});

// GET /api/live/status - Current status of phone camera stream
app.get('/api/live/status', (req, res) => {
  const now = Date.now();
  const timeSinceLastFrame = latestLiveFrameTimestamp > 0 ? (now - latestLiveFrameTimestamp) : null;
  const isStreaming = timeSinceLastFrame !== null && timeSinceLastFrame < 3500;

  res.json({
    success: true,
    streaming: isStreaming,
    fps: isStreaming ? liveFrameFps : 0,
    totalFramesReceived: latestLiveFrameNumber,
    lastFrameBytes: latestLiveFrameBuffer ? latestLiveFrameBuffer.length : 0,
    lastSeenAgoMs: timeSinceLastFrame,
    subscribers: mjpegSubscribers.size,
    timestamp: new Date().toISOString()
  });
});

// ==============================================================
// 14. Live Detection & GPS Association (Phase 15)
// [LEGACY / PROTOTYPE ENDPOINT - PRESERVED FOR BACKWARD COMPATIBILITY]
// Note: Edge handles GPS association and sends canonical package to POST /api/central/events.
// ==============================================================
// POST /api/live/detection - Process live YOLO detection event with GPS & deduplication
app.post('/api/live/detection', async (req, res) => {
  try {
    const result = await liveDetectionService.processLiveDetection(req.body, gpsHistory);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[LiveDetection] Error processing live detection event:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error while processing live detection event'
    });
  }
});

// GET /api/live/detection/status - Status of live detection pipeline
app.get('/api/live/detection/status', (req, res) => {
  res.json({
    success: true,
    cooldownMs: liveDetectionService.getLiveDetectionCooldownMs(),
    maxGpsDeltaMs: MAX_GPS_TIME_DELTA_MS,
    dedupRadiusMeters: potholeDeduplicationService.getDedupRadiusMeters(),
    gpsHistorySamples: gpsHistory.length,
    latestGpsConnected: !!(latestGps && latestGps.connected)
  });
});

// POST /api/dev/reset-live-cooldown - Reset in-memory cooldown cache for testing
app.post('/api/dev/reset-live-cooldown', (req, res) => {
  liveDetectionService.resetLiveDetectionCooldown();
  res.json({ success: true, message: 'Live detection cooldown cache reset' });
});

// ==============================================================
// 15. Live Video Evidence & Google Drive Upload (Phase 16)
// ==============================================================
// POST /api/dev/upload-live-evidence - Upload live evidence clip to Google Drive & update MongoDB
app.post(['/api/dev/upload-live-evidence', '/api/live/evidence/upload'], async (req, res) => {
  try {
    const { potholeId, detectionId, filePath, fileName } = req.body || {};
    if (!potholeId) {
      return res.status(400).json({ success: false, error: "Missing required field 'potholeId'." });
    }

    const result = await liveEvidenceService.uploadLiveEvidence({
      potholeId,
      detectionId,
      filePath,
      fileName
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[LiveEvidence] Error processing evidence upload:', err);
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error while uploading live evidence'
    });
  }
});

// GET /api/live/evidence/status - Status of live evidence pipeline and Drive connection
app.get('/api/live/evidence/status', async (req, res) => {
  try {
    const status = await liveEvidenceService.getEvidenceStatus();
    return res.status(200).json(status);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend static build if present
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`==================================================`);
  console.log(`   RAAHI DASHBOARD EXPRESS BACKEND RUNNING        `);
  console.log(`==================================================`);
  console.log(`Port:           ${PORT}`);
  console.log(`Local Access:   http://localhost:${PORT}`);
  console.log(`Wi-Fi Access:   http://${localIp}:${PORT}`);
  console.log(`Central Events: POST http://${localIp}:${PORT}/api/central/events`);
  console.log(`Candidates API: http://${localIp}:${PORT}/api/central/candidates`);
  console.log(`Promote API:    POST http://${localIp}:${PORT}/api/central/candidates/:id/promote`);
  console.log(`GPS POST API:   http://${localIp}:${PORT}/api/gps`);
  console.log(`GPS GET API:    http://${localIp}:${PORT}/api/gps`);
  console.log(`GPS History API:http://${localIp}:${PORT}/api/gps/history`);
  console.log(`System Status:  http://localhost:${PORT}/api/status`);
  console.log(`Detections API: http://localhost:${PORT}/api/detections`);
  console.log(`Video Stream:   http://localhost:${PORT}/api/video`);
  console.log(`Potholes API:   http://localhost:${PORT}/api/potholes`);
  console.log(`Pothole By ID:  http://localhost:${PORT}/api/potholes/:potholeId`);
  console.log(`Test Seed API:  POST http://localhost:${PORT}/api/potholes/test-seed`);
  console.log(`Associate API:  POST http://${localIp}:${PORT}/api/dev/associate-detection`);
  console.log(`Create Pothole: POST http://${localIp}:${PORT}/api/dev/create-pothole`);
  console.log(`Geocode API:    POST http://${localIp}:${PORT}/api/dev/geocode-pothole/:potholeId`);
  console.log(`Drive Upload:   POST http://${localIp}:${PORT}/api/dev/upload-pothole-video/:potholeId`);
  console.log(`Dedup Radius:   ${potholeDeduplicationService.getDedupRadiusMeters()} meters`);
  console.log(`Geocoding Prov: ${process.env.GEOCODING_PROVIDER || 'nominatim'}`);
  console.log(`Phone GPS (App):http://${localIp}:${PORT}/gps`);
  console.log(`Phone GPS (Dev):http://${localIp}:5173/gps`);
  console.log(`Live Stream:   http://${localIp}:${PORT}/api/live/stream`);
  console.log(`Live Detect:   POST http://${localIp}:${PORT}/api/live/detection`);
  console.log(`Live Status:   http://${localIp}:${PORT}/api/live/detection/status`);
  console.log(`Live Evidence: POST http://${localIp}:${PORT}/api/dev/upload-live-evidence`);
  console.log(`Status Update: PATCH http://localhost:${PORT}/api/potholes/:potholeId/status`);
  console.log(`Pothole Stats: http://localhost:${PORT}/api/potholes/stats`);
  console.log(`==================================================`);
});
