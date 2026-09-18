import React from 'react';
import { PerceptionTelemetry } from './PerceptionTelemetry';
import { TrafficTelemetry } from './TrafficTelemetry';
import { GpsTelemetry } from './GpsTelemetry';
import { StoragePanel } from '../storage/StoragePanel';
import { TransmissionPanel } from '../storage/TransmissionPanel';

/**
 * TelemetryGrid groups the operational metric subsystems (Perception, Traffic, GNSS, Storage, Transmission).
 */
export function TelemetryGrid({
  metrics,
  traffic,
  aiLatencyMs,
  processingFps,
  latestGps,
  storageStats,
  transmissionStats,
}) {
  return (
    <>
      <div className="subsystems-grid">
        <PerceptionTelemetry
          metrics={metrics}
          aiLatencyMs={aiLatencyMs}
          processingFps={processingFps}
        />
        <TrafficTelemetry traffic={traffic} />
      </div>

      <div className="subsystems-grid">
        <GpsTelemetry latestGps={latestGps} />
        <StoragePanel storageStats={storageStats} />
      </div>

      <div className="subsystems-grid" style={{ gridTemplateColumns: '1fr' }}>
        <TransmissionPanel transmissionStats={transmissionStats} />
      </div>
    </>
  );
}

