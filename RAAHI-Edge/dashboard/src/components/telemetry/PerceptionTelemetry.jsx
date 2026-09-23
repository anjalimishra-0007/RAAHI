import React from 'react';
import { Cpu } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { formatFps, formatLatency } from '../../utils/formatters';

/**
 * Perception & AI Telemetry: MPS latency, throughput, detections, suppressions, ring buffer.
 */
export function PerceptionTelemetry({ metrics, aiLatencyMs, processingFps }) {
  const m = metrics || {};
  return (
    <MetricCard
      icon={Cpu}
      iconColor="var(--accent-cyan)"
      title="Perception & AI Telemetry"
      badge="YOLO11n MPS"
      badgeStyle={{ background: 'rgba(0, 240, 255, 0.1)', color: 'var(--accent-cyan)' }}
    >
      <div className="metric-row">
        <span className="metric-row-label">MPS Inference Latency:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
          {aiLatencyMs > 0 ? `${formatLatency(aiLatencyMs)} ms` : 'NOT MEASURED'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Processing Throughput:</span>
        <span className="metric-row-val mono">
          {processingFps > 0 ? `${formatFps(processingFps)} FPS` : 'IDLE'}
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Road Hazards Detected:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>
          {m.candidatesDetected || 0} Candidate Events
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Spatial Suppressions:</span>
        <span className="metric-row-val mono" style={{ color: 'var(--text-muted)' }}>
          {m.candidatesSuppressed || 0} Duplicates Suppressed
        </span>
      </div>
      <div className="metric-row">
        <span className="metric-row-label">Rolling Ring Buffer:</span>
        <span className="metric-row-val mono">
          {m.ringBufferFrames || 0} / 90 Frames (~3.0s memory)
        </span>
      </div>
    </MetricCard>
  );
}
