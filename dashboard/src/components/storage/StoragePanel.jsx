import React from 'react';
import { HardDrive } from 'lucide-react';
import { MetricCard } from '../telemetry/MetricCard';

/**
 * StoragePanel: Local MacBook retention limits, evidence storage, database footprint, and retention status.
 */
export function StoragePanel({ storageStats }) {
  const evMB = storageStats?.evidenceSizeMB ?? 0;
  const maxEvMB = storageStats?.maxEvidenceMB ?? 800;
  const dbMB = storageStats?.databaseSizeMB ?? 0;
  const maxDbMB = storageStats?.maxDatabaseMB ?? 200;

  const status = storageStats?.retentionStatus || 'NORMAL';
  let badgeLabel = 'NORMAL';
  let badgeStyle = { background: 'rgba(56, 189, 248, 0.1)', color: 'var(--standby-blue)' };

  if (status === 'LIMIT_REACHED_PROTECTED') {
    badgeLabel = 'LIMIT REACHED / PROTECTED';
    badgeStyle = { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)' };
  } else if (status === 'CLEANUP_ACTIVE') {
    badgeLabel = 'CLEANUP ACTIVE';
    badgeStyle = { background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.4)' };
  } else if (status === 'NEAR_LIMIT') {
    badgeLabel = 'NEAR LIMIT';
    badgeStyle = { background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.4)' };
  }

  return (
    <MetricCard
      icon={HardDrive}
      iconColor="var(--standby-blue)"
      title="Edge Storage & Retention"
      badge={badgeLabel}
      badgeStyle={badgeStyle}
    >
      <div className="metric-row">
        <span className="metric-row-label">Evidence Storage:</span>
        <span className="metric-row-val mono" style={{ color: evMB > maxEvMB ? '#f59e0b' : 'inherit' }}>
          {evMB} MB / {maxEvMB} MB
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Database Footprint:</span>
        <span className="metric-row-val mono" style={{ color: dbMB > maxDbMB ? '#f59e0b' : 'inherit' }}>
          {dbMB} MB / {maxDbMB} MB
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Total Persistent Events:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
          {storageStats?.totalEvents || 0} Recorded
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Evidence Video Clips:</span>
        <span className="metric-row-val mono">
          {storageStats?.totalClips || 0} Clips {storageStats?.protectedClips != null ? `(${storageStats.protectedClips} Protected)` : ''}
        </span>
      </div>
    </MetricCard>
  );
}

