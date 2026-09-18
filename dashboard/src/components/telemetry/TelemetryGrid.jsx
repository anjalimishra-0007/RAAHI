import React from 'react';
import { PerceptionTelemetry } from './PerceptionTelemetry';
import { GpsTelemetry } from './GpsTelemetry';
import { StoragePanel } from '../storage/StoragePanel';
import { TransmissionPanel } from '../storage/TransmissionPanel';

/**
 * TelemetryGrid groups the 4 operational metric subsystems (Perception, GNSS, Storage, Transmission).
 */
export function TelemetryGrid({
  metrics,
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
        <GpsTelemetry latestGps={latestGps} />
      </div>

      <div className="subsystems-grid">
        <StoragePanel storageStats={storageStats} />
        <TransmissionPanel transmissionStats={transmissionStats} />
      </div>
    </>
  );
}
