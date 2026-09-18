import React from 'react';
import { MapPin } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { formatCoordinate } from '../../utils/formatters';

/**
 * Physical GNSS Telemetry: coordinates, horizontal accuracy, fix age, ground speed.
 */
export function GpsTelemetry({ latestGps }) {
  const isGpsLocked = Boolean(latestGps && latestGps.isFresh);

  return (
    <MetricCard
      icon={MapPin}
      iconColor="var(--live-green)"
      title="Physical GNSS Telemetry"
      badge={isGpsLocked ? 'LOCK ACQUIRED' : latestGps ? 'STALE FIX' : 'DISCONNECTED'}
      badgeStyle={{
        background: isGpsLocked ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
        color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)',
      }}
    >
      <div className="metric-row">
        <span className="metric-row-label">Coordinates (Lat / Lon):</span>
        <span
          className="metric-row-val mono"
          style={{ color: latestGps ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          {latestGps?.latitude
            ? `${formatCoordinate(latestGps.latitude, 6)}, ${formatCoordinate(latestGps.longitude, 6)}`
            : 'WAITING FOR FIX'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Horizontal Accuracy:</span>
        <span
          className="metric-row-val mono"
          style={{ color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)' }}
        >
          {latestGps?.accuracy !== undefined && latestGps?.accuracy !== null
            ? `±${latestGps.accuracy} meters`
            : 'N/A'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Fix Freshness / Age:</span>
        <span className="metric-row-val mono">
          {latestGps?.ageSec !== undefined ? `${latestGps.ageSec} seconds ago` : 'N/A'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Ground Speed:</span>
        <span className="metric-row-val mono">
          {latestGps?.speed !== undefined && latestGps.speed !== null
            ? `${latestGps.speed} km/h`
            : '0.0 km/h'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Telemetry Ingest Port:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
          HTTP POST :5001 /api/gps
        </span>
      </div>
    </MetricCard>
  );
}
