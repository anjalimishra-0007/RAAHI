/**
 * Telemetry and data formatters for RAAHI-Edge.
 */

export function formatFps(fps) {
  if (fps === undefined || fps === null || Number.isNaN(fps)) return '0.0';
  return Number(fps).toFixed(1);
}

export function formatLatency(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '0.0';
  return Number(ms).toFixed(1);
}

export function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  return Number(num).toLocaleString();
}

export function formatCoordinate(val, precision = 4) {
  if (val === undefined || val === null || Number.isNaN(val)) return 'N/A';
  return Number(val).toFixed(precision);
}

export function formatConfidence(conf) {
  if (conf === undefined || conf === null) return '0%';
  return `${Math.round(Number(conf) * 100)}%`;
}

export function formatTime(isoString) {
  if (!isoString) return '00:00:00';
  const parts = isoString.split(' ');
  if (parts.length > 1) return parts[1];
  const tParts = isoString.split('T');
  if (tParts.length > 1) return tParts[1].split('.')[0];
  return isoString;
}
