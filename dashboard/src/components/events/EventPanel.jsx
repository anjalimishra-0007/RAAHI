import React from 'react';
import { Database } from 'lucide-react';
import { EventRow } from './EventRow';

/**
 * EventPanel: Candidate road hazards table populated directly from SQLite.
 */
export function EventPanel({ events = [], onSelectEvent }) {
  return (
    <div className="tactical-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="card-header-bar">
        <div className="card-title-group">
          <Database size={14} color="var(--accent-cyan)" />
          <span className="card-title">Live Candidate Events</span>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
          {events.length} Events Logged
        </span>
      </div>

      <div className="table-scroll-container" style={{ flex: 1 }}>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Event ID</th>
              <th>Type</th>
              <th>Confidence</th>
              <th>GPS Coordinates</th>
              <th>Verification</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}
                >
                  No road hazards detected yet. YOLO detections will populate here in real time.
                </td>
              </tr>
            ) : (
              events.map((ev) => (
                <EventRow key={ev.event_id} event={ev} onSelect={onSelectEvent} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
