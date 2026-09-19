import React, { useState } from 'react';
import {
  X,
  Film,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPinned,
  Loader2
} from 'lucide-react';
import { fetchPothole } from '../../services/api';

/**
 * Candidate Details & Inspection Drawer
 *
 * Provides deep operational inspection of an Edge-generated CandidateEvent:
 * - Candidate & Edge metadata
 * - Original Edge YOLO detection (Class, Confidence, Bounding Box)
 * - Raw Edge GPS location
 * - Visual evidence clip reference
 * - Promotion status & 10m spatial fusion trigger
 * - Bidirectional lineage navigation to Authoritative Incident
 */
export default function CandidateDrawer({
  candidate,
  onClose,
  onPromote,
  onViewIncident,
  promoting = false
}) {
  if (!candidate) return null;

  const cId = candidate.candidateId || 'CANDIDATE';
  const edgeConfPercent = candidate.confidence != null
    ? `${Math.round(candidate.confidence > 1 ? candidate.confidence : candidate.confidence * 100)}%`
    : 'N/A';

  const lat = candidate.location?.latitude;
  const lng = candidate.location?.longitude;
  const accuracy = candidate.location?.accuracy;
  const locationStr = (typeof lat === 'number' && typeof lng === 'number')
    ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    : 'Not available';

  const timestampStr = candidate.timestamp
    ? new Date(candidate.timestamp).toLocaleString()
    : (candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : 'Recorded');

  const hasEvidence = !!(candidate.evidenceReference && candidate.evidenceReference.trim() !== '');
  const isPromoted = !!candidate.promotedToPotholeId;
  const canPromote = !isPromoted;

  const bbox = candidate.boundingBox;
  const hasBbox = bbox && (bbox.x1 != null || bbox.y1 != null);

  // Lineage navigation state
  const [loadingIncident, setLoadingIncident] = useState(false);
  const [incidentError, setIncidentError] = useState(null);

  const handleViewIncident = async (pId) => {
    if (!pId) return;
    setLoadingIncident(true);
    setIncidentError(null);
    try {
      const res = await fetchPothole(pId);
      if (res && res.success && res.pothole) {
        if (onViewIncident) {
          onViewIncident(res.pothole);
        }
      } else {
        setIncidentError('Authoritative incident unavailable.');
      }
    } catch (err) {
      console.warn('Failed to load authoritative pothole:', err.message);
      setIncidentError('Authoritative incident unavailable.');
    } finally {
      setLoadingIncident(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        {/* DRAWER HEADER */}
        <div className="drawer-head">
          <div>
            <p className="eyebrow" style={{ color: '#c4b5fd' }}>
              <span style={{ background: '#a855f7' }}></span> NON-AUTHORITATIVE CANDIDATE
            </p>
            <h2>{cId}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close drawer">
            <X />
          </button>
        </div>

        {/* NON-AUTHORITATIVE ADVISORY */}
        <div style={{
          background: 'rgba(155, 108, 255, 0.1)',
          border: '1px solid rgba(155, 108, 255, 0.3)',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '16px',
          fontSize: '10px',
          color: '#c4b5fd',
          lineHeight: 1.45
        }}>
          <b>Pipeline State:</b> This is a candidate detection from transit fleet Edge sensors. It is evaluated and promoted into an authoritative municipal incident via 10m spatial fusion.
        </div>

        {/* ACTION CONTROLS BAR */}
        {canPromote && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button
              className="primary"
              style={{ flex: 1, background: '#00ffc4', color: '#000', fontWeight: 700, boxShadow: '0 0 15px rgba(0,255,196,0.3)' }}
              onClick={() => onPromote && onPromote(cId)}
              disabled={promoting}
            >
              <ArrowRight style={{ width: 14, height: 14 }} />
              {promoting ? 'Promoting via 10m Fusion...' : 'Promote to Authoritative Incident'}
            </button>
          </div>
        )}

        {/* CANDIDATE OVERVIEW GRID */}
        <div className="detail-grid" style={{ marginBottom: '18px' }}>
          <div>
            <small>Candidate ID</small>
            <b style={{ color: '#c4b5fd' }}>{cId}</b>
          </div>
          <div>
            <small>Edge Event ID</small>
            <b style={{ fontSize: '10px', wordBreak: 'break-all' }}>{candidate.edgeEventId || 'N/A'}</b>
          </div>
          <div>
            <small>Bus Unit</small>
            <b style={{ color: 'var(--text)' }}>{candidate.busId || 'RAAHI-01'}</b>
          </div>
          <div>
            <small>Delivery Status</small>
            <b style={{ color: '#3ee2a2', textTransform: 'capitalize' }}>{candidate.centralDeliveryStatus || 'received'}</b>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <small>Detection Recorded</small>
            <b>{timestampStr}</b>
          </div>
        </div>

        {/* EDGE YOLO DETECTION DETAILS */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Edge Detector Telemetry
          </div>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0 }}>
              <div>
                <small>Edge Class</small>
                <b style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{candidate.class || 'pothole'}</b>
              </div>
              <div>
                <small>Edge Model</small>
                <b>{candidate.edgeModel || 'YOLO11n'}</b>
              </div>
              <div>
                <small>Edge Confidence</small>
                <b style={{ color: '#3ee2a2' }}>{edgeConfPercent}</b>
              </div>
              <div>
                <small>Event Type</small>
                <b style={{ textTransform: 'capitalize' }}>{candidate.eventType || 'pothole'}</b>
              </div>
              {hasBbox && (
                <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                  <small>Bounding Box Coordinates</small>
                  <b style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--muted)' }}>
                    [{bbox.x1}, {bbox.y1}, {bbox.x2}, {bbox.y2}]
                  </b>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* GPS LOCATION SECTION */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Edge GPS Coordinates
          </div>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <small>Associated Coordinates</small>
                <b style={{ color: '#00ffc4' }}>{locationStr}</b>
              </div>
              {accuracy != null && (
                <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                  <small>GPS Sensor Accuracy</small>
                  <b style={{ color: '#ffb42d' }}>±{accuracy} meters</b>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* EVIDENCE SECTION */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Visual Evidence
          </div>
          {hasEvidence ? (
            <div style={{
              background: '#0a0e16',
              border: '1px solid #1e3a5f',
              borderRadius: '8px',
              padding: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.15)', display: 'grid', placeItems: 'center', color: '#38bdf8' }}>
                  <Film style={{ width: 16, height: 16 }} />
                </div>
                <div>
                  <b style={{ fontSize: '11px', color: '#f1f5f9', display: 'block' }}>Evidence Attached</b>
                  <small style={{ fontSize: '9px', color: 'var(--muted)' }}>Visual capture from vehicle cameras</small>
                </div>
              </div>
              <a
                href={candidate.evidenceReference}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary"
                style={{ fontSize: '10px', padding: '6px 10px', color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <ExternalLink style={{ width: 12, height: 12 }} /> View Evidence
              </a>
            </div>
          ) : (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px', textAlign: 'center', color: 'var(--muted)', fontSize: '10px' }}>
              No visual evidence attached to this candidate event.
            </div>
          )}
        </div>

        {/* PROMOTION / AUTHORITY RECORD (BIDIRECTIONAL LINEAGE) */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Authority &amp; Deduplication State
          </div>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px' }}>
            {isPromoted ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <span className="demo-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)', fontSize: '9px', fontWeight: 700 }}>
                      PROMOTED TO AUTHORITATIVE INCIDENT
                    </span>
                    <b style={{ display: 'block', fontSize: '14px', color: 'var(--text)', marginTop: '4px' }}>
                      {candidate.promotedToPotholeId}
                    </b>
                  </div>
                  <CheckCircle2 style={{ width: 22, height: 22, color: '#38bdf8' }} />
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '8px' }}>
                  <button
                    className="primary"
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, rgba(56,189,248,0.25) 0%, rgba(59,130,246,0.35) 100%)',
                      border: '1px solid #38bdf8',
                      color: 'var(--text)',
                      fontSize: '11px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      borderRadius: '6px'
                    }}
                    onClick={() => handleViewIncident(candidate.promotedToPotholeId)}
                    disabled={loadingIncident}
                    title="Open Authoritative Incident details drawer"
                  >
                    {loadingIncident ? (
                      <>
                        <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                        <span>Opening Incident...</span>
                      </>
                    ) : (
                      <>
                        <MapPinned style={{ width: 13, height: 13, color: '#38bdf8' }} />
                        <span>View Authoritative Incident ({candidate.promotedToPotholeId})</span>
                        <ArrowRight style={{ width: 12, height: 12, marginLeft: 'auto' }} />
                      </>
                    )}
                  </button>

                  {incidentError && (
                    <div style={{ color: '#ff6b81', fontSize: '10px', marginTop: '6px', textAlign: 'center' }}>
                      {incidentError}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <Clock style={{ width: 20, height: 20, color: '#ffb42d', margin: '0 auto 6px', display: 'block' }} />
                <b style={{ color: '#ffb42d', fontSize: '11px', display: 'block' }}>Pending Central Promotion</b>
                <p style={{ color: 'var(--muted)', fontSize: '10px', margin: '4px 0 0', lineHeight: 1.4 }}>
                  This candidate event is in the ingestion buffer. Promoting it will run 10m Haversine spatial fusion and assign it to an authoritative Pothole record.
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
