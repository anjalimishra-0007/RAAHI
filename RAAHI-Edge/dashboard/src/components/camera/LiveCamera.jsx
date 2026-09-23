import React, { useState } from 'react';
import { Video, Activity } from 'lucide-react';
import { CameraHud } from './CameraHud';

/**
 * LiveCamera viewport component displaying live S23 FE feed, fallback states,
 * and HUD overlays.
 */
export function LiveCamera({
  showLivePreview,
  isStreamLive,
  busId,
  resolution,
  inputFps,
  avgInputFps,
  aiLatencyMs,
  processingFps,
  framesReceived,
  framesDropped,
}) {
  const [streamConnected, setStreamConnected] = useState(false);

  return (
    <div className="camera-hero-panel">
      <div className="camera-viewport">
        {showLivePreview ? (
          <>
            <img
              src="/api/video/preview"
              alt="Live Camera Stream"
              className="camera-img-stream"
              onError={() => setStreamConnected(false)}
              onLoad={() => setStreamConnected(true)}
              style={{ display: streamConnected ? 'block' : 'none' }}
            />
            {!streamConnected && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-viewport)',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <Activity size={24} color="var(--accent-cyan)" />
                <span>Connecting to physical S23 FE stream (MediaMTX :8555)...</span>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              background: 'var(--bg-viewport)',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Video size={28} color="var(--standby-blue)" />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Live Browser Preview Suspended
            </div>
            <div style={{ fontSize: 11, maxWidth: 360 }}>
              Inference and evidence recording continue at full physical rate (30 FPS) on Apple Silicon
              MPS in the background.
            </div>
          </div>
        )}

        {/* HUD Overlays */}
        <CameraHud
          isStreamLive={isStreamLive}
          busId={busId}
          resolution={resolution}
          inputFps={inputFps}
          avgInputFps={avgInputFps}
          aiLatencyMs={aiLatencyMs}
          processingFps={processingFps}
          showLivePreview={showLivePreview}
          framesReceived={framesReceived}
          framesDropped={framesDropped}
        />
      </div>
    </div>
  );
}
