/**
 * RAAHI Central Command Center — API Client
 *
 * Centralized HTTP client for RAAHI Central services:
 * - Authoritative Pothole Incidents (/api/potholes)
 * - Candidate Events (/api/central/candidates)
 * - Candidate Promotion (/api/central/candidates/:id/promote)
 *
 * Preserves backend response formats and error semantics.
 */

const BASE_URL = '';

/**
 * Generic fetch wrapper with standardized error handling.
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const res = await fetch(url, config);
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errorMsg = data?.message || data?.error || `HTTP ${res.status} ${res.statusText}`;
      const err = new Error(errorMsg);
      err.status = res.status;
      err.data = data;
      err.code = data?.code || data?.error;
      throw err;
    }

    return data;
  } catch (err) {
    // Re-throw structured error
    if (!err.status) {
      err.status = 0;
      err.message = `Network request failed: ${err.message}`;
    }
    throw err;
  }
}

// ============================================================================
// AUTHORITATIVE POTHOLE INCIDENT APIS (Central Source of Truth)
// ============================================================================

/**
 * Fetch list of authoritative potholes with optional status filtering.
 * @param {Object} [params]
 * @param {string} [params.status] - 'open', 'investigating', 'repaired', 'ignored', or 'all'
 * @param {number} [params.limit]
 * @param {number} [params.page]
 * @returns {Promise<{ success: boolean, count: number, potholes: Array }>}
 */
export async function fetchPotholes(params = {}) {
  const searchParams = new URLSearchParams();
  if (params.status && params.status.toLowerCase() !== 'all') {
    searchParams.set('status', params.status.toLowerCase());
  }
  if (params.limit) searchParams.set('limit', params.limit);
  if (params.page) searchParams.set('page', params.page);

  const qs = searchParams.toString();
  return request(`/api/potholes${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch aggregated statistics across authoritative potholes.
 * @returns {Promise<{ success: boolean, stats: { total: number, open: number, investigating: number, repaired: number, ignored: number } }>}
 */
export async function fetchPotholeStats() {
  return request('/api/potholes/stats');
}

/**
 * Fetch a single authoritative pothole by its public ID.
 * @param {string} potholeId - e.g. 'POT-000001'
 * @returns {Promise<{ success: boolean, pothole: Object }>}
 */
export async function fetchPothole(potholeId) {
  return request(`/api/potholes/${encodeURIComponent(potholeId)}`);
}

/**
 * Update the status of an authoritative pothole.
 * @param {string} potholeId - e.g. 'POT-000001'
 * @param {string} status - 'open', 'investigating', 'repaired', 'ignored'
 * @returns {Promise<{ success: boolean, message: string, pothole: Object }>}
 */
export async function updatePotholeStatus(potholeId, status) {
  return request(`/api/potholes/${encodeURIComponent(potholeId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ============================================================================
// CANDIDATE EVENT APIS (Non-authoritative pre-verification events)
// ============================================================================

/**
 * Fetch list of candidate events with optional filtering.
 * @param {Object} [params]
 * @param {string} [params.status] - 'pending', 'promoted', or 'all'
 * @param {string|boolean} [params.isPromoted]
 * @param {string} [params.busId]
 * @param {string} [params.eventType]
 * @param {number} [params.limit]
 * @param {string} [params.sort]
 * @param {number} [params.page]
 * @returns {Promise<{ success: boolean, count: number, candidates: Array }>}
 */
export async function fetchCandidates(params = {}) {
  const searchParams = new URLSearchParams();
  if (params.status && params.status.toLowerCase() !== 'all') {
    searchParams.set('status', params.status.toLowerCase());
  }
  if (params.isPromoted !== undefined) {
    searchParams.set('isPromoted', params.isPromoted);
  }
  if (params.busId) searchParams.set('busId', params.busId);
  if (params.eventType) searchParams.set('eventType', params.eventType);
  if (params.limit) searchParams.set('limit', params.limit);
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.page) searchParams.set('page', params.page);

  const qs = searchParams.toString();
  return request(`/api/central/candidates${qs ? `?${qs}` : ''}`);
}

/**
 * Fetch a single candidate event by candidateId.
 * @param {string} candidateId - e.g. 'CAN-000001'
 * @returns {Promise<{ success: boolean, candidate: Object }>}
 */
export async function fetchCandidate(candidateId) {
  return request(`/api/central/candidates/${encodeURIComponent(candidateId)}`);
}

/**
 * Promote an eligible candidate into an authoritative Pothole.
 * @param {string} candidateId
 * @returns {Promise<{ success: boolean, status: string, pothole: Object, candidate: Object, action?: string }>}
 */
export async function promoteCandidate(candidateId) {
  return request(`/api/central/candidates/${encodeURIComponent(candidateId)}/promote`, {
    method: 'POST',
  });
}

/**
 * Fetch backend system status and database connectivity info.
 * @returns {Promise<Object>}
 */
export async function fetchSystemStatus() {
  return request('/api/status');
}

/**
 * Fetch evidence storage and Google Drive operational status.
 * @returns {Promise<Object>}
 */
export async function fetchEvidenceStatus() {
  return request('/api/live/evidence/status');
}

/**
 * Fetch real active connected fleet buses.
 * @returns {Promise<{ success: boolean, count: number, buses: Array }>}
 */
export async function fetchFleetBuses() {
  return request('/api/fleet/buses');
}

/**
 * Fetch real traffic incidents from MongoDB.
 * @returns {Promise<{ success: boolean, count: number, incidents: Array }>}
 */
export async function fetchTrafficIncidents() {
  return request('/api/traffic/incidents');
}
