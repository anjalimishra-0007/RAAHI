import React, { useState } from 'react';
import {
  X,
  Film,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  MapPinned,
  BusFront,
  ArrowRight,
  Layers3,
  Calendar,
  Layers,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2
} from 'lucide-react';
import { fetchCandidate } from '../../services/api';

/**
 * IncidentDrawer Component (Rich Authoritative Incident Lineage)
 *
 * Explains the full provenance of an authoritative incident:
 * 1. Authoritative Incident Header & Municipal Status Management
 * 2. Cross-Bus Fusion (10m Haversine Cluster, Detection Count, Fleet Buses)
 * 3. Original Edge Detection Telemetry (Model, Class, Confidence, Edge Event UUID)
 * 4. Source Candidate Relationship (with optional on-demand candidate inspection)
 * 5. GPS Location & Sensor Accuracy (from Edge sensors)
 * 6. Visual Evidence (Google Drive / Web link)
 * 7. Pipeline Lineage Trace (Edge → Candidate → Promotion → 10m Fusion → Pothole)
 */
export default function IncidentDrawer({
  incident,
  onClose,
  onStatusUpdate,
  onViewCandidate
}) {
  if (!incident) return null;

  const isMongoPothole = !!incident.potholeId;
  const pId = incident.potholeId || incident.id || 'INCIDENT';
  const status = (incident.status || 'open').toLowerCase();

  // On-demand source candidate inspection state
  const [candidateDetail, setCandidateDetail] = useState(null);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [candidateError, setCandidateError] = useState(null);

  // Confidence formatters
  const edgeConfPercent = incident.confidence != null
    ? `${Math.round(incident.confidence > 1 ? incident.confidence : incident.confidence * 100)}%`
    : 'Not recorded';

  // Fleet & Cross-Bus Fusion counts
  const detCount = incident.detectionCount || 1;
  const busesList = (Array.isArray(incident.busesDetectedBy) && incident.busesDetectedBy.length > 0)
    ? incident.busesDetectedBy.join(', ')
    : (incident.bus || 'RAAHI-01');

  // Location & Timestamps
  const lat = incident.location?.latitude ?? incident.lat;
  const lng = incident.location?.longitude ?? incident.lng;
  const gpsAccuracy = incident.location?.accuracy;
  const addressStr = incident.address && incident.address.trim() !== ''
    ? incident.address
    : (typeof lat === 'number' && typeof lng === 'number' ? `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Not recorded');

  const firstDetected = incident.firstDetectedAt
    ? new Date(incident.firstDetectedAt).toLocaleString()
    : 'Not recorded';
  const lastDetected = incident.lastDetectedAt
    ? new Date(incident.lastDetectedAt).toLocaleString()
    : 'Not recorded';

  const hasEvidence = !!(incident.videoUrl && incident.videoUrl.trim() !== '');

  // Municipal status options matching backend enum
  const statusOptions = [
    { key: 'open', label: 'Open', color: '#ff4d6d', bg: 'rgba(255, 77, 109, 0.12)', border: 'rgba(255, 77, 109, 0.4)' },
    { key: 'investigating', label: 'Investigating', color: '#ffb42d', bg: 'rgba(255, 180, 45, 0.12)', border: 'rgba(255, 180, 45, 0.4)' },
    { key: 'repaired', label: 'Repaired', color: '#3ee2a2', bg: 'rgba(62, 226, 162, 0.12)', border: 'rgba(62, 226, 162, 0.4)' },
    { key: 'ignored', label: 'Ignored', color: '#8e9ab1', bg: 'rgba(142, 154, 177, 0.12)', border: 'rgba(142, 154, 177, 0.4)' }
  ];

  // Phase 6C: Bidirectional Source Candidate navigation
  const handleOpenSourceCandidate = async () => {
    const cId = incident.sourceCandidateId;
    if (!cId) return;

    setLoadingCandidate(true);
    setCandidateError(null);
    try {
      const res = await fetchCandidate(cId);
      if (res && res.success && res.candidate) {
        if (onViewCandidate) {
          onViewCandidate(res.candidate);
        } else {
          setCandidateDetail(res.candidate);
        }
      } else {
        setCandidateError('Source candidate unavailable.');
      }
    } catch (err) {
      console.warn('Failed to load candidate record:', err.message);
      setCandidateError('Source candidate unavailable.');
    } finally {
      setLoadingCandidate(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        {/* ============================================================ */}
        {/* PART 2: AUTHORITATIVE INCIDENT HEADER                        */}
        {/* ============================================================ */}
        <div className="drawer-head">
          <div>
            <p className="eyebrow" style={{ color: '#38bdf8' }}>
              <span style={{ background: '#38bdf8' }}></span> AUTHORITATIVE MUNICIPAL INCIDENT
            </p>
            <h2>{pId}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close drawer">
            <X />
          </button>
        </div>

        {/* LINEAGE ADVISORY BANNER */}
        <div style={{
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '16px',
          fontSize: '10px',
          color: '#cbd5e1',
          lineHeight: 1.45
        }}>
          <b style={{ color: '#38bdf8' }}>Authoritative Record:</b> Ingested from fleet Edge detection and fused via 10-meter geospatial clustering. This defect represents authoritative road infrastructure intelligence.
        </div>

        {/* ============================================================ */}
        {/* PART 13: MUNICIPAL STATUS MANAGEMENT CONTROLS                */}
        {/* ============================================================ */}
        {isMongoPothole && (
          <div style={{ marginBottom: '18px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              Municipal Incident Status
            </div>
            <div className="status-control-grid">
              {statusOptions.map(opt => (
                <button
                  key={opt.key}
                  className={`status-control-btn ${status === opt.key ? 'active' : ''}`}
                  style={{
                    '--sc-color': opt.color,
                    '--sc-bg': status === opt.key ? opt.bg : 'transparent',
                    '--sc-border': status === opt.key ? opt.border : '#1e2636'
                  }}
                  onClick={() => {
                    if (status !== opt.key && onStatusUpdate) {
                      onStatusUpdate(pId, opt.key);
                    }
                  }}
                  title={status === opt.key ? `Current status: ${opt.label}` : `Change to ${opt.label}`}
                >
                  <span className="status-control-dot" style={{ background: opt.color }} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* PART 3: INCIDENT SUMMARY                                     */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Incident Summary
          </div>
          <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <small>Incident ID</small>
                <b style={{ color: '#fff' }}>{pId}</b>
              </div>
              <div>
                <small>Authoritative Classification</small>
                <b style={{ color: '#ffb42d', textTransform: 'capitalize' }}>
                  {incident.verifiedClass || incident.class || 'Pothole'}
                </b>
              </div>
              <div>
                <small>Current Status</small>
                <b style={{ textTransform: 'uppercase' }}>
                  <span className={`status-pill ${status}`}>{status}</span>
                </b>
              </div>
              <div>
                <small>Overall Confidence</small>
                <b style={{ color: '#3ee2a2' }}>{edgeConfPercent}</b>
              </div>
              <div>
                <small>Event Domain</small>
                <b style={{ color: '#94a3b8' }}>{incident.eventType || 'pothole'}</b>
              </div>
              <div>
                <small>Cluster Size</small>
                <b>{detCount} {detCount === 1 ? 'detection' : 'detections'}</b>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* PART 4: CROSS-BUS FUSION & 10m CLUSTERING                    */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Cross-Bus Spatial Fusion
            </span>
            <span className="demo-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)', fontSize: '8px' }}>
              10M HAVERSINE CLUSTER
            </span>
          </div>

          <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <small>Fused observations</small>
                <b style={{ color: '#38bdf8', fontSize: '13px' }}>{detCount}</b>
              </div>
              <div>
                <small>Reporting buses</small>
                <b style={{ color: '#fff', fontSize: '11px' }}>{busesList}</b>
              </div>
              <div>
                <small>First Detected</small>
                <b style={{ fontSize: '9px', color: '#94a3b8' }}>{firstDetected}</b>
              </div>
              <div>
                <small>Latest Detection</small>
                <b style={{ fontSize: '9px', color: '#94a3b8' }}>{lastDetected}</b>
              </div>
            </div>

            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #1a2230', fontSize: '9px', color: '#94a3b8', lineHeight: 1.4 }}>
              Observations fused within 10m Central Haversine deduplication radius across fleet telemetry passes.
            </div>

            {Array.isArray(incident.busesDetectedBy) && incident.busesDetectedBy.length > 1 && (
              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: '#3ee2a2' }}>
                <CheckCircle2 style={{ width: 12, height: 12 }} />
                <span>Multi-bus confirmed across {incident.busesDetectedBy.length} distinct vehicles.</span>
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PART 5: ORIGINAL EDGE YOLO TELEMETRY                         */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Original Edge YOLO Telemetry
          </div>

          <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div>
                <small>Edge Model</small>
                <b style={{ color: '#fff' }}>{incident.edgeModel || 'YOLO11n'}</b>
              </div>
              <div>
                <small>Original Edge Class</small>
                <b style={{ color: '#c4b5fd', textTransform: 'capitalize' }}>
                  {incident.class || 'pothole'}
                </b>
              </div>
              <div>
                <small>Edge Confidence</small>
                <b style={{ color: '#3ee2a2' }}>{edgeConfPercent}</b>
              </div>
              <div style={{ gridColumn: 'span 3', marginTop: '6px' }}>
                <small>Edge Event UUID</small>
                <b style={{ fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8', wordBreak: 'break-all' }}>
                  {incident.edgeEventId || 'Not recorded'}
                </b>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* PART 7: SOURCE CANDIDATE RELATIONSHIP (LINEAGE)              */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Source Candidate Lineage
          </div>

          <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
              <div>
                <small style={{ fontSize: '8px', color: '#69768c', display: 'block' }}>Source Candidate ID (Non-Authoritative Source)</small>
                <b style={{ color: '#c4b5fd', fontSize: '12px', fontFamily: 'monospace' }}>
                  {incident.sourceCandidateId || 'Not linked to single candidate'}
                </b>
              </div>

              {incident.sourceCandidateId ? (
                <button
                  className="table-action-btn"
                  onClick={handleOpenSourceCandidate}
                  disabled={loadingCandidate}
                  style={{ background: 'rgba(196, 181, 253, 0.15)', border: '1px solid rgba(196, 181, 253, 0.35)', color: '#c4b5fd', padding: '6px 10px' }}
                  title="Open source CandidateEvent in CandidateDrawer"
                >
                  {loadingCandidate ? (
                    <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <ArrowRight style={{ width: 12, height: 12 }} />
                  )}
                  <span>View Candidate</span>
                </button>
              ) : (
                <span style={{ fontSize: '9px', color: '#64748b' }}>No candidate link</span>
              )}
            </div>

            <div className="detail-grid" style={{ border: 0, padding: 0, gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <small>Edge Event UUID</small>
                <b style={{ fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8' }}>
                  {incident.edgeEventId || 'Not recorded'}
                </b>
              </div>
              <div>
                <small>Authoritative Class</small>
                <b style={{ color: '#ffb42d', textTransform: 'capitalize' }}>
                  {incident.class || 'pothole'}
                </b>
              </div>
            </div>

            {!incident.sourceCandidateId && (
              <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #1a2230', fontSize: '9px', color: '#64748b', lineHeight: 1.4 }}>
                This record pre-dates candidate pipeline ingestion or was ingested directly into the municipal layer.
              </div>
            )}

            {candidateError && (
              <div style={{ marginTop: '8px', color: '#ff6b81', fontSize: '9px', background: 'rgba(255, 107, 129, 0.1)', border: '1px solid rgba(255, 107, 129, 0.3)', padding: '6px 8px', borderRadius: '4px' }}>
                {candidateError}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* PART 9: GPS & SENSOR LOCATION                                */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            GPS &amp; Location
          </div>

          <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px' }}>
            <div className="detail-grid" style={{ border: 0, padding: 0, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <small>Latitude</small>
                <b style={{ color: '#00ffc4', fontSize: '11px' }}>{typeof lat === 'number' ? lat.toFixed(6) : 'Not recorded'}</b>
              </div>
              <div>
                <small>Longitude</small>
                <b style={{ color: '#00ffc4', fontSize: '11px' }}>{typeof lng === 'number' ? lng.toFixed(6) : 'Not recorded'}</b>
              </div>
              {gpsAccuracy != null && (
                <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                  <small>GPS Accuracy</small>
                  <b style={{ color: '#ffb42d' }}>±{gpsAccuracy}m</b>
                </div>
              )}
              <div style={{ gridColumn: 'span 2', marginTop: '4px' }}>
                <small>Reverse Geocoded Address</small>
                <b style={{ fontSize: '11px', lineHeight: 1.4, color: '#cbd5e1' }}>{addressStr}</b>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* PART 10: VISUAL EVIDENCE                                     */}
        {/* ============================================================ */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Visual Evidence
            </span>
            {hasEvidence && (
              <span className="real-tag" style={{ fontSize: '8px' }}>GOOGLE DRIVE</span>
            )}
          </div>

          {hasEvidence ? (
            <div style={{
              background: 'linear-gradient(180deg, #0c1421 0%, #080d17 100%)',
              border: '1px solid #1e3a5f',
              borderRadius: '8px',
              padding: '14px',
              textAlign: 'center'
            }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', display: 'grid', placeItems: 'center', margin: '0 auto 8px', color: '#38bdf8' }}>
                <Film style={{ width: 18, height: 18 }} />
              </div>
              <b style={{ display: 'block', fontSize: '11px', color: '#f1f5f9', marginBottom: '2px' }}>
                Evidence Clip Available
              </b>
              <small style={{ display: 'block', color: '#94a3b8', fontSize: '9px', marginBottom: '10px' }}>
                A 5-second verified evidence video clip is stored and linked to this incident.
              </small>
              <a
                href={incident.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="primary full"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: '11px',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <ExternalLink style={{ width: 12, height: 12 }} /> Open Evidence
              </a>
            </div>
          ) : (
            <div style={{ background: '#0a0e16', border: '1px solid #1e2636', borderRadius: '8px', padding: '12px', textAlign: 'center', color: '#8e9ab1' }}>
              <span style={{ fontSize: '10px', display: 'block', fontWeight: 600 }}>No evidence attached</span>
              <small style={{ fontSize: '9px', color: '#5f6d84', marginTop: '2px', display: 'block' }}>
                No video clip is uploaded for this pothole incident yet.
              </small>
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* PART 11: PIPELINE LINEAGE TRACE                              */}
        {/* ============================================================ */}
        <div style={{ marginTop: '22px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: '#8e9ab1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Pipeline Architecture Provenance
          </div>
          <div className="drawer-flow" style={{ margin: 0 }}>
            <span>1. Edge Detection</span>
            <i>→</i>
            <span>2. Candidate Event</span>
            <i>→</i>
            <span>3. Central Promotion</span>
            <i>→</i>
            <span>4. 10m Spatial Fusion</span>
            <i>→</i>
            <span style={{ border: '1px solid #38bdf8', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', fontWeight: 700 }}>
              5. Authoritative Pothole
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
