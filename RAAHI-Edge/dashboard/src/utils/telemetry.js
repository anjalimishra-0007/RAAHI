/**
 * Telemetry status categorization and mapping utilities.
 */

export function getNodeStatusClass(status) {
  if (!status) return 'node-offline';
  const s = String(status).toUpperCase();
  if (['LIVE', 'STREAMING', 'RUNNING', 'CONNECTED', 'ACTIVE', 'INFERRING'].includes(s)) {
    return 'node-live';
  }
  if (['STANDBY', 'READY', 'CONNECTING', 'INITIALIZING'].includes(s)) {
    return 'node-standby';
  }
  if (['DEGRADED', 'STALLED', 'STALE'].includes(s)) {
    return 'node-degraded';
  }
  return 'node-offline';
}

export function getStatusDotClass(status) {
  if (!status) return 'dot-offline';
  const s = String(status).toUpperCase();
  if (['LIVE', 'STREAMING', 'RUNNING', 'CONNECTED', 'ACTIVE', 'INFERRING'].includes(s)) {
    return 'dot-live';
  }
  if (['STANDBY', 'READY', 'CONNECTING', 'INITIALIZING'].includes(s)) {
    return 'dot-standby';
  }
  if (['DEGRADED', 'STALLED', 'STALE'].includes(s)) {
    return 'dot-warning';
  }
  return 'dot-offline';
}

export function isPipelineLive(components, inputFps) {
  if (!components) return false;
  const isCameraLive = components.camera === 'LIVE' || components.camera === 'STREAMING';
  return isCameraLive && Number(inputFps) > 0;
}
