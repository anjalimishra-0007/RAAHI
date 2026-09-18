import React from 'react';
import { Smartphone } from 'lucide-react';

/**
 * DiagnosticsModal: Inspect Samsung Galaxy S23 FE physical hardware, Wi-Fi hotspot,
 * ping latency, and ADB connection status.
 */
export function DiagnosticsModal({ isOpen, onClose, phoneDiag }) {
  if (!isOpen) return null;

  return (
    <div className="tactical-modal-backdrop" onClick={onClose}>
      <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="tactical-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Smartphone size={16} color="var(--warn-amber)" />
            <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
              SAMSUNG GALAXY S23 FE DIAGNOSTICS
            </h3>
          </div>
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 16,
            }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="tactical-modal-body">
          <div
            style={{
              background: 'var(--bg-viewport)',
              padding: 12,
              borderRadius: 4,
              border: '1px solid var(--border-subtle)',
              marginBottom: 12,
              fontSize: 11.5,
            }}
          >
            <div className="metric-row">
              <span className="metric-row-label">Physical Hardware Model:</span>
              <span className="metric-row-val mono">
                Samsung Galaxy S23 FE ({phoneDiag?.adbDevice || 'SM-S711B'})
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">Android OS Version:</span>
              <span className="metric-row-val mono">
                Android {phoneDiag?.androidVersion || '16'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">Phone Wi-Fi Hotspot Gateway:</span>
              <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
                {phoneDiag?.hotspotIp || '10.147.108.78'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">Hotspot ICMP Ping Latency:</span>
              <span className="metric-row-val mono">
                {phoneDiag?.hotspotPingMs ? `${phoneDiag.hotspotPingMs} ms` : 'N/A'}{' '}
                ({phoneDiag?.hotspotReachable ? 'Reachable' : 'Standby'})
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">Mac Wi-Fi Host IP (MediaMTX):</span>
              <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>
                {phoneDiag?.macIp || '10.147.108.80'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">ADB Hardware Diagnostic Link:</span>
              <span className="metric-row-val mono">
                {phoneDiag?.adbConnected
                  ? '🟢 Connected (USB-C Debugging)'
                  : '🟡 Wireless Ingestion Active'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row-label">MediaMTX RTSP Target:</span>
              <span className="metric-row-val mono">
                rtsp://{phoneDiag?.macIp || '10.147.108.80'}:8555/live
              </span>
            </div>
          </div>

          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            RootEncoder logcat inspection command:
            <br />
            <code
              className="mono"
              style={{
                color: 'var(--accent-cyan)',
                background: 'rgba(0,240,255,0.06)',
                padding: '2px 6px',
                borderRadius: 3,
                display: 'inline-block',
                marginTop: 4,
              }}
            >
              adb logcat -s RootEncoder CameraManager RAAHI_GPS
            </code>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button type="button" className="btn-tactical" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
