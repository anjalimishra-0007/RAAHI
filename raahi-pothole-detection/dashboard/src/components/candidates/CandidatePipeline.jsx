import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  Loader2,
  ArrowRight,
  Eye,
  Bus
} from 'lucide-react';
import StatCard from '../StatCard';
import CandidateDrawer from './CandidateDrawer';
import {
  fetchCandidates,
  promoteCandidate
} from '../../services/api';

/**
 * Candidate Pipeline Component
 *
 * Operational Command Center view for pre-authoritative Candidate Events:
 * - Real API integration with /api/central/candidates
 * - StatCards calculated from real candidate data
 * - Filter bar (All, Pending, Promoted)
 * - Candidate queue table showing canonical Edge YOLO telemetry
 * - One-click promotion to authoritative Pothole via 10m Haversine fusion
 * - Deep candidate inspection drawer with bidirectional lineage
 */
export default function CandidatePipeline({
  setToast,
  onSelectCandidate,
  onViewIncident
}) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filter state: 'all' | 'pending' | 'promoted'
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  // Selected candidate for drawer (delegated to parent if onSelectCandidate is provided)
  const [localSelectedCandidate, setLocalSelectedCandidate] = useState(null);
  const selectedCandidate = onSelectCandidate ? null : localSelectedCandidate;
  const setSelectedCandidate = onSelectCandidate || setLocalSelectedCandidate;

  // Action processing state tracking by candidateId
  const [actionLoading, setActionLoading] = useState({});

  const notify = (msg) => {
    if (typeof setToast === 'function') {
      setToast(msg);
    }
  };

  // 1. Fetch Candidates from Central API
  const loadCandidates = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const data = await fetchCandidates({ limit: 200 });
      if (data && data.success && Array.isArray(data.candidates)) {
        setCandidates(data.candidates);
      } else {
        setCandidates([]);
      }
    } catch (err) {
      console.error('Failed to load candidate events:', err);
      setError(err.message || 'Failed to load candidate events');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadCandidates(true);
  }, []);

  // Manual Refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCandidates(false);
    setRefreshing(false);
    notify('Candidate queue refreshed');
  };

  // 2. Promotion Action Handler (Bridge to Authoritative Pothole)
  const handlePromote = async (candidateId) => {
    setActionLoading(prev => ({ ...prev, [candidateId]: 'promoting' }));
    try {
      const res = await promoteCandidate(candidateId);
      if (res && res.success) {
        const pId = res.potholeId || res.pothole?.potholeId;
        if (res.alreadyPromoted) {
          notify(`Candidate already promoted to ${pId}`);
        } else {
          notify(`Candidate promoted to ${pId} (${res.action === 'matched_existing' ? '10m fusion' : 'new cluster'})`);
        }
      } else {
        notify(`Promotion failed: ${res.message || 'Error promoting candidate'}`);
      }
      // Refresh candidates and update drawer
      await loadCandidates(false);
      if (selectedCandidate && selectedCandidate.candidateId === candidateId) {
        if (res.candidate) {
          setSelectedCandidate(res.candidate);
        } else {
          const fresh = candidates.find(c => c.candidateId === candidateId);
          if (fresh) setSelectedCandidate({ ...fresh, promotedToPotholeId: res.potholeId });
        }
      }
    } catch (err) {
      console.error('Promotion error:', err);
      notify(`Promotion error: ${err.message}`);
    } finally {
      setActionLoading(prev => {
        const updated = { ...prev };
        delete updated[candidateId];
        return updated;
      });
    }
  };

  // 3. Stat Calculations from Real Candidates
  const stats = useMemo(() => {
    const total = candidates.length;
    const promoted = candidates.filter(c => c.promotedToPotholeId != null).length;
    const pending = total - promoted;
    const buses = new Set(candidates.map(c => c.busId).filter(Boolean)).size;

    return { total, pending, promoted, buses };
  }, [candidates]);

  // 4. Filter & Search Logic
  const filteredCandidates = useMemo(() => {
    let list = candidates;

    // Filter by promotion status
    if (statusFilter === 'pending') {
      list = list.filter(c => !c.promotedToPotholeId);
    } else if (statusFilter === 'promoted') {
      list = list.filter(c => c.promotedToPotholeId != null);
    }

    // Search query
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        (c.candidateId && c.candidateId.toLowerCase().includes(q)) ||
        (c.busId && c.busId.toLowerCase().includes(q)) ||
        (c.class && c.class.toLowerCase().includes(q)) ||
        (c.promotedToPotholeId && c.promotedToPotholeId.toLowerCase().includes(q))
      );
    }

    return list;
  }, [candidates, statusFilter, query]);

  return (
    <div className="page">
      {/* PAGE HEADER */}
      <div className="page-title">
        <div>
          <p className="eyebrow" style={{ color: '#c4b5fd' }}>
            <span style={{ background: '#a855f7' }}></span> CENTRAL INTELLIGENCE
          </p>
          <h2>Candidate Pipeline</h2>
          <p>
            Review Edge-generated candidates before promoting them into authoritative road incidents.
          </p>
        </div>
        <button
          className="secondary"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          title="Refresh Candidate Queue"
        >
          <RefreshCw style={{ width: 14, height: 14, animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* NON-AUTHORITATIVE WARNING BANNER */}
      <section className="candidate-warning-banner">
        <div className="candidate-warning-text">
          <ShieldAlert style={{ width: 20, height: 20, color: '#c4b5fd', flexShrink: 0 }} />
          <div>
            <b>NON-AUTHORITATIVE CANDIDATE DATA</b>
            <small>
              These events are Edge observations awaiting Central review and promotion. They are not part of the authoritative incident register until promoted via 10m spatial fusion.
            </small>
          </div>
        </div>
      </section>

      {/* SUMMARY STAT CARDS (Calculated from Real Candidate API Data) */}
      <section className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '16px' }}>
        <StatCard
          label="Total Candidates"
          value={stats.total}
          sub="Ingested from Edge"
          icon={<Sparkles />}
          accent="purple"
          onClick={() => setStatusFilter('all')}
        />
        <StatCard
          label="Pending Promotion"
          value={stats.pending}
          sub="Awaiting promotion"
          icon={<Clock />}
          accent="amber"
          onClick={() => setStatusFilter('pending')}
        />
        <StatCard
          label="Promoted Incidents"
          value={stats.promoted}
          sub="Authoritative Potholes"
          icon={<CheckCircle2 />}
          accent="green"
          onClick={() => setStatusFilter('promoted')}
        />
        <StatCard
          label="Reporting Buses"
          value={stats.buses}
          sub="Transit fleet sensors"
          icon={<Bus />}
          accent="blue"
        />
      </section>

      {/* FILTER BUTTONS & SEARCH BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div className="filters" style={{ margin: 0 }}>
          {[
            { key: 'all', label: 'All Candidates', count: stats.total },
            { key: 'pending', label: 'Pending Promotion', count: stats.pending },
            { key: 'promoted', label: 'Promoted', count: stats.promoted },
          ].map(f => (
            <button
              key={f.key}
              className={statusFilter === f.key ? 'selected' : ''}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>

        <div className="search" style={{ width: '260px', height: '34px' }}>
          <Search style={{ width: 14, height: 14 }} />
          <input
            placeholder="Search candidate ID, bus..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* CANDIDATE QUEUE TABLE */}
      <div className="panel table-panel">
        <div className="table-head" style={{ gridTemplateColumns: '1.4fr 0.9fr 1.3fr 0.8fr 1.1fr 1.2fr 1.4fr' }}>
          <span>Candidate</span>
          <span>Bus</span>
          <span>Edge Detection</span>
          <span>Confidence</span>
          <span>Timestamp</span>
          <span>Promotion Status</span>
          <span>Actions</span>
        </div>

        {loading ? (
          <div style={{ padding: '50px 16px', textAlign: 'center', color: '#8e9ab1' }}>
            <Loader2 style={{ width: 24, height: 24, margin: '0 auto 10px', display: 'block', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '11px', color: '#c4b5fd' }}>Loading candidate pipeline...</span>
          </div>
        ) : error ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#ff6b81' }}>
            <AlertTriangle style={{ width: 24, height: 24, margin: '0 auto 8px', display: 'block' }} />
            <b style={{ fontSize: '12px', display: 'block' }}>Unable to load candidate events</b>
            <small style={{ fontSize: '10px', color: '#8e9ab1' }}>{error}</small>
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ padding: '50px 16px', textAlign: 'center', color: '#8e9ab1' }}>
            <Sparkles style={{ width: 24, height: 24, margin: '0 auto 8px', display: 'block', color: '#64748b' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>NO CANDIDATES</span>
            <small style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', display: 'block' }}>
              Central has not received any candidate events yet.
            </small>
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#8e9ab1' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>NO MATCHING CANDIDATES</span>
            <small style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', display: 'block' }}>
              Try another filter or search query.
            </small>
          </div>
        ) : (
          filteredCandidates.map(c => {
            const edgeConf = c.confidence != null
              ? `${Math.round(c.confidence > 1 ? c.confidence : c.confidence * 100)}%`
              : 'N/A';
            const isPromoted = !!c.promotedToPotholeId;
            const isPromoting = actionLoading[c.candidateId] === 'promoting';

            const timeStr = c.timestamp
              ? new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'N/A';

            return (
              <div
                className="table-row"
                key={c.candidateId || c._id}
                style={{ gridTemplateColumns: '1.4fr 0.9fr 1.3fr 0.8fr 1.1fr 1.2fr 1.4fr', cursor: 'pointer' }}
                onClick={() => setSelectedCandidate(c)}
              >
                {/* CANDIDATE ID & LOCATION */}
                <span>
                  <b style={{ color: '#c4b5fd', fontSize: '11px', letterSpacing: '0.02em' }}>{c.candidateId}</b>
                  <small style={{ color: '#00ffc4', fontSize: '8px' }}>
                    {c.location ? `${c.location.latitude?.toFixed(4)}, ${c.location.longitude?.toFixed(4)}` : ''}
                  </small>
                </span>

                {/* BUS ID */}
                <span>
                  <b style={{ color: '#f1f5f9', fontSize: '10px' }}>{c.busId || 'RAAHI-01'}</b>
                </span>

                {/* EDGE DETECTION (ORIGINAL EDGE DATA) */}
                <span>
                  <b style={{ color: '#fff', fontSize: '10px', textTransform: 'capitalize' }}>{c.class || 'pothole'}</b>
                  <small style={{ color: '#8e9ab1' }}>{c.edgeModel || 'YOLO11n'}</small>
                </span>

                {/* EDGE CONFIDENCE */}
                <span>
                  <b style={{ color: '#3ee2a2', fontWeight: 700 }}>{edgeConf}</b>
                </span>

                {/* TIMESTAMP */}
                <span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>{timeStr}</span>
                </span>

                {/* PROMOTION STATE */}
                <span>
                  {isPromoted ? (
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                      {c.promotedToPotholeId}
                    </span>
                  ) : (
                    <span className="status-pill open" style={{ fontSize: '8px' }}>
                      PENDING PROMOTION
                    </span>
                  )}
                </span>

                {/* ACTIONS */}
                <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {!isPromoted && (
                    <button
                      className="table-action-btn promote-btn"
                      onClick={() => handlePromote(c.candidateId)}
                      disabled={isPromoting}
                      title="Promote candidate into authoritative Pothole via 10m deduplication"
                    >
                      <ArrowRight style={{ width: 10, height: 10 }} />
                      {isPromoting ? 'Promoting...' : 'Promote'}
                    </button>
                  )}

                  <button
                    className="icon-btn"
                    style={{ width: '26px', height: '26px', borderRadius: '6px' }}
                    onClick={() => setSelectedCandidate(c)}
                    title="Inspect candidate details"
                  >
                    <Eye style={{ width: 12, height: 12 }} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* CANDIDATE DETAILS DRAWER (FALLBACK FOR STANDALONE USAGE) */}
      {selectedCandidate && (
        <CandidateDrawer
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onPromote={handlePromote}
          onViewIncident={onViewIncident}
          promoting={actionLoading[selectedCandidate.candidateId] === 'promoting'}
        />
      )}
    </div>
  );
}
