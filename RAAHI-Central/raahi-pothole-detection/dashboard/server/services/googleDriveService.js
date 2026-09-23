import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const CONFIG_DIR = path.resolve(__dirname, '../config');
const TOKEN_FILE_PATH = path.join(CONFIG_DIR, 'drive_token.json');
const CLIENT_SECRET_FILE_PATH = path.join(CONFIG_DIR, 'client_secret.json');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const DEFAULT_FOLDER_NAME = 'RAAHI-Pothole-Evidence';
const DEFAULT_REDIRECT_URI = 'http://localhost:5001/api/dev/auth/google/callback';

/**
 * Google Drive Video Evidence Service (Phase 12)
 * =============================================
 * Handles OAuth 2.0 authentication, evidence folder management,
 * and reliable video clip uploads to Google Drive.
 */

let oauth2Client = null;
let cachedFolderId = null;

/**
 * Loads credentials from environment or client_secret.json.
 * 
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string } | null}
 */
export function getClientCredentials() {
  const envId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const envSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const rawUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const redirectUri = rawUri.trim().replace(/^['"]|['"]$/g, '');

  if (envId && envSecret) {
    return {
      clientId: envId.trim().replace(/^['"]|['"]$/g, ''),
      clientSecret: envSecret.trim().replace(/^['"]|['"]$/g, ''),
      redirectUri: redirectUri || DEFAULT_REDIRECT_URI
    };
  }

  // Check client_secret.json fallback
  if (fs.existsSync(CLIENT_SECRET_FILE_PATH)) {
    try {
      const content = JSON.parse(fs.readFileSync(CLIENT_SECRET_FILE_PATH, 'utf-8'));
      const installed = content.installed || content.web;
      if (installed && installed.client_id && installed.client_secret) {
        return {
          clientId: installed.client_id,
          clientSecret: installed.client_secret,
          redirectUri: installed.redirect_uris?.[0] || redirectUri
        };
      }
    } catch (e) {
      console.warn('[GoogleDriveService] Failed to parse client_secret.json:', e.message);
    }
  }

  return null;
}

/**
 * Initializes and returns the OAuth2 client.
 * 
 * @returns {google.auth.OAuth2}
 */
export function getOAuth2Client() {
  if (oauth2Client) {
    return oauth2Client;
  }

  const creds = getClientCredentials();
  if (!creds) {
    throw new Error(
      "Google Drive OAuth credentials are not configured.\n" +
      "Please set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in dashboard/.env\n" +
      "or place client_secret.json in dashboard/server/config/."
    );
  }

  oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri
  );

  // Load saved token if available
  loadSavedTokens();

  return oauth2Client;
}

/**
 * Loads tokens from token file or environment variable.
 */
function loadSavedTokens() {
  if (!oauth2Client) return;

  // 1. Check refresh token in .env
  const envRefresh = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (envRefresh) {
    oauth2Client.setCredentials({ refresh_token: envRefresh.trim() });
    return;
  }

  // 2. Check token file
  if (fs.existsSync(TOKEN_FILE_PATH)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_FILE_PATH, 'utf-8'));
      oauth2Client.setCredentials(token);
    } catch (e) {
      console.warn('[GoogleDriveService] Failed to load drive_token.json:', e.message);
    }
  }
}

/**
 * Checks if client credentials are configured.
 * 
 * @returns {boolean}
 */
export function isConfigured() {
  return getClientCredentials() !== null;
}

/**
 * Checks if the service has active credentials/tokens.
 * 
 * @returns {boolean}
 */
export function isAuthenticated() {
  try {
    const client = getOAuth2Client();
    return !!(client.credentials && (client.credentials.access_token || client.credentials.refresh_token));
  } catch {
    return false;
  }
}

/**
 * Generates the Google OAuth authorization URL.
 * 
 * @returns {string} Consent screen URL
 */
export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

/**
 * Exchanges authorization code for tokens and saves to drive_token.json.
 * 
 * @param {string} code - Authorization code from Google redirect
 * @returns {Promise<object>} Token object
 */
export async function handleAuthCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2));
  console.log(`[GoogleDriveService] Tokens saved to ${TOKEN_FILE_PATH}`);

  return tokens;
}

/**
 * Retrieves or creates the RAAHI evidence folder in Google Drive.
 * 
 * @returns {Promise<string>} Google Drive Folder ID
 */
export async function getOrCreateEvidenceFolder() {
  if (cachedFolderId) {
    return cachedFolderId;
  }

  // Check explicit folder ID in env
  const envFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (envFolderId) {
    cachedFolderId = envFolderId.trim();
    return cachedFolderId;
  }

  const client = getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth: client });

  // Query for existing folder
  const folderQuery = `mimeType='application/vnd.google-apps.folder' and name='${DEFAULT_FOLDER_NAME}' and trashed=false`;
  const res = await drive.files.list({
    q: folderQuery,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (res.data.files && res.data.files.length > 0) {
    cachedFolderId = res.data.files[0].id;
    console.log(`[GoogleDriveService] Reusing existing folder '${DEFAULT_FOLDER_NAME}' (ID: ${cachedFolderId})`);
    return cachedFolderId;
  }

  // Create folder if not found
  console.log(`[GoogleDriveService] Creating dedicated folder '${DEFAULT_FOLDER_NAME}' in Google Drive...`);
  const folderMetadata = {
    name: DEFAULT_FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder'
  };

  const createRes = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id, name'
  });

  cachedFolderId = createRes.data.id;
  console.log(`[GoogleDriveService] Created folder '${DEFAULT_FOLDER_NAME}' (ID: ${cachedFolderId})`);
  return cachedFolderId;
}

/**
 * Uploads an extracted video evidence clip to Google Drive.
 * 
 * @param {object} options
 * @param {string} options.filePath - Local filesystem path to video
 * @param {string} options.fileName - Destination filename
 * @param {string} [options.mimeType='video/mp4'] - MIME type
 * @param {boolean} [options.makePublic=false] - Whether to grant view access to anyone with link
 * @returns {Promise<{ fileId: string, url: string, fileName: string, folderId: string }>}
 */
export async function uploadEvidenceClip({
  filePath,
  fileName,
  mimeType = 'video/mp4',
  makePublic = false
}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File to upload does not exist: ${filePath}`);
  }

  const client = getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth: client });

  // Ensure folder exists
  const folderId = await getOrCreateEvidenceFolder();

  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  const media = {
    mimeType,
    body: fs.createReadStream(filePath)
  };

  console.log(`[GoogleDriveService] Uploading evidence clip '${fileName}' to Google Drive folder ${folderId}...`);

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink, size'
  });

  const fileId = res.data.id;
  if (!fileId) {
    throw new Error("Google Drive upload completed but no file ID was returned.");
  }

  // Safe sharing default: private to the account unless explicitly requested
  const sharePublic = (process.env.GOOGLE_DRIVE_SHARE_PUBLIC === 'true') || makePublic;
  if (sharePublic) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
      console.log(`[GoogleDriveService] Granted public view permission for file ${fileId}`);
    } catch (permErr) {
      console.warn(`[GoogleDriveService] Could not set public permission (continuing): ${permErr.message}`);
    }
  } else {
    console.log(`[GoogleDriveService] File ${fileId} kept private (default safe permission).`);
  }

  const canonicalUrl = `https://drive.google.com/file/d/${fileId}/view`;
  console.log(`[GoogleDriveService] Upload success! File ID: ${fileId} -> ${canonicalUrl}`);

  return {
    fileId,
    url: canonicalUrl,
    fileName,
    folderId,
    sizeBytes: res.data.size
  };
}

/**
 * Retrieves file metadata for an authenticated Google Drive file without exposing tokens or secrets.
 * 
 * @param {string} fileId
 * @returns {Promise<{ id: string, name: string, mimeType: string, size: number } | null>}
 */
export async function getFileMetadata(fileId) {
  if (!fileId || !isAuthenticated()) {
    return null;
  }
  try {
    const client = getOAuth2Client();
    const drive = google.drive({ version: 'v3', auth: client });
    const res = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size'
    });
    return res.data;
  } catch (err) {
    console.warn(`[GoogleDriveService] Failed to retrieve metadata for file ${fileId}:`, err.message);
    return null;
  }
}

/**
 * Downloads a private Google Drive file as a Buffer using OAuth credentials.
 * NEVER exposes OAuth tokens, secrets, or credential objects to callers.
 * 
 * @param {string} fileId
 * @returns {Promise<{ buffer: Buffer, mimeType: string, sizeBytes: number } | null>}
 */
export async function downloadFileBuffer(fileId) {
  if (!fileId || !isAuthenticated()) {
    return null;
  }
  try {
    const client = getOAuth2Client();
    const drive = google.drive({ version: 'v3', auth: client });
    const metaRes = await drive.files.get({ fileId, fields: 'id, name, mimeType, size' });
    const mediaRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return {
      buffer: Buffer.from(mediaRes.data),
      mimeType: metaRes.data.mimeType || 'application/octet-stream',
      sizeBytes: Number(metaRes.data.size) || Buffer.from(mediaRes.data).length
    };
  } catch (err) {
    console.warn(`[GoogleDriveService] Authenticated download failed for file ${fileId}:`, err.message);
    return null;
  }
}

/**
 * Status summary for health checks and APIs.
 */
export function getServiceStatus() {
  const configured = isConfigured();
  const authenticated = isAuthenticated();
  return {
    configured,
    authenticated,
    folderId: cachedFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || null,
    folderName: DEFAULT_FOLDER_NAME
  };
}
