import React from 'react';
import { Car } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { formatFps, formatLatency } from '../../utils/formatters';

const STATE_STYLES = {
  FREE: { background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: 'FREE FLOW' },
  MODERATE: { background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', label: 'MODERATE' },
  HEAVY: { background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', label: 'HEAVY' },
  CONGESTED: { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'CONGESTED' },
};

/**
 * Traffic Telemetry: ByteTrack vehicle tracking, road ROI density, virtual line flow, congestion state.
 */
export function TrafficTelemetry({ traffic }) {
  const t = traffic || {};
  const state = t.state || 'FREE';
  const style = STATE_STYLES[state] || STATE_STYLES.FREE;

  const occupancyPct = t.occupancyRatio != null ? (t.occupancyRatio * 100).toFixed(1) : '0.0';
  const flowVpm = t.flowVpm != null ? t.flowVpm.toFixed(1) : '0.0';
  const activeVehicles = t.activeVehicles ?? 0;
  const uniqueSeen = t.uniqueVehiclesSeen ?? 0;
  const vehFps = t.vehicleInferenceFps ?? 0;
  const vehLatency = t.vehicleLatencyMs ?? 0;
  const byteTrackLatency = t.bytetrackLatencyMs ?? 0;

  return (
    <MetricCard
      icon={Car}
      iconColor="#38bdf8"
      title="Traffic & ByteTrack Telemetry"
      badge={style.label}
      badgeStyle={{ background: style.background, color: style.color }}
    >
      <div className="metric-row">
        <span className="metric-row-label">Active Tracked Vehicles:</span>
        <span className="metric-row-val mono" style={{ color: '#38bdf8' }}>
          {activeVehicles} in frame ({t.vehiclesInRoi ?? 0} in ROI)
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Road ROI Occupancy:</span>
        <span className="metric-row-val mono" style={{ color: style.color }}>
          {occupancyPct}%
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Flow Rate:</span>
        <span className="metric-row-val mono">
          {flowVpm} VPM ({t.flow10s ?? 0} / 10s)
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">ByteTrack & Inference:</span>
        <span className="metric-row-val mono">
          {vehFps > 0 ? `${formatFps(vehFps)} FPS` : 'STANDBY'} ({formatLatency(vehLatency)}ms inf + {formatLatency(byteTrackLatency)}ms trk)
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Session Unique Track IDs:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--text-muted)' }}>
          {uniqueSeen} vehicles observed
        </span>
      </div>
    </MetricCard>
  );
}
