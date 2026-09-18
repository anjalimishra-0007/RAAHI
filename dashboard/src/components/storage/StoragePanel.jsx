import React from 'react';
import { HardDrive } from 'lucide-react';
import { MetricCard } from '../telemetry/MetricCard';

/**
 * StoragePanel: Local SQLite footprint, evidence MP4 size, saved events, clip count.
 */
export function StoragePanel({ storageStats }) {
  return (
    <MetricCard
      icon={HardDrive}
      iconColor="var(--standby-blue)"
      title="Edge Storage & Evidence"
      badge="SQLite WAL Mode"
      badgeStyle={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--standby-blue)' }}
    >
      <div className="metric-row">
        <span className="metric-row-label">SQLite DB Disk Footprint:</span>
        <span className="metric-row-val mono">{storageStats?.databaseSizeMB || 0} MB</span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Evidence MP4 Video Clustered:</span>
        <span className="metric-row-val mono">{storageStats?.evidenceSizeMB || 0} MB</span>
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
          {storageStats?.totalClips || 0} Clips (5s H.264)
        </span>
      </div>
    </MetricCard>
  );
}
