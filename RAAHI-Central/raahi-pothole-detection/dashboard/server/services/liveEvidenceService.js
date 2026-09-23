import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Pothole from '../models/Pothole.js';
import * as googleDriveService from './googleDriveService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const EVIDENCE_DIR = path.join(PROJECT_ROOT, 'videos/evidence');

/**
 * Live Video Evidence Service (Phase 16)
 * =====================================
 * Coordinates live video evidence clips with Google Drive storage
 * and MongoDB persistence.
 * 
 * Enforces duplicate video protection, validates local MP4 clips,
 * invokes googleDriveService for secure Google Drive upload,
 * and updates MongoDB pothole.videoUrl only upon confirmed upload.
 */

/**
 * Checks if a given pothole already has evidence video attached.
 * 
 * @param {string} potholeId - Pothole ID (e.g. 'POT-000004')
 * @returns {Promise<{ exists: boolean, hasVideo: boolean, videoUrl: string | null }>}
 */
export async function checkPotholeHasEvidence(potholeId) {
  if (!potholeId) {
    return { exists: false, hasVideo: false, videoUrl: null };
  }

  const pothole = await Pothole.findOne({ potholeId });
  if (!pothole) {
    return { exists: false, hasVideo: false, videoUrl: null };
  }

  const hasVideo = !!(pothole.videoUrl && typeof pothole.videoUrl === 'string' && pothole.videoUrl.trim().length > 0);
  return {
    exists: true,
    hasVideo,
    videoUrl: hasVideo ? pothole.videoUrl.trim() : null,
    pothole
  };
}

/**
 * Uploads a local live evidence MP4 clip to Google Drive and updates MongoDB.
 * 
 * Duplicate Video Protection:
 * If the target pothole already has a videoUrl, upload is skipped and the
 * existing URL is returned.
 * 
 * @param {object} params
 * @param {string} params.potholeId - MongoDB potholeId
 * @param {string|number} [params.detectionId] - Optional detection identifier
 * @param {string} params.filePath - Local filesystem path to the MP4 evidence file
 * @param {string} [params.fileName] - Destination filename on Google Drive
 * @returns {Promise<object>} Upload outcome and canonical videoUrl
 */
export async function uploadLiveEvidence({
  potholeId,
  detectionId,
  filePath,
  fileName
}) {
  if (!potholeId) {
    throw new Error("Missing required parameter 'potholeId'.");
  }
  if (!filePath) {
    throw new Error("Missing required parameter 'filePath'.");
  }

  // 1. Check target pothole existence in MongoDB
  const pothole = await Pothole.findOne({ potholeId });
  if (!pothole) {
    const err = new Error(`Pothole record '${potholeId}' not found in MongoDB.`);
    err.status = 404;
    throw err;
  }

  // 2. Duplicate Video Protection (Requirement I)
  if (pothole.videoUrl && typeof pothole.videoUrl === 'string' && pothole.videoUrl.trim().length > 0) {
    const existingUrl = pothole.videoUrl.trim();
    console.log(`[LiveEvidenceService] Pothole ${potholeId} already has evidence video (${existingUrl}). Duplicate upload prevented.`);
    return {
      success: true,
      uploaded: false,
      alreadyExists: true,
      potholeId,
      videoUrl: existingUrl,
      message: `Pothole ${potholeId} already has evidence video. Duplicate upload skipped.`
    };
  }

  // 3. Resolve and validate local MP4 file
  const absFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(PROJECT_ROOT, filePath);

  if (!fs.existsSync(absFilePath)) {
    const err = new Error(`Local evidence video file does not exist: ${absFilePath}`);
    err.status = 400;
    throw err;
  }

  const stat = fs.statSync(absFilePath);
  if (stat.size === 0) {
    const err = new Error(`Local evidence video file is empty (0 bytes): ${absFilePath}`);
    err.status = 400;
    throw err;
  }

  const targetFileName = fileName || path.basename(absFilePath);

  // 4. Upload to Google Drive using existing Phase 12 service
  console.log(`[LiveEvidenceService] Uploading evidence clip '${targetFileName}' for ${potholeId} to Google Drive...`);
  let uploadResult;
  try {
    uploadResult = await googleDriveService.uploadEvidenceClip({
      filePath: absFilePath,
      fileName: targetFileName,
      mimeType: 'video/mp4',
      makePublic: false
    });
  } catch (uploadErr) {
    console.error(`[LiveEvidenceService] Google Drive upload failed for ${potholeId}:`, uploadErr.message);
    // Keep MongoDB.videoUrl unchanged/empty and retain local evidence file on disk
    return {
      success: false,
      uploaded: false,
      potholeId,
      error: `Google Drive upload failed: ${uploadErr.message}`,
      localFilePath: absFilePath
    };
  }

  if (!uploadResult || !uploadResult.url) {
    throw new Error("Google Drive upload completed but returned no valid URL.");
  }

  // 5. Update MongoDB only AFTER successful Google Drive upload (Requirement G & H)
  pothole.videoUrl = uploadResult.url;
  await pothole.save();

  console.log(`[LiveEvidenceService] MongoDB updated: ${potholeId}.videoUrl = ${uploadResult.url}`);

  return {
    success: true,
    uploaded: true,
    alreadyExists: false,
    potholeId,
    fileId: uploadResult.fileId,
    videoUrl: uploadResult.url,
    fileName: uploadResult.fileName,
    folderId: uploadResult.folderId,
    sizeBytes: uploadResult.sizeBytes
  };
}

/**
 * Returns diagnostic metrics and status for the live evidence service.
 * 
 * @returns {Promise<object>} Status summary
 */
export async function getEvidenceStatus() {
  const driveStatus = googleDriveService.getServiceStatus();
  let localClips = [];

  if (fs.existsSync(EVIDENCE_DIR)) {
    try {
      const files = fs.readdirSync(EVIDENCE_DIR);
      localClips = files.filter(f => f.endsWith('.mp4')).map(f => {
        const full = path.join(EVIDENCE_DIR, f);
        const stat = fs.statSync(full);
        return {
          fileName: f,
          sizeBytes: stat.size,
          createdAt: stat.birthtime
        };
      });
    } catch (e) {
      console.warn('[LiveEvidenceService] Could not inspect evidence dir:', e.message);
    }
  }

  return {
    success: true,
    driveConfigured: driveStatus.configured,
    driveAuthenticated: driveStatus.authenticated,
    driveFolderName: driveStatus.folderName,
    driveFolderId: driveStatus.folderId,
    evidenceDirectory: EVIDENCE_DIR,
    localEvidenceClipsCount: localClips.length,
    localEvidenceClips: localClips.slice(-10) // last 10 clips
  };
}
