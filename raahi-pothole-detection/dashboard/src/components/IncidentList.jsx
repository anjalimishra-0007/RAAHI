import { Film, AlertCircle, Loader2 } from 'lucide-react';

const statusDotColor = {
  open: 'red',
  investigating: 'amber',
  repaired: 'green',
  ignored: 'gray'
};

export default function IncidentList({ potholes = [], onSelect, loading = false, error = null }) {
  if (loading) {
    return (
      <div className="incident-list" style={{ padding: '30px 16px', textAlign: 'center', color: '#8e9ab1' }}>
        <Loader2 className="spin" style={{ width: '22px', height: '22px', margin: '0 auto 8px', display: 'block', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '11px' }}>Loading pothole incidents from MongoDB...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="incident-list" style={{ padding: '24px 16px', textAlign: 'center', color: '#ff6b81' }}>
        <AlertCircle style={{ width: '22px', height: '22px', margin: '0 auto 8px', display: 'block' }} />
        <b style={{ fontSize: '12px', display: 'block' }}>Failed to load incidents</b>
        <small style={{ fontSize: '10px', color: '#8e9ab1' }}>{error}</small>
      </div>
    );
  }

  if (!potholes || potholes.length === 0) {
    return (
      <div className="incident-list" style={{ padding: '32px 16px', textAlign: 'center', color: '#8e9ab1' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>No pothole incidents found</span>
        <small style={{ fontSize: '10px', color: '#68758e', marginTop: '4px', display: 'block' }}>
          Try selecting another status filter or refreshing.
        </small>
      </div>
    );
  }

  return (
    <div className="incident-list">
      {potholes.map(p => {
        const confPercent = p.confidence != null ? `${Math.round(p.confidence > 1 ? p.confidence : p.confidence * 100)}%` : 'N/A';
        const busesList = (p.busesDetectedBy && p.busesDetectedBy.length > 0)
          ? p.busesDetectedBy.join(', ')
          : 'None';
        const displayAddress = p.address && p.address.trim() !== ''
          ? p.address
          : (p.location ? `${p.location.latitude?.toFixed(4)}, ${p.location.longitude?.toFixed(4)} (No address)` : 'Unspecified location');

        const timeStr = p.lastDetectedAt
          ? new Date(p.lastDetectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : (p.createdAt ? new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recorded');

        const hasEvidence = !!(p.videoUrl && p.videoUrl.trim() !== '');

        return (
          <button
            className="incident-row"
            key={p.potholeId || p._id}
            onClick={() => onSelect && onSelect(p)}
            title={`View details for ${p.potholeId}`}
          >
            <span className={`severity-dot ${statusDotColor[p.status] || 'red'}`}></span>
            
            <span className="incident-main">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <b style={{ color: '#fff', fontSize: '11px', letterSpacing: '0.02em' }}>{p.potholeId}</b>
                {hasEvidence && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '8px',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      fontWeight: 700
                    }}
                    title="Google Drive Video Evidence Available"
                  >
                    <Film style={{ width: '9px', height: '9px' }} /> DRIVE VIDEO
                  </span>
                )}
              </div>
              <small style={{ color: '#94a3b8', fontSize: '9px', marginTop: '2px', lineHeight: 1.4 }}>
                {displayAddress}
              </small>
              <small style={{ color: '#64748b', fontSize: '8px', marginTop: '2px' }}>
                Detected by: <span style={{ color: '#cbd5e1' }}>{busesList}</span> • {timeStr}
              </small>
            </span>

            <span className="incident-score" style={{ textAlign: 'right', flexShrink: 0 }}>
              <b style={{ color: '#38bdf8', fontSize: '11px', display: 'block' }}>{confPercent}</b>
              <small style={{ color: '#94a3b8', fontSize: '8px', display: 'block' }}>
                {p.detectionCount || 1} {p.detectionCount === 1 ? 'det' : 'dets'}
              </small>
            </span>

            <span className={`status-pill ${p.status}`} style={{ textTransform: 'uppercase', flexShrink: 0 }}>
              {p.status}
            </span>
          </button>
        );
      })}
    </div>
  );
}
