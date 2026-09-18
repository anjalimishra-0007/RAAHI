import React from 'react';
import {
  Play, Square, RotateCw, Video, Settings, Smartphone, Radio
} from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { THEMES } from '../../context/themeConstants';

/**
 * Top operational header: branding, bus identifier, system status, execution buttons, and theme switcher.
 */
export function Header({
  busId,
  isStreamLive,
  isPipelineRunning,
  onStart,
  onStop,
  onRestart,
  showLivePreview,
  onTogglePreview,
  onOpenPhoneDiag,
  onOpenSettings,
}) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="ops-header">
      <div className="ops-branding">
        <div className="ops-badge-icon">
          <Radio size={20} color="#ffffff" />
        </div>
        <div className="ops-title-group">
          <div className="ops-title-row">
            <span className="ops-title">RAAHI EDGE CONTROL</span>
            <span className="ops-bus-tag mono">{busId}</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.5,
                fontWeight: 700,
                color: isStreamLive
                  ? 'var(--live-green)'
                  : isPipelineRunning
                  ? 'var(--standby-blue)'
                  : 'var(--text-muted)',
                marginLeft: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: isStreamLive
                    ? 'var(--live-green)'
                    : isPipelineRunning
                    ? 'var(--standby-blue)'
                    : 'var(--text-dim)',
                  boxShadow: isStreamLive ? '0 0 8px var(--live-green)' : 'none',
                }}
              />
              {isStreamLive
                ? 'LIVE SENSING ACTIVE'
                : isPipelineRunning
                ? 'STANDBY / LISTENING'
                : 'OFFLINE'}
            </span>
          </div>
          <span className="ops-subtitle">
            Mission-Critical Road Intelligence Gateway • Samsung S23 FE Physical Pipeline
          </span>
        </div>
      </div>

      {/* Controls & Theme Switcher */}
      <div className="ops-controls">
        {/* Theme Selector Segmented Control */}
        <div className="theme-switcher-group" title="Select operations console theme">
          <button
            type="button"
            className={`theme-btn ${theme === THEMES.TACTICAL_DARK ? 'active' : ''}`}
            onClick={() => setTheme(THEMES.TACTICAL_DARK)}
          >
            ● TACTICAL
          </button>
          <button
            type="button"
            className={`theme-btn ${theme === THEMES.OLED_DARK ? 'active' : ''}`}
            onClick={() => setTheme(THEMES.OLED_DARK)}
          >
            ● OLED
          </button>
          <button
            type="button"
            className={`theme-btn ${theme === THEMES.LIGHT ? 'active' : ''}`}
            onClick={() => setTheme(THEMES.LIGHT)}
          >
            ○ LIGHT
          </button>
        </div>

        {/* Master Execution Controls */}
        <button
          type="button"
          className="btn-tactical btn-primary-start"
          onClick={onStart}
          title="Start real-time inference pipeline"
        >
          <Play size={13} fill="currentColor" /> START
        </button>
        <button
          type="button"
          className="btn-tactical btn-danger-stop"
          onClick={onStop}
          title="Halt pipeline safely"
        >
          <Square size={13} fill="currentColor" /> STOP
        </button>
        <button
          type="button"
          className="btn-tactical"
          onClick={onRestart}
          title="Restart RTSP and AI workers"
        >
          <RotateCw size={13} /> RESTART
        </button>
        <button
          type="button"
          className={`btn-tactical ${showLivePreview ? 'btn-toggle-active' : ''}`}
          onClick={onTogglePreview}
          title="Toggle client-side video preview (saves rendering resources)"
        >
          <Video size={13} /> {showLivePreview ? 'HIDE PREVIEW' : 'SHOW PREVIEW'}
        </button>
        <button
          type="button"
          className="btn-tactical"
          onClick={onOpenPhoneDiag}
          title="Samsung Galaxy S23 FE Diagnostics"
        >
          <Smartphone size={13} color="var(--warn-amber)" /> PHONE DIAG
        </button>
        <button
          type="button"
          className="btn-tactical"
          onClick={onOpenSettings}
          title="Configure Bus Edge Settings"
        >
          <Settings size={13} /> SETTINGS
        </button>
      </div>
    </header>
  );
}
