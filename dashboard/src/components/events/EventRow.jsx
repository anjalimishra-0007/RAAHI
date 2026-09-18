import React from 'react';
import { formatConfidence, formatCoordinate } from '../../utils/formatters';

/**
 * Single candidate event row in the EventPanel table.
 */
export function EventRow({ event, onSelect }) {
  return (
    <tr onClick={() => onSelect(event)}>
      <td className="mono" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
        {event.event_id}
      </td>
      <td>
        <span
          style={{
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(244,63,94,0.15)',
            color: 'var(--error-rose)',
            fontSize: 9.5,
            fontWeight: 700,
          }}
        >
          {event.class_name?.toUpperCase() || 'POTHOLE'}
        </span>
      </td>
      <td className="mono" style={{ fontWeight: 600 }}>
        {formatConfidence(event.edge_confidence)}
      </td>
      <td
        className="mono"
        style={{
          fontSize: 10.5,
          color: event.latitude ? 'var(--text-secondary)' : 'var(--text-dim)',
        }}
      >
        {event.latitude
          ? `${formatCoordinate(event.latitude, 4)}, ${formatCoordinate(event.longitude, 4)}`
          : 'NO GPS'}
      </td>
      <td>
        <span
          style={{
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(245,158,11,0.15)',
            color: 'var(--warn-amber)',
            fontSize: 9.5,
            fontWeight: 700,
          }}
        >
          {event.verification_status}
        </span>
      </td>
    </tr>
  );
}
