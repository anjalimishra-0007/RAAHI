/**
 * Centralized API service for RAAHI-Edge Dashboard.
 * Handles REST communication and WebSocket telemetry connections.
 */

export async function getPipelineStatus() {
  const res = await fetch('/api/pipeline/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function startPipeline() {
  const res = await fetch('/api/pipeline/start', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function stopPipeline() {
  const res = await fetch('/api/pipeline/stop', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function restartPipeline() {
  const res = await fetch('/api/pipeline/restart', { method: 'POST' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getStorageStats() {
  const res = await fetch('/api/storage/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getTransmissionStats() {
  const res = await fetch('/api/transmission/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getEvents(limit = 25, offset = 0, eventType = null) {
  let url = `/api/events?limit=${limit}&offset=${offset}`;
  if (eventType) url += `&event_type=${encodeURIComponent(eventType)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getLogs(limit = 40, category = 'ALL') {
  const res = await fetch(`/api/logs?limit=${limit}&category=${encodeURIComponent(category)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getPhoneDiagnostics() {
  const res = await fetch('/api/phone/diagnostics');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateSettings(settings) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Creates a telemetry WebSocket connection that automatically adapts to the host.
 */
export function createTelemetryWebSocket(onMessage, onError, onClose) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (onMessage) onMessage(data);
    } catch (err) {
      console.warn('[Telemetry WS] JSON parse error:', err);
    }
  };

  ws.onerror = (err) => {
    if (onError) onError(err);
  };

  ws.onclose = (evt) => {
    if (onClose) onClose(evt);
  };

  return ws;
}
