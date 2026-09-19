import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart3,
  BusFront,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileVideo,
  Layers,
  Layers3,
  Loader2,
  LocateFixed,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Video,
  Zap
} from 'lucide-react';
import { fetchPotholes, fetchPotholeStats, fetchCandidates } from '../../services/api';

/**
 * Central Analytics & Fusion
 * 
 * Authoritative Central intelligence engine for RAAHI Central Command Center.
 * Consumes strictly authoritative MongoDB endpoints:
 * - /api/potholes
 * - /api/potholes/stats
 * - /api/central/candidates
 * 
 * ZERO mock data. ZERO hard-coded metrics.
 */
export default function CentralAnalytics() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Authoritative State
  const [potholes, setPotholes] = useState([]);
  const [potholeStats, setPotholeStats] = useState({
    total: 0,
    open: 0,
    investigating: 0,
    repaired: 0,
    ignored: 0
  });
  const [candidates, setCandidates] = useState([]);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Load all authoritative data concurrently
  const loadData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [potholesRes, statsRes, candidatesRes] = await Promise.allSettled([
        fetchPotholes({ limit: 1000 }),
        fetchPotholeStats(),
        fetchCandidates({ limit: 1000 })
      ]);

      // Authoritative Potholes
      if (potholesRes.status === 'fulfilled' && potholesRes.value?.success) {
        setPotholes(potholesRes.value.potholes || []);
      } else if (potholesRes.status === 'rejected') {
        console.warn('[CentralAnalytics] Failed to fetch potholes:', potholesRes.reason?.message);
      }

      // Authoritative Pothole Stats
      if (statsRes.status === 'fulfilled' && statsRes.value?.success) {
        setPotholeStats(statsRes.value.stats || { total: 0, open: 0, investigating: 0, repaired: 0, ignored: 0 });
      } else if (statsRes.status === 'rejected') {
        console.warn('[CentralAnalytics] Failed to fetch pothole stats:', statsRes.reason?.message);
      }

      // Central Candidates
      if (candidatesRes.status === 'fulfilled' && candidatesRes.value?.success) {
        setCandidates(candidatesRes.value.candidates || []);
      } else if (candidatesRes.status === 'rejected') {
        console.warn('[CentralAnalytics] Failed to fetch candidates:', candidatesRes.reason?.message);
      }

      setLastRefreshed(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[CentralAnalytics] Critical error loading analytics:', err);
      setError(err.message || 'Failed to load authoritative Central analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ==========================================================================
  // DYNAMIC METRICS DERIVATIONS (Zero Hardcoding)
  // ==========================================================================

  // --- 1. Executive KPI Summary ---
  const totalIncidents = potholes.length;
  const fusedObservations = useMemo(() => {
    return potholes.reduce((sum, p) => sum + (Number(p.detectionCount) || 1), 0);
  }, [potholes]);

  const fusionRatio = totalIncidents > 0 ? (fusedObservations / totalIncidents).toFixed(2) : '0.00';

  const incidentsWithEvidence = useMemo(() => {
    return potholes.filter(p => {
      const v = p.videoUrl && String(p.videoUrl).trim();
      const e = p.evidenceReference && String(p.evidenceReference).trim();
      return Boolean(v || e);
    }).length;
  }, [potholes]);

  const evidenceCoveragePct = totalIncidents > 0
    ? ((incidentsWithEvidence / totalIncidents) * 100).toFixed(1)
    : '0.0';

  // --- 2. Candidate Funnel ---
  const totalCandidates = candidates.length;
  const candidateFunnel = useMemo(() => {
    const promoted = candidates.filter(c => c.promotedToPotholeId != null).length;
    const pending = totalCandidates - promoted;
    return { total: totalCandidates, pending, promoted };
  }, [candidates, totalCandidates]);

  // --- 3. Incident Lifecycle Distribution ---
  const lifecycleStats = useMemo(() => {
    const total = potholeStats.total || totalIncidents || 0;
    const open = potholeStats.open || 0;
    const investigating = potholeStats.investigating || 0;
    const repaired = potholeStats.repaired || 0;
    const ignored = potholeStats.ignored || 0;

    const calcPct = (val) => (total > 0 ? ((val / total) * 100).toFixed(1) : '0.0');

    return [
      { key: 'open', label: 'Open Hazards', count: open, pct: calcPct(open), color: '#ff4d6d', bg: 'rgba(255, 77, 109, 0.15)' },
      { key: 'investigating', label: 'Investigating', count: investigating, pct: calcPct(investigating), color: '#ffb42d', bg: 'rgba(255, 180, 45, 0.15)' },
      { key: 'repaired', label: 'Repaired', count: repaired, pct: calcPct(repaired), color: '#3ee2a2', bg: 'rgba(62, 226, 162, 0.15)' },
      { key: 'ignored', label: 'Ignored / Filtered', count: ignored, pct: calcPct(ignored), color: 'var(--muted)', bg: 'rgba(142, 154, 177, 0.15)' }
    ];
  }, [potholeStats, totalIncidents]);

  // --- 4. 10m Spatial Fusion & Cross-Bus Metrics ---
  const fusionMetrics = useMemo(() => {
    let crossBusCount = 0;
    let singleBusCount = 0;
    let repeatDetectionsEliminated = 0;
    let maxFleetConvergence = 0;

    potholes.forEach(p => {
      const buses = Array.isArray(p.busesDetectedBy) ? p.busesDetectedBy : [];
      const count = Number(p.detectionCount) || 1;

      if (buses.length >= 2) {
        crossBusCount += 1;
      } else {
        singleBusCount += 1;
      }

      repeatDetectionsEliminated += Math.max(0, count - 1);
      if (buses.length > maxFleetConvergence) {
        maxFleetConvergence = buses.length;
      }
    });

    const crossBusPct = totalIncidents > 0
      ? ((crossBusCount / totalIncidents) * 100).toFixed(1)
      : '0.0';

    const singleBusPct = totalIncidents > 0
      ? ((singleBusCount / totalIncidents) * 100).toFixed(1)
      : '0.0';

    return {
      crossBusCount,
      crossBusPct,
      singleBusCount,
      singleBusPct,
      repeatDetectionsEliminated,
      maxFleetConvergence
    };
  }, [potholes, totalIncidents]);

  // --- 5. Edge Detector Confidence Telemetry ---
  const edgeConfidenceTelemetry = useMemo(() => {
    const validScores = potholes
      .map(p => p.confidence)
      .filter(c => typeof c === 'number' && !isNaN(c))
      .map(c => (c > 1 ? c / 100 : c));

    if (validScores.length === 0) {
      return { mean: null, min: null, max: null, count: 0 };
    }

    const sum = validScores.reduce((a, b) => a + b, 0);
    const mean = sum / validScores.length;
    const min = Math.min(...validScores);
    const max = Math.max(...validScores);

    return {
      mean: (mean * 100).toFixed(1),
      min: (min * 100).toFixed(1),
      max: (max * 100).toFixed(1),
      count: validScores.length
    };
  }, [potholes]);

  // --- 6. Defect Classification Breakdown ---
  const classBreakdown = useMemo(() => {
    const counts = {};
    potholes.forEach(p => {
      const raw = (p.verifiedClass || p.class || 'pothole').trim().toLowerCase();
      counts[raw] = (counts[raw] || 0) + 1;
    });

    const formatLabel = (c) => {
      if (c === 'pothole') return 'Pothole';
      if (c === 'road_damage') return 'Road Damage / Crack';
      return c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ');
    };

    return Object.entries(counts).map(([cls, count]) => {
      const pct = totalIncidents > 0 ? ((count / totalIncidents) * 100).toFixed(1) : '0.0';
      return {
        key: cls,
        label: formatLabel(cls),
        count,
        pct
      };
    });
  }, [potholes, totalIncidents]);

  // --- 7. Fleet Bus Contribution ---
  const busContribution = useMemo(() => {
    const busMap = {};

    potholes.forEach(p => {
      const buses = Array.isArray(p.busesDetectedBy) && p.busesDetectedBy.length > 0
        ? p.busesDetectedBy
        : ['Unknown'];

      buses.forEach(busId => {
        if (!busMap[busId]) {
          busMap[busId] = {
            busId,
            incidentsContributed: 0,
            multiBusCount: 0,
            clusterObservations: 0
          };
        }
        busMap[busId].incidentsContributed += 1;
        busMap[busId].clusterObservations += Number(p.detectionCount) || 1;
        if (buses.length >= 2) {
          busMap[busId].multiBusCount += 1;
        }
      });
    });

    return Object.values(busMap).sort((a, b) => b.incidentsContributed - a.incidentsContributed);
  }, [potholes]);

  // ==========================================================================
  // RENDER LOADING & ERROR STATES
  // ==========================================================================

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 className="spinning" style={{ width: 38, height: 38, color: '#3b8cff', marginBottom: 16 }} />
        <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Loading Authoritative Central Analytics...</h3>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>Querying MongoDB Potholes and Candidates</p>
      </div>
    );
  }

  if (error && totalIncidents === 0) {
    return (
      <div className="page">
        <div className="panel" style={{ padding: 28, textAlign: 'center', border: '1px solid rgba(255, 77, 109, 0.3)', background: 'var(--panel)' }}>
          <ShieldAlert style={{ width: 42, height: 42, color: '#ff4d6d', margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 8px', color: '#ff8098', fontSize: 18 }}>Failed to Load Central Analytics</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 500, margin: '0 auto 18px' }}>{error}</p>
          <button className="primary" onClick={() => loadData(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw style={{ width: 14 }} /> Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* PAGE HEADER */}
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <p className="eyebrow" style={{ margin: 0 }}>CENTRAL INTELLIGENCE & TELEMETRY</p>
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: 'rgba(59, 140, 255, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 140, 255, 0.3)' }}>
              AUTHORITATIVE
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text)' }}>Central Analytics & Fusion</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)', maxWidth: 720 }}>
            Authoritative infrastructure intelligence derived from verified physical incidents, 10m Haversine spatial fusion, and transit fleet Edge telemetry.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefreshed && (
            <span style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock style={{ width: 12 }} /> Refreshed {lastRefreshed}
            </span>
          )}
          <button
            className="secondary"
            onClick={() => loadData(true)}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', fontSize: 11, fontWeight: 700 }}
          >
            <RefreshCw className={refreshing ? 'spinning' : ''} style={{ width: 14 }} />
            {refreshing ? 'Syncing...' : 'Refresh Central Data'}
          </button>
        </div>
      </div>

      {/* PANEL 1: EXECUTIVE KPI SUMMARY */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 16 }}>
        {/* Metric 1 */}
        <div className="panel" style={{ padding: '16px 18px', borderLeft: '4px solid #3b8cff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Authoritative Incidents
            </span>
            <Database style={{ width: 16, color: '#3b8cff' }} />
          </div>
          <strong style={{ display: 'block', fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.1 }}>
            {totalIncidents}
          </strong>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Unique physical hazards</span>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(59, 140, 255, 0.15)', color: 'var(--blue)', border: '1px solid rgba(59, 140, 255, 0.3)' }}>
              MONGODB
            </span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="panel" style={{ padding: '16px 18px', borderLeft: '4px solid #9b6cff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Fused Observations
            </span>
            <Layers3 style={{ width: 16, color: '#9b6cff' }} />
          </div>
          <strong style={{ display: 'block', fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.1 }}>
            {fusedObservations}
          </strong>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Raw fleet observations</span>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(155, 108, 255, 0.15)', color: 'var(--purple)', border: '1px solid rgba(155, 108, 255, 0.3)' }}>
              10M FUSION
            </span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="panel" style={{ padding: '16px 18px', borderLeft: '4px solid #3ee2a2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Fusion Multiplicity
            </span>
            <TrendingUp style={{ width: 16, color: '#3ee2a2' }} />
          </div>
          <strong style={{ display: 'block', fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.1 }}>
            {totalIncidents > 0 ? `${fusionRatio}x` : '—'}
          </strong>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Observations per physical hazard</span>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--tag-real-bg)', color: 'var(--tag-real-color)', border: '1px solid var(--tag-real-border)' }}>
              CONVERGENCE
            </span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="panel" style={{ padding: '16px 18px', borderLeft: '4px solid #ffb42d' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Evidence Coverage
            </span>
            <FileVideo style={{ width: 16, color: '#ffb42d' }} />
          </div>
          <strong style={{ display: 'block', fontSize: 28, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.1 }}>
            {totalIncidents > 0 ? `${evidenceCoveragePct}%` : '—'}
          </strong>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{incidentsWithEvidence} of {totalIncidents} with media</span>
            <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--tag-demo-bg)', color: 'var(--tag-demo-color)', border: '1px solid var(--tag-demo-border)' }}>
              ARCHIVE
            </span>
          </div>
        </div>
      </div>

      {/* TWO-COLUMN WORKSPACE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>
        
        {/* PANEL 2: CANDIDATE INGESTION & PROMOTION FUNNEL */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <p className="eyebrow" style={{ margin: 0 }}>CENTRAL PIPELINE</p>
                <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(155, 108, 255, 0.15)', color: 'var(--purple)', border: '1px solid rgba(155, 108, 255, 0.3)' }}>
                  INGESTION BUFFER
                </span>
              </div>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Candidate Ingestion & Promotion Pipeline</h3>
            </div>
            <Cpu style={{ width: 18, color: '#9b6cff' }} />
          </div>

          {/* Funnel Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 9, color: '#7f8ca3', marginBottom: 3 }}>Total Candidates</span>
              <b style={{ fontSize: 18, color: 'var(--text)' }}>{totalCandidates}</b>
            </div>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 9, color: '#ffb42d', marginBottom: 3 }}>Pending Promotion</span>
              <b style={{ fontSize: 18, color: '#ffb42d' }}>{candidateFunnel.pending}</b>
            </div>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 9, color: '#60a5fa', marginBottom: 3 }}>Promoted Incidents</span>
              <b style={{ fontSize: 18, color: '#60a5fa' }}>{candidateFunnel.promoted}</b>
            </div>
          </div>

          {/* Empty State or Funnel Details */}
          {totalCandidates === 0 ? (
            <div style={{ padding: '14px 16px', background: 'var(--panel2)', border: '1px dashed var(--line)', borderRadius: 8, textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
                No candidate events received yet. Edge event packages sent to <code style={{ color: '#60a5fa' }}>POST /api/central/events</code> will enter this buffer for promotion.
              </p>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
              <span>Pipeline promotion rate: </span>
              <b style={{ color: 'var(--text)' }}>
                {totalCandidates > 0 ? `${((candidateFunnel.promoted / totalCandidates) * 100).toFixed(1)}%` : '0%'}
              </b>
              <span> of incoming Edge detections promoted to authoritative incidents via 10m spatial fusion.</span>
            </div>
          )}
        </div>

        {/* PANEL 3: INCIDENT LIFECYCLE */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>AUTHORITATIVE STATUS</p>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Incident Lifecycle Distribution</h3>
            </div>
            <ShieldCheck style={{ width: 18, color: '#3ee2a2' }} />
          </div>

          <div style={{ display: 'grid', gap: 11 }}>
            {lifecycleStats.map(item => (
              <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 45px 45px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#dce5f7', fontWeight: 600 }}>{item.label}</span>
                <div style={{ height: 8, background: 'var(--panel2)', borderRadius: 99, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${item.pct}%`,
                      background: item.color,
                      borderRadius: 99,
                      transition: 'width 0.4s ease'
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 800, textAlign: 'right' }}>{item.count}</span>
                <span style={{ fontSize: 9, color: '#7f8ca3', textAlign: 'right' }}>{item.pct}%</span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Total Authoritative Lifecycle Records</span>
            <b style={{ fontSize: 12, color: 'var(--text)' }}>{potholeStats.total || totalIncidents}</b>
          </div>
        </div>

      </div>

      {/* FULL-WIDTH SPATIAL FUSION & TELEMETRY SECTION */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>

        {/* PANEL 4: 10M SPATIAL FUSION & CROSS-BUS METRICS */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <p className="eyebrow" style={{ margin: 0 }}>GEOSPATIAL DEDUPLICATION</p>
                <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'var(--tag-real-bg)', color: 'var(--tag-real-color)', border: '1px solid var(--tag-real-border)' }}>
                  10M HAVERSINE CLUSTER
                </span>
              </div>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Cross-Bus Spatial Fusion Intelligence</h3>
            </div>
            <LocateFixed style={{ width: 18, color: '#3ee2a2' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <span style={{ display: 'block', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Multi-Bus Confirmed
              </span>
              <strong style={{ display: 'block', fontSize: 24, color: '#3ee2a2', margin: '4px 0 2px' }}>
                {fusionMetrics.crossBusCount}
              </strong>
              <small style={{ fontSize: 10, color: '#7f8ca3' }}>{fusionMetrics.crossBusPct}% of authoritative incidents</small>
            </div>

            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <span style={{ display: 'block', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Single-Bus Only
              </span>
              <strong style={{ display: 'block', fontSize: 24, color: '#60a5fa', margin: '4px 0 2px' }}>
                {fusionMetrics.singleBusCount}
              </strong>
              <small style={{ fontSize: 10, color: '#7f8ca3' }}>{fusionMetrics.singleBusPct}% awaiting independent confirmation</small>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <span style={{ display: 'block', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Repeat Detections Eliminated
              </span>
              <strong style={{ display: 'block', fontSize: 22, color: '#c4b5fd', margin: '4px 0 2px' }}>
                {fusionMetrics.repeatDetectionsEliminated}
              </strong>
              <small style={{ fontSize: 10, color: '#7f8ca3' }}>Redundant reports prevented</small>
            </div>

            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <span style={{ display: 'block', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Max Fleet Convergence
              </span>
              <strong style={{ display: 'block', fontSize: 22, color: '#ffb42d', margin: '4px 0 2px' }}>
                {fusionMetrics.maxFleetConvergence} {fusionMetrics.maxFleetConvergence === 1 ? 'Bus' : 'Buses'}
              </strong>
              <small style={{ fontSize: 10, color: '#7f8ca3' }}>Highest cross-bus confirmation depth</small>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, background: 'var(--panel2)', padding: 10, borderRadius: 6, border: '1px solid var(--line)' }}>
            <CircleHelp style={{ width: 12, display: 'inline', verticalAlign: 'text-bottom', marginRight: 4, color: '#3ee2a2' }} />
            Cluster deduplication merges candidate observations occurring within 10 meters (spherical Haversine). Exact spatial distances are evaluated at ingestion time; cluster convergence is tracked through detection counts and unique fleet identifiers.
          </p>
        </div>

        {/* PANEL 5: CONFIDENCE TELEMETRY (EDGE YOLO ASSURANCE) */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>MODEL ASSURANCE</p>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Edge Detector Confidence Telemetry</h3>
            </div>
            <Zap style={{ width: 18, color: '#ffb42d' }} />
          </div>

          {/* TELEMETRY CARD 1: EDGE YOLO */}
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Edge YOLO Detection Confidence
              </span>
              <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(59, 140, 255, 0.15)', color: 'var(--blue)', border: '1px solid rgba(59, 140, 255, 0.3)' }}>
                EDGE YOLO11n
              </span>
            </div>

            {edgeConfidenceTelemetry.mean != null ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <strong style={{ fontSize: 32, color: 'var(--text)', letterSpacing: '-0.03em' }}>
                    {edgeConfidenceTelemetry.mean}%
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Mean Detection Score</span>
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: '#7f8ca3' }}>
                  <span>Min: <b style={{ color: '#dce5f7' }}>{edgeConfidenceTelemetry.min}%</b></span>
                  <span>Max: <b style={{ color: '#dce5f7' }}>{edgeConfidenceTelemetry.max}%</b></span>
                  <span>Sample Size: <b style={{ color: '#dce5f7' }}>{edgeConfidenceTelemetry.count}</b> authoritative incidents</span>
                </div>
              </div>
            ) : (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)' }}>No Edge confidence scores recorded.</p>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 9, color: 'var(--muted)' }}>
            * Edge detection confidence represents raw YOLO11n inference certainty recorded on fleet vehicle Edge devices.
          </div>
        </div>

      </div>

      {/* LOWER SECTION: DEFECT CLASSIFICATION & FLEET CONTRIBUTION */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 14 }}>

        {/* PANEL 6: DEFECT CLASSIFICATION & EVIDENCE */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>AUTHORITATIVE TAXONOMY</p>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Defect Classification & Media</h3>
            </div>
            <BarChart3 style={{ width: 18, color: '#3b8cff' }} />
          </div>

          {/* Class Breakdown List */}
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
              Verified Defect Types
            </span>
            {classBreakdown.length > 0 ? (
              <div style={{ display: 'grid', gap: 9 }}>
                {classBreakdown.map(item => (
                  <div key={item.key} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 35px 45px', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#dce5f7', fontWeight: 600 }}>{item.label}</span>
                    <div style={{ height: 8, background: 'var(--panel2)', borderRadius: 99, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${item.pct}%`,
                          background: 'linear-gradient(90deg, #3b8cff, #9b6cff)',
                          borderRadius: 99
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 800, textAlign: 'right' }}>{item.count}</span>
                    <span style={{ fontSize: 9, color: '#7f8ca3', textAlign: 'right' }}>{item.pct}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>No authoritative classifications recorded.</p>
            )}
          </div>

          {/* Evidence Coverage Card */}
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#ffb42d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Video Evidence Archive
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#ffb42d' }}>{evidenceCoveragePct}% Verified</span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
              <div
                style={{
                  height: '100%',
                  width: `${evidenceCoveragePct}%`,
                  background: '#ffb42d',
                  borderRadius: 99
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
              <span>Backed by video archive:</span>
              <b style={{ color: 'var(--text)' }}>{incidentsWithEvidence} of {totalIncidents} incidents</b>
            </div>
          </div>
        </div>

        {/* PANEL 7: FLEET BUS CONTRIBUTION */}
        <div className="panel" style={{ padding: 18 }}>
          <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <p className="eyebrow" style={{ margin: 0 }}>FLEET ATTRIBUTION</p>
                <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: 'rgba(59, 140, 255, 0.15)', color: 'var(--blue)', border: '1px solid rgba(59, 140, 255, 0.3)' }}>
                  CENTRAL DB RECORDS
                </span>
              </div>
              <h3 style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text)' }}>Reporting Bus Contribution</h3>
            </div>
            <BusFront style={{ width: 18, color: '#60a5fa' }} />
          </div>

          {busContribution.length > 0 ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', padding: '0 8px 8px', borderBottom: '1px solid var(--line)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>
                <span>Bus ID</span>
                <span style={{ textAlign: 'right' }}>Incidents</span>
                <span style={{ textAlign: 'right' }}>Cross-Bus</span>
                <span style={{ textAlign: 'right' }}>Cluster Obs</span>
              </div>

              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {busContribution.map(bus => (
                  <div
                    key={bus.busId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
                      alignItems: 'center',
                      padding: '8px 8px',
                      borderRadius: 6,
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      fontSize: 11
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--text)' }}>
                      <BusFront style={{ width: 13, color: '#3b8cff' }} />
                      {bus.busId}
                    </span>
                    <span style={{ textAlign: 'right', fontWeight: 800, color: 'var(--text)' }}>
                      {bus.incidentsContributed}
                    </span>
                    <span style={{ textAlign: 'right', color: '#3ee2a2', fontWeight: 600 }}>
                      {bus.multiBusCount}
                    </span>
                    <span style={{ textAlign: 'right', color: '#c4b5fd', fontWeight: 600 }}>
                      {bus.clusterObservations}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ margin: '14px 0', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              No bus identifiers recorded in authoritative incidents yet.
            </p>
          )}

          <p style={{ margin: '14px 0 0', fontSize: 9, color: 'var(--muted)', lineHeight: 1.4 }}>
            * Authoritative bus attribution derived strictly from MongoDB <code style={{ color: '#60a5fa' }}>busesDetectedBy</code> records. Individual detection logs are consolidated into 10m cluster totals upon promotion.
          </p>
        </div>

      </div>
    </div>
  );
}
