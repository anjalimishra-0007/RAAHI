import React from 'react';
import { Film } from 'lucide-react';
import { formatConfidence, formatCoordinate } from '../../utils/formatters';

/**
 * EventEvidence: Tactical modal dialog presenting metadata, video MP4 playback,
 * or keyframe preview for a selected candidate event.
 */
export function EventEvidence({ event, onClose }) {
  if (!event) return null;

  return (
    <div className="tactical-modal-backdrop" onClick={onClose}>
      <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="tactical-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Film size={16} color="var(--accent-cyan)" />
            <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
              CANDIDATE EVENT EVIDENCE: {event.event_id}
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
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 14,
              fontSize: 11.5,
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Hazard Type:</span>{' '}
              <b>{event.event_type?.toUpperCase()}</b>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>YOLO Confidence:</span>{' '}
              <b>{formatConfidence(event.edge_confidence)}</b>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Detection Time:</span>{' '}
              <b className="mono">{event.timestamp}</b>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Bus Identifier:</span>{' '}
              <b className="mono">{event.bus_id}</b>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>GNSS Fix:</span>{' '}
              <b className="mono">
                {event.latitude
                  ? `${formatCoordinate(event.latitude, 6)}, ${formatCoordinate(event.longitude, 6)}`
                  : 'N/A'}
              </b>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>{' '}
              <b style={{ color: 'var(--warn-amber)' }}>{event.verification_status}</b>
            </div>
          </div>

          {/* Video Player or Keyframe Viewer */}
          <div
            style={{
              background: 'var(--bg-viewport)',
              borderRadius: 4,
              padding: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-dim)',
                marginBottom: 6,
                textTransform: 'uppercase',
              }}
            >
              SYNCHRONIZED EVIDENCE PLAYBACK (~5.0s H.264 MP4)
            </div>
            {event.evidence_clip_path ? (
              <video
                controls
                autoPlay
                src={`/api/evidence/${event.event_id}_evidence.mp4`}
                style={{ width: '100%', borderRadius: 4, maxHeight: 260 }}
              />
            ) : event.evidence_frame_paths?.[0] ? (
              <img
                src={`/api/evidence/${event.event_id}_keyframe.jpg`}
                alt="Keyframe"
                style={{ width: '100%', borderRadius: 4, maxHeight: 260, objectFit: 'contain' }}
              />
            ) : (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                Evidence clip generation in progress in circular buffer...
              </div>
            )}
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
