import React from 'react';
import { formatFps, formatLatency, formatNumber } from '../../utils/formatters';

/**
 * Technical HUD overlay for LiveCamera: crosshair corner accents, status strip,
 * and bottom telemetry ribbon clearly separating camera input, YOLO MPS, and preview rate.
 */
export function CameraHud({
  isStreamLive,
  busId,
  resolution,
  inputFps,
  avgInputFps,
  aiLatencyMs,
  processingFps,
  showLivePreview,
  framesReceived,
  framesDropped,
}) {
  return (
    <>
      {/* HUD Corner Tech Accents */}
      <div className="hud-corner hud-top-left" />
      <div className="hud-corner hud-top-right" />
      <div className="hud-corner hud-bottom-left" />
      <div className="hud-corner hud-bottom-right" />

      {/* HUD Top Strip */}
      <div className="hud-top-strip">
        <div className="hud-status-tag">
          <div
            className="hud-status-indicator"
            style={{
              backgroundColor: isStreamLive ? 'var(--live-green)' : 'var(--text-muted)',
              boxShadow: isStreamLive ? '0 0 6px var(--live-green)' : 'none',
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: isStreamLive ? 'var(--live-green)' : 'var(--text-muted)',
            }}
          >
            {isStreamLive ? 'S23 FE H.264 HARDWARE FEED' : 'STREAM STANDBY'}
          </span>
        </div>
        <div className="hud-status-tag mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
          {busId} • {resolution}
        </div>
      </div>

      {/* HUD Bottom Telemetry Ribbon (Fixes 1-2 FPS Display Bug!) */}
      <div className="hud-bottom-telemetry-bar">
        <div className="telemetry-chip-group">
          {/* Real Physical Camera Ingestion FPS */}
          <div className="telemetry-chip">
            <span className="telemetry-chip-label">Camera Input (OpenCV)</span>
            <span
              className="telemetry-chip-val mono"
              style={{ color: inputFps > 20 ? 'var(--live-green)' : 'var(--warn-amber)' }}
            >
              {inputFps > 0 ? `${formatFps(inputFps)} FPS` : 'STANDBY'}
              {avgInputFps > 0 && (
                <span style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 4 }}>
                  ({formatFps(avgInputFps)} avg)
                </span>
              )}
            </span>
          </div>

          {/* Real YOLO11n MPS Inference Telemetry */}
          <div className="telemetry-chip">
            <span className="telemetry-chip-label">YOLO11n (Apple MPS)</span>
            <span className="telemetry-chip-val mono" style={{ color: 'var(--accent-cyan)' }}>
              {aiLatencyMs > 0 ? `${formatLatency(aiLatencyMs)} ms` : 'READY'}
              {processingFps > 0 && (
                <span style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 4 }}>
                  ({formatFps(processingFps)} FPS)
                </span>
              )}
            </span>
          </div>

          {/* Browser Web Preview Rate (Distinguished Separately) */}
          <div className="telemetry-chip">
            <span className="telemetry-chip-label">Web Monitor Preview</span>
            <span className="telemetry-chip-val mono" style={{ color: 'var(--text-secondary)' }}>
              {showLivePreview
                ? inputFps > 0
                  ? '~15 FPS (Throttled)'
                  : '0 FPS'
                : 'DISABLED'}
            </span>
          </div>
        </div>

        <div className="telemetry-chip-group">
          {/* Frame Counters */}
          <div className="telemetry-chip" style={{ textAlign: 'right' }}>
            <span className="telemetry-chip-label">Frames Ingested / Dropped</span>
            <span className="telemetry-chip-val mono" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(framesReceived)} RX •{' '}
              <span style={{ color: framesDropped > 0 ? 'var(--warn-amber)' : 'var(--live-green)' }}>
                {formatNumber(framesDropped)} DROP
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
