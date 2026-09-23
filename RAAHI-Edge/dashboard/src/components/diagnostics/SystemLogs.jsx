import React from 'react';
import { Activity } from 'lucide-react';
import { formatTime } from '../../utils/formatters';

const LOG_CATEGORIES = ['ALL', 'EVENT', 'AI', 'GPS', 'NETWORK'];

/**
 * SystemLogs: Interactive operations console log viewer with category filters.
 */
export function SystemLogs({ logs = [], category, onSelectCategory }) {
  return (
    <div className="tactical-card">
      <div className="card-header-bar">
        <div className="card-title-group">
          <Activity size={14} color="var(--live-green)" />
          <span className="card-title">Operations Console Logs</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {LOG_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              style={{
                border: 'none',
                background: category === cat ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                color: category === cat ? 'var(--accent-cyan)' : 'var(--text-muted)',
                padding: '2px 7px',
                borderRadius: 3,
                fontSize: 9.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => onSelectCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="log-console-shell">
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            No telemetry logs recorded
          </div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="log-line">
              <span className="log-time">[{formatTime(l.timestamp)}]</span>
              <span className="log-tag">{l.category}</span>
              <span
                className="log-msg"
                style={{
                  color:
                    l.level === 'WARNING'
                      ? 'var(--warn-amber)'
                      : l.level === 'ERROR'
                      ? 'var(--error-rose)'
                      : 'var(--text-secondary)',
                }}
              >
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
