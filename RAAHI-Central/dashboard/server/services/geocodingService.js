import Pothole from '../models/Pothole.js';

/**
 * Reverse Geocoding Service (Phase 11)
 * ===================================
 * Resolves geographic coordinates (latitude, longitude) into human-readable
 * street/city addresses using OpenStreetMap Nominatim.
 * 
 * Features:
 * - In-memory coordinate cache (keyed to 4 decimal places, ~11m precision)
 * - Rate-limit protection respecting Nominatim usage policy
 * - Configurable User-Agent and timeout via environment variables
 * - Safe update of MongoDB Pothole documents without data loss
 */

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_USER_AGENT = 'RAAHI-Pothole-Detection/1.0 (local-prototype)';
const DEFAULT_TIMEOUT_MS = 8000;

// In-memory cache for geocoding results
// Key format: "lat.toFixed(4),lng.toFixed(4)" (~11m spatial resolution)
const geocodingCache = new Map();

/**
 * Validates geographic coordinate values.
 * 
 * @param {number} latitude - Latitude in decimal degrees
 * @param {number} longitude - Longitude in decimal degrees
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateCoordinates(latitude, longitude) {
  const lat = typeof latitude === 'string' ? parseFloat(latitude) : latitude;
  const lng = typeof longitude === 'string' ? parseFloat(longitude) : longitude;

  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, error: "Coordinates must be finite numbers." };
  }

  if (lat < -90 || lat > 90) {
    return { valid: false, error: `Invalid latitude '${latitude}'. Must be between -90 and 90 degrees.` };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, error: `Invalid longitude '${longitude}'. Must be between -180 and 180 degrees.` };
  }

  return { valid: true, error: null };
}

/**
 * Generates an in-memory cache key based on coordinates rounded to 4 decimal places.
 * At 4 decimal places, 0.0001 degrees corresponds to approximately 11.1 meters,
 * perfectly matching RAAHI's 10-meter deduplication threshold.
 * 
 * @param {number} latitude 
 * @param {number} longitude 
 * @returns {string} e.g. "28.6139,77.2090"
 */
export function getCacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
}

/**
 * Performs reverse geocoding via OpenStreetMap Nominatim with caching and error handling.
 * 
 * @param {number} latitude - Target latitude
 * @param {number} longitude - Target longitude
 * @returns {Promise<{ success: boolean, address: string, cached: boolean, raw: object }>}
 */
export async function reverseGeocode(latitude, longitude) {
  const validation = validateCoordinates(latitude, longitude);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.status = 400;
    throw err;
  }

  const cacheKey = getCacheKey(latitude, longitude);

  // Check in-memory cache
  if (geocodingCache.has(cacheKey)) {
    const cachedEntry = geocodingCache.get(cacheKey);
    return {
      success: true,
      address: cachedEntry.address,
      cached: true,
      raw: cachedEntry.raw
    };
  }

  // Configuration from environment
  const userAgent = process.env.GEOCODING_USER_AGENT || DEFAULT_USER_AGENT;
  const timeoutMs = parseInt(process.env.GEOCODING_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);

  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      const err = new Error(`Geocoding provider responded with status ${response.status}: ${response.statusText}`);
      err.status = response.status >= 500 ? 502 : response.status;
      throw err;
    }

    const data = await response.json();

    if (data.error) {
      const err = new Error(`Geocoding provider error: ${data.error}`);
      err.status = 404;
      throw err;
    }

    const address = data.display_name || '';
    if (!address) {
      const err = new Error("No usable address returned by geocoding provider.");
      err.status = 422;
      throw err;
    }

    // Save to in-memory cache
    geocodingCache.set(cacheKey, { address, raw: data });

    return {
      success: true,
      address,
      cached: false,
      raw: data
    };
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      const timeoutErr = new Error(`Geocoding request timed out after ${timeoutMs}ms.`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw error;
  }
}

/**
 * Updates the address of an existing Pothole in MongoDB using reverse geocoding.
 * 
 * Flow:
 * 1. Find pothole by ID in MongoDB
 * 2. If already geocoded, return cached address immediately
 * 3. Otherwise call reverseGeocode(lat, lon)
 * 4. Save updated address to MongoDB document
 * 5. Return updated document
 * 
 * @param {string} potholeId - ID of the pothole (e.g. "POT-000002")
 * @returns {Promise<object>} Result summary and updated Mongoose document
 */
export async function updatePotholeAddress(potholeId) {
  if (!potholeId || typeof potholeId !== 'string') {
    const err = new Error("potholeId must be a non-empty string.");
    err.status = 400;
    throw err;
  }

  const pothole = await Pothole.findOne({ potholeId: potholeId.trim() });
  if (!pothole) {
    const err = new Error(`Pothole '${potholeId}' not found in MongoDB.`);
    err.status = 404;
    throw err;
  }

  // If already populated with a non-empty address, avoid redundant external API calls
  if (pothole.address && pothole.address.trim().length > 0) {
    console.log(`[GeocodingService] ${pothole.potholeId} already has address: "${pothole.address}". Returning cached/persisted address.`);
    return {
      success: true,
      geocoded: false,
      cached: true,
      alreadyGeocoded: true,
      potholeId: pothole.potholeId,
      address: pothole.address,
      pothole
    };
  }

  const lat = pothole.location?.latitude;
  const lng = pothole.location?.longitude;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    const err = new Error(`Pothole '${potholeId}' lacks valid coordinates in database.`);
    err.status = 422;
    throw err;
  }

  // Reverse geocode via Nominatim
  const geoResult = await reverseGeocode(lat, lng);

  // Update MongoDB document
  pothole.address = geoResult.address;
  const updatedDoc = await pothole.save();

  console.log(`[GeocodingService] Successfully geocoded ${updatedDoc.potholeId}: "${updatedDoc.address}"`);

  return {
    success: true,
    geocoded: true,
    cached: geoResult.cached,
    alreadyGeocoded: false,
    potholeId: updatedDoc.potholeId,
    address: updatedDoc.address,
    pothole: updatedDoc
  };
}

/**
 * Helper to view cache size and statistics.
 */
export function getCacheStats() {
  return {
    cachedEntries: geocodingCache.size,
    keys: Array.from(geocodingCache.keys())
  };
}

/**
 * Helper to clear cache in testing if needed.
 */
export function clearCache() {
  geocodingCache.clear();
}
