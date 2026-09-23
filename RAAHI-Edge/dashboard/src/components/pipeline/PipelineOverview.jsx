import React from 'react';
import { MapPin } from 'lucide-react';
import { PipelineNode } from './PipelineNode';

/**
 * 8-Stage linear hardware & software pipeline ribbon with real-time GNSS lock pill.
 */
export function PipelineOverview({
  components = {},
  metrics = {},
  latestGps,
  isStreamLive,
  storageStats,
  transmissionStats,
}) {
  const cameraInputFps = metrics.inputFps ?? metrics.receiverFps ?? 0.0;
  const aiLatencyMs = metrics.inferenceLatencyMs ?? 0.0;
  const isGpsLocked = Boolean(latestGps && latestGps.isFresh);

  return (
    <div className="pipeline-ribbon">
      <div className="pipeline-nodes-wrapper">
        {/* Stage 1: Camera */}
        <PipelineNode
          label="1. S23 FE Camera"
          val={isStreamLive ? '1080p30 H.264' : (components.camera || 'STANDBY')}
          status={isStreamLive ? 'LIVE' : components.camera}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 2: MediaMTX */}
        <PipelineNode
          label="2. MediaMTX"
          val="RTSP :8555"
          status={components.mediamtx || 'LIVE'}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 3: OpenCV Receiver */}
        <PipelineNode
          label="3. OpenCV"
          val={cameraInputFps > 0 ? `${cameraInputFps.toFixed(1)} FPS` : (components.opencv || 'IDLE')}
          status={isStreamLive ? 'LIVE' : components.opencv}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 4: YOLO11n Edge AI */}
        <PipelineNode
          label="4. YOLO11n"
          val={aiLatencyMs > 0 ? `${aiLatencyMs} ms` : 'MPS READY'}
          status={components.yolo11n || 'LIVE'}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 5: Event Engine */}
        <PipelineNode
          label="5. Event Engine"
          val={`${metrics.candidatesDetected || 0} DETS`}
          status={components.eventEngine || 'LIVE'}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 6: Rolling Ring Buffer */}
        <PipelineNode
          label="6. Ring Buffer"
          val={`${metrics.ringBufferFrames || 0} / 90 F`}
          status={metrics.ringBufferFrames > 0 ? 'LIVE' : 'OFFLINE'}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 7: SQLite DB */}
        <PipelineNode
          label="7. SQLite DB"
          val={`${storageStats?.totalEvents || 0} EVTS`}
          status={components.localDb || 'LIVE'}
        />
        <span className="pipe-divider-arrow">➔</span>

        {/* Stage 8: Central Cloud Queue */}
        <PipelineNode
          label="8. Central Queue"
          val={`${transmissionStats?.pendingCount || 0} PENDING`}
          status={components.centralConnection || 'LIVE'}
        />
      </div>

      {/* Global GNSS Fix Pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: isGpsLocked ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
          border: `1px solid ${
            isGpsLocked ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'
          }`,
          padding: '4px 10px',
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        <MapPin size={13} color={isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)'} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)',
          }}
        >
          {isGpsLocked
            ? `GNSS LOCKED (±${latestGps?.accuracy || 0}m)`
            : latestGps
            ? `GNSS STALE (${latestGps?.ageSec}s)`
            : 'NO GNSS FIX'}
        </span>
      </div>
    </div>
  );
}
