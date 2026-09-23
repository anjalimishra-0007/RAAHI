#!/usr/bin/env python3
"""
Patch script for RAAHI22 Central server/index.js:
1. Adds imports for TrafficIncident, CandidateEvent, http.
2. Serves /evidence statically.
3. Adds activeFleet registry and auto-updates it from /api/central/events and /api/gps.
4. Adds POST /api/central/evidence/upload (binary MP4 receiver + Google Drive sync).
5. Adds GET /api/fleet/buses and GET /api/traffic/incidents.
6. Forwards phone GPS from port 5001 to Edge port 5050.
"""

import os
import re

INDEX_PATH = "/Users/ujjwalraj/Desktop/RAAHI22/raahi-pothole-detection/dashboard/server/index.js"

with open(INDEX_PATH, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Add imports
import_target = "import * as centralEventPromotionService from './services/centralEventPromotionService.js';"
import_addition = """import * as centralEventPromotionService from './services/centralEventPromotionService.js';
import http from 'http';
import CandidateEvent from './models/CandidateEvent.js';
import TrafficIncident from './models/TrafficIncident.js';
import * as trafficIncidentService from './services/trafficIncidentService.js';"""

if "TrafficIncident" not in code:
    code = code.replace(import_target, import_addition)

# 2. Add activeFleet and static /evidence serving
middleware_target = "app.use(express.json());"
middleware_addition = """app.use(express.json());
app.use('/evidence', express.static(path.join(PROJECT_ROOT, 'videos/evidence')));

// In-memory active fleet registry for connected Edge devices
const activeFleet = new Map();"""

if "const activeFleet = new Map();" not in code:
    code = code.replace(middleware_target, middleware_addition)

# 3. In /api/central/events, update activeFleet
events_target = "const result = await centralEventService.ingestCandidateEvent(req.body);"
events_addition = """const result = await centralEventService.ingestCandidateEvent(req.body);

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
    }"""

if "activeFleet.set(bId" not in code:
    code = code.replace(events_target, events_addition)

# 4. Add POST /api/central/evidence/upload
evidence_upload_code = """
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
"""

if "/api/central/evidence/upload" not in code:
    marker = "app.get('/api/central/candidates',"
    code = code.replace(marker, evidence_upload_code + "\n" + marker)

# 5. Add /api/fleet/buses and /api/traffic/incidents
fleet_and_traffic_routes = """
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
"""

if "/api/fleet/buses" not in code:
    marker = "// GET /api/potholes - Retrieve potholes stored in MongoDB"
    code = code.replace(marker, fleet_and_traffic_routes + "\n" + marker)

# 6. Update POST /api/gps to forward to Edge and update activeFleet
gps_target = """  latestGps = {
    connected: true,
    ...sample
  };"""

gps_replacement = """  latestGps = {
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
  } catch (fwdErr) {}"""

if "activeFleet.set(busId" not in code:
    code = code.replace(gps_target, gps_replacement)

with open(INDEX_PATH, "w", encoding="utf-8") as f:
    f.write(code)

print("Patch applied cleanly to Central server/index.js")
