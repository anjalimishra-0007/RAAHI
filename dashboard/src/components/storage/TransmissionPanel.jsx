import React from 'react';
import { Cloud } from 'lucide-react';
import { MetricCard } from '../telemetry/MetricCard';

/**
 * TransmissionPanel: Cloud sync queue status, sent count, pending payloads, retry resilience.
 */
export function TransmissionPanel({ transmissionStats }) {
  const isConnected = Boolean(transmissionStats?.connected);

  return (
    <MetricCard
      icon={Cloud}
      iconColor="var(--accent-cyan)"
      title="Central Transmission"
      badge={isConnected ? 'CONNECTED' : 'OFFLINE MODE'}
      badgeStyle={{
        background: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
        color: isConnected ? 'var(--live-green)' : 'var(--error-rose)',
      }}
    >
      <div className="metric-row">
        <span className="metric-row-label">Uploaded to Central:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>
          {transmissionStats?.sentCount || 0} Events
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Pending Transmission Queue:</span>
        <span
          className="metric-row-val mono"
          style={{
            color: (transmissionStats?.pendingCount || 0) > 0 ? 'var(--warn-amber)' : 'var(--text-primary)',
          }}
        >
          {transmissionStats?.pendingCount || 0} Payloads
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Transmission Retries / Failed:</span>
        <span
          className="metric-row-val mono"
          style={{
            color: (transmissionStats?.failedCount || 0) > 0 ? 'var(--error-rose)' : 'var(--text-dim)',
          }}
        >
          {transmissionStats?.failedCount || 0} Failed
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Architecture Resilience:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
          Offline-First Auto Drain
        </span>
      </div>
    </MetricCard>
  );
}
