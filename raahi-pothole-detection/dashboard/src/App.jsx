import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, BusFront, Camera, CheckCircle2, ChevronRight, CircleHelp, Download, ExternalLink, Film, Gauge, Layers3, Loader2, LocateFixed, MapPinned, Menu, Radio, RefreshCw, Search, Settings, ShieldCheck, Siren, Smartphone, Sparkles, TrafficCone, TrendingUp, Video, X, Zap } from 'lucide-react';
import MapView from './components/MapView';
import StatCard from './components/StatCard';
import IncidentList from './components/IncidentList';
import GpsSender from './components/GpsSender';
import PhoneCameraSender from './components/PhoneCameraSender';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import CandidatePipeline from './components/candidates/CandidatePipeline';
import IncidentDrawer from './components/command/IncidentDrawer';
import CandidateDrawer from './components/candidates/CandidateDrawer';
import CentralAnalytics from './components/analytics/CentralAnalytics';
import SystemHealth from './components/health/SystemHealth';
import {
  fetchPotholes as apiFetchPotholes,
  fetchPotholeStats as apiFetchPotholeStats,
  updatePotholeStatus as apiUpdatePotholeStatus,
  fetchCandidates as apiFetchCandidates,
  fetchEvidenceStatus as apiFetchEvidenceStatus
} from './services/api';
// import { initialBuses } from './data/mockData';

const STORAGE = 'raahi-dashboard-state-v4';
const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function loadState() {
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE));
    if (x && Array.isArray(x.buses) && x.buses.length > 0) {
      return { buses: x.buses, incidents: [] };
    }
    return { buses: initialBuses, incidents: [] };
  } catch {
    return { buses: initialBuses, incidents: [] };
  }
}

function downloadCSV(potholesList = []) {
  const header = ['Pothole ID', 'Status', 'Confidence', 'Detection Count', 'Latitude', 'Longitude', 'Address', 'Buses Detected By', 'Google Drive Video URL', 'First Detected At', 'Last Detected At'];
  const body = (potholesList || []).map(r => [
    r.potholeId || r.id,
    r.status || 'open',
    r.confidence != null ? `${Math.round(r.confidence > 1 ? r.confidence : r.confidence * 100)}%` : 'N/A',
    r.detectionCount || 1,
    r.location?.latitude ?? r.lat ?? '',
    r.location?.longitude ?? r.lng ?? '',
    `"${(r.address || '').replace(/"/g, '""')}"`,
    `"${((r.busesDetectedBy || []).join(', ') || r.bus || '').replace(/"/g, '""')}"`,
    r.videoUrl || 'Not available',
    r.firstDetectedAt || '',
    r.lastDetectedAt || ''
  ]);
  const csv = [header, ...body].map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'raahi-mongodb-potholes.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  const getInitialPage = () => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname.toLowerCase();
      const h = window.location.hash.toLowerCase();
      if (p.includes('/camera') || h.includes('camera')) {
        return 'camera';
      }
      if (p.includes('/gps') || h.includes('gps')) {
        return 'gps';
      }
    }
    return 'overview';
  };

  const [buses, setBuses] = useState([]);
  const [trafficIncidents, setTrafficIncidents] = useState([]);
  const [{ incidents }, setData] = useState({ incidents: [] });
  const [live, setLive] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [page, setPage] = useState(getInitialPage);
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);

  // Backend System Status (fetched from /api/status)
  const [systemStatus, setSystemStatus] = useState({
    detectionSystem: "Online",
    model: "YOLO11n",
    video: "cityRoad_potHoles-side.mp4",
    frames: 608,
    detections: 63,
    annotatedVideoReady: true,
  });

  // Fetch real system status from Express backend
  useEffect(() => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data && data.detectionSystem) {
          setSystemStatus(data);
        }
      })
      .catch(err => {
        console.warn('Using default system status:', err.message);
      });
  }, []);

  // Phase 7 Phone GPS Telemetry (polled dynamically from /api/gps)
  const [gpsLocation, setGpsLocation] = useState({ connected: false });

  useEffect(() => {
    let isMounted = true;
    const fetchGps = () => {
      fetch('/api/gps')
        .then(res => res.json())
        .then(data => {
          if (isMounted && data) {
            setGpsLocation(data);
          }
        })
        .catch(err => {
          // Fallback silently if server temporarily unavailable
        });
    };

    fetchGps();
    const intervalId = setInterval(fetchGps, 2000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  // Phase 13: Real MongoDB Pothole Incidents State
  const [potholes, setPotholes] = useState([]);
  const [loadingPotholes, setLoadingPotholes] = useState(true);
  const [potholesError, setPotholesError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [potholeStats, setPotholeStats] = useState({
    total: 0,
    open: 0,
    investigating: 0,
    repaired: 0,
    ignored: 0
  });

  // Central Candidate Events state
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState(null);

  // Central Evidence Service Status
  const [evidenceStatus, setEvidenceStatus] = useState(null);

  // Calculate statistics using dedicated stats endpoint via Central api client
  const fetchPotholeStats = async () => {
    try {
      const data = await apiFetchPotholeStats();
      if (data && data.success && data.stats) {
        setPotholeStats(data.stats);
      }
    } catch (err) {
      console.warn('Failed to fetch pothole stats:', err.message);
    }
  };

  // Fetch potholes from MongoDB via Central api client (supports ?status=... server filtering)
  const fetchPotholes = async (filterStatus = statusFilter) => {
    setLoadingPotholes(true);
    setPotholesError(null);
    try {
      const data = await apiFetchPotholes({ status: filterStatus });
      if (data && data.success && Array.isArray(data.potholes)) {
        setPotholes(data.potholes);
      } else {
        setPotholes([]);
        if (data && data.error) {
          setPotholesError(data.message || data.error);
        }
      }
    } catch (err) {
      console.error('Failed to fetch potholes from MongoDB:', err);
      setPotholesError(err.message);
    } finally {
      setLoadingPotholes(false);
    }
  };

  const fetchCandidatesData = async () => {
    setLoadingCandidates(true);
    setCandidatesError(null);
    try {
      const data = await apiFetchCandidates();
      if (data && data.success && Array.isArray(data.candidates)) {
        setCandidates(data.candidates);
      } else {
        setCandidates([]);
        if (data && data.error) setCandidatesError(data.message || data.error);
      }
    } catch (err) {
      console.warn('Failed to fetch candidates:', err.message);
      setCandidatesError(err.message);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };


  // Real active fleet loader
  const fetchBusesData = async () => {
    try {
      const res = await fetchFleetBuses();
      if (res && Array.isArray(res.buses)) {
        setBuses(res.buses);
      }
    } catch (err) {
      console.warn('Failed to fetch fleet buses:', err.message);
    }
  };

  // Real traffic incidents loader
  const fetchTrafficData = async () => {
    try {
      const res = await fetchTrafficIncidents();
      if (res && Array.isArray(res.incidents)) {
        setTrafficIncidents(res.incidents);
      }
    } catch (err) {
      console.warn('Failed to fetch traffic incidents:', err.message);
    }
  };

  const fetchEvidenceData = async () => {
    try {
      const data = await apiFetchEvidenceStatus();
      if (data && data.success) {
        setEvidenceStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch evidence status:', err.message);
    }
  };

  // Initial load
  useEffect(() => {
    fetchPotholes('All');
    fetchPotholeStats();
    fetchCandidatesData();
    fetchEvidenceData();
    fetchBusesData();
    fetchTrafficData();
  }, []);

  // Real-time periodic refresh (every 6s when live)
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      fetchPotholes(statusFilter);
      fetchPotholeStats();
      fetchCandidatesData();
      fetchBusesData();
      fetchTrafficData();
    }, 6000);
    return () => clearInterval(timer);
  }, [live, statusFilter]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.allSettled([
      fetchPotholes(statusFilter),
      fetchPotholeStats(),
      fetchCandidatesData(),
      fetchEvidenceData()
    ]);
    setIsRefreshing(false);
    setToast('Central platform intelligence refreshed');
  };

  const handleStatusFilter = (st) => {
    setStatusFilter(st);
    fetchPotholes(st);
  };

  // Phase 17: Update pothole incident status via Central api client PATCH API
  const handleStatusUpdate = async (potholeId, newStatus) => {
    try {
      const data = await apiUpdatePotholeStatus(potholeId, newStatus);
      if (data && data.success) {
        setToast(`${potholeId} status updated to ${newStatus}`);
        // Update the selected incident in the drawer with fresh data
        if (selected && selected.potholeId === potholeId) {
          setSelected(data.pothole);
        }
        // Refresh lists and stats
        await Promise.all([fetchPotholes(statusFilter), fetchPotholeStats()]);
      } else {
        setToast(`Failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to update pothole status:', err);
      setToast(`Error updating status: ${err.message}`);
    }
  };

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify({ buses, incidents: [] }));
  }, [buses]);

  // Real-time bus telemetry refreshed from /api/fleet/buses
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      fetchBusesData();
      fetchTrafficData();
    }, 3000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Filtered potholes according to top search input
  const displayedPotholes = useMemo(() => {
    if (!query) return potholes;
    const q = query.toLowerCase();
    return potholes.filter(p =>
      (p.potholeId && p.potholeId.toLowerCase().includes(q)) ||
      (p.address && p.address.toLowerCase().includes(q)) ||
      (p.status && p.status.toLowerCase().includes(q)) ||
      (p.busesDetectedBy && p.busesDetectedBy.some(b => b.toLowerCase().includes(q)))
    );
  }, [potholes, query]);

  // Authoritative Derived Metrics for Central Command Overview
  const fusedObservationsCount = useMemo(() => {
    if (!potholes || potholes.length === 0) return 0;
    return potholes.reduce((acc, p) => acc + (p.detectionCount || 1), 0);
  }, [potholes]);

  const candidateCounts = useMemo(() => {
    const counts = { pending: 0, promoted: 0 };
    candidates.forEach(c => {
      const st = (c.status || (c.promotedToPotholeId ? 'promoted' : 'pending')).toLowerCase();
      if (st === 'promoted' || c.promotedToPotholeId) {
        counts.promoted++;
      } else {
        counts.pending++;
      }
    });
    return counts;
  }, [candidates]);

  const latestPothole = useMemo(() => {
    if (!potholes || potholes.length === 0) return null;
    return [...potholes].sort((a, b) => {
      const timeA = new Date(a.lastDetectedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.lastDetectedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    })[0];
  }, [potholes]);

  const selectIncident = p => {
    setSelected(p);
    setSelectedCandidate(null);
  };

  // Phase 6C: Bidirectional Drawer Lineage Navigation
  const openCandidateDrawer = (candidate) => {
    setSelectedCandidate(candidate);
    setSelected(null);
  };

  const openIncidentDrawer = (pothole) => {
    setSelected(pothole);
    setSelectedCandidate(null);
  };

  const resolve = id => {
    setData(s => ({
      ...s,
      incidents: s.incidents.map(i => (i.id === id ? { ...i, status: 'resolved' } : i))
    }));
    setSelected(null);
    setToast('Incident marked as resolved');
  };

  const simulate = () => {
    const b = buses.find(x => x.status === 'online') || buses[0];
    const i = {
      id: `SIM-${Date.now()}`,
      type: ['Pothole', 'Congestion', 'Waterlogging'][Math.floor(Math.random() * 3)],
      severity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
      confidence: 88 + Math.floor(Math.random() * 11),
      time: nowTime(),
      lat: b.lat,
      lng: b.lng,
      bus: b.id,
      status: 'open',
      size: 'Simulated Observation',
      evidence: '/raahi-camera-sample.png',
      isReal: false
    };
    setData(s => ({ ...s, incidents: [i, ...s.incidents] }));
    setSelected(i);
    setToast('New simulated AI detection added');
  };

  const reset = () => {
    fetch('/api/detections')
      .then(res => res.json())
      .then(data => {
        if (data && data.detections) {
          const realItems = data.detections.map(d => ({
            id: d.id,
            type: d.type,
            rawClass: d.rawClass || d.type,
            severity: d.severity,
            confidence: d.confidence,
            time: `${d.timestamp} (Frame ${d.frame})`,
            timestamp: d.timestamp,
            frame: d.frame,
            bbox: d.bbox,
            size: d.size,
            bus: d.bus || 'RAAHI-01',
            status: d.status || 'open',
            evidence: '/api/video',
            isReal: true,
            videoSource: d.videoSource || 'cityRoad_potHoles-side.mp4',
          }));
          setData({ buses: initialBuses, incidents: realItems });
        }
      })
      .catch(() => {
        setData({ buses: initialBuses, incidents: [] });
      });
    setToast('Data reset to actual detection state');
  };

  return (
    <div className="app">
      {/* SIDEBAR NAVIGATION (Extracted Phase 5A Component) */}
      <Sidebar
        page={page}
        setPage={setPage}
        menuOpen={menu}
        openIncidentsCount={potholeStats.open ?? 0}
        systemStatus={systemStatus}
      />

      {/* MAIN CONTENT AREA */}
      <main className="main">
        {/* TOPBAR HEADER (Extracted Phase 5A Component) */}
        <Topbar
          page={page}
          query={query}
          setQuery={setQuery}
          live={live}
          setLive={setLive}
          menuOpen={menu}
          setMenuOpen={setMenu}
          onHelp={() => setToast('RAAHI Central Platform & API backend operational')}
        />

        <div className="content">
          {page === 'overview' && (
            <>
              {/* CENTRAL COMMAND HEADER */}
              <section className="hero">
                <div>
                  <p className="eyebrow">
                    <span></span> RAAHI CENTRAL COMMAND
                  </p>
                  <h2>
                    COMMAND <span>CENTER</span>
                  </h2>
                  <p>
                    Central view of verified road-hazard incidents, event fusion and platform status.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    className="secondary"
                    onClick={handleManualRefresh}
                    title="Refresh all Central data"
                  >
                    <RefreshCw
                      style={{
                        width: 14,
                        height: 14,
                        animation: isRefreshing || loadingPotholes ? 'spin 1s linear infinite' : 'none'
                      }}
                    />
                    Refresh Central Data
                  </button>
                  <button className="secondary" onClick={() => setPage('candidates')}>
                    <Radio style={{ width: 14, height: 14 }} /> Candidate Pipeline
                  </button>
                  <button className="secondary" onClick={() => setPage('health')}>
                    <Activity style={{ width: 14, height: 14 }} /> System Health
                  </button>
                  <button className="secondary" onClick={() => downloadCSV(potholes)}>
                    <Download style={{ width: 14, height: 14 }} /> Export CSV
                  </button>
                </div>
              </section>

              {/* SECTION 1: AUTHORITATIVE KPI ROW */}
              <section className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '16px' }}>
                {/* CARD 1: AUTHORITATIVE INCIDENTS */}
                <StatCard
                  label="Authoritative Incidents"
                  value={potholesError ? 'Unavailable' : (potholeStats.total ?? potholes.length)}
                  sub={potholesError ? 'API error' : `${potholeStats.open || 0} Open • ${potholeStats.repaired || 0} Repaired`}
                  icon={<AlertTriangle />}
                  accent="red"
                  onClick={() => { setPage('incidents'); handleStatusFilter('All'); }}
                />

                {/* CARD 2: FUSED OBSERVATIONS */}
                <StatCard
                  label="Fused Observations"
                  value={fusedObservationsCount}
                  sub={`Across ${potholeStats.total || potholes.length} authoritative incidents`}
                  icon={<Layers3 />}
                  accent="amber"
                  onClick={() => setPage('analytics')}
                />

                {/* CARD 3: CANDIDATE INGESTION */}
                <StatCard
                  label="Candidate Ingestion"
                  value={
                    candidatesError
                      ? 'Unavailable'
                      : (candidates.length === 0 ? '0 candidates' : `${candidates.length} candidates`)
                  }
                  sub={
                    candidatesError
                      ? 'API unavailable'
                      : (candidates.length === 0
                          ? '0 pending • 0 promoted'
                          : `${candidateCounts.pending} pending • ${candidateCounts.promoted} promoted`)
                  }
                  icon={<Radio />}
                  accent="purple"
                  onClick={() => setPage('candidates')}
                />

                {/* CARD 4: 10M SPATIAL FUSION */}
                <StatCard
                  label="10m Spatial Fusion"
                  value="ACTIVE"
                  sub="Haversine cross-bus deduplication"
                  icon={<Layers3 />}
                  accent="blue"
                  onClick={() => setPage('analytics')}
                />
              </section>

              {/* SECTION 2: CENTRAL MAP + INCIDENT SPOTLIGHT */}
              <section className="workspace" style={{ marginBottom: '16px' }}>
                {/* GIS MAP PANEL - AUTHORITATIVE POTHOLES ONLY */}
                <div className="panel map-panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">
                        CENTRAL GEOSPATIAL INTELLIGENCE <span className="real-tag">AUTHORITATIVE ROAD HAZARDS</span>
                      </p>
                      <h3>Authoritative Road Hazard Map</h3>
                    </div>
                    <div className="map-controls">
                      <button onClick={handleManualRefresh} title="Refresh Authoritative Potholes">
                        <RefreshCw style={{ width: 13, height: 13, animation: isRefreshing || loadingPotholes ? 'spin 1s linear infinite' : 'none' }} /> Refresh
                      </button>
                      <button onClick={() => setToast('Map centered on Delhi NCR authoritative records')}>
                        <LocateFixed />
                      </button>
                    </div>
                  </div>
                  <MapView
                    mode="central"
                    potholes={displayedPotholes}
                    buses={buses}
                    trafficIncidents={trafficIncidents}
                    gpsLocation={gpsLocation}
                    showFleet={true}
                    onSelectIncident={selectIncident}
                    loading={loadingPotholes}
                    error={potholesError}
                  />
                </div>

                {/* RIGHT STACK: LATEST AUTHORITATIVE INCIDENT SPOTLIGHT */}
                <div className="right-stack">
                  <div className="panel incident-spotlight-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">
                          INCIDENT SPOTLIGHT <span className="real-tag">LATEST AUTHORITATIVE</span>
                        </p>
                        <h3>Latest Verified Incident</h3>
                      </div>
                      {latestPothole && (
                        <span className={`status-pill ${latestPothole.status || 'open'}`} style={{ textTransform: 'uppercase', fontWeight: 700 }}>
                          {latestPothole.status || 'open'}
                        </span>
                      )}
                    </div>

                    <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {!latestPothole ? (
                        <div style={{ padding: '36px 16px', textAlign: 'center', color: '#8e9ab1', margin: 'auto' }}>
                          <AlertCircle style={{ width: 28, height: 28, color: '#62718a', margin: '0 auto 10px', display: 'block' }} />
                          <b style={{ color: '#cbd5e1', fontSize: '13px', display: 'block' }}>No authoritative incidents recorded</b>
                          <p style={{ fontSize: '11px', color: '#68758e', marginTop: '4px' }}>
                            Authoritative incidents appear here once CandidateEvents are verified, promoted, and fused.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* Top Identity Block */}
                          <div style={{ background: '#0a0f18', border: '1px solid #1a2433', borderRadius: '10px', padding: '12px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontSize: '15px', fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
                                {latestPothole.potholeId}
                              </span>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>
                                {latestPothole.verifiedClass || latestPothole.class || latestPothole.eventType || 'pothole'}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.4 }}>
                              {latestPothole.address && latestPothole.address.trim() !== ''
                                ? latestPothole.address
                                : (latestPothole.location ? `${latestPothole.location.latitude?.toFixed(5)}, ${latestPothole.location.longitude?.toFixed(5)}` : 'Coordinates recorded')}
                            </div>
                          </div>

                          {/* 4-Stat Breakdown Grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div style={{ background: '#0a0e16', border: '1px solid #18202d', borderRadius: '8px', padding: '10px 12px' }}>
                              <small style={{ color: '#73829c', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>Edge Confidence</small>
                              <b style={{ color: '#3ee2a2', fontSize: '15px', marginTop: '2px', display: 'block' }}>
                                {latestPothole.confidence != null ? `${Math.round(latestPothole.confidence > 1 ? latestPothole.confidence : latestPothole.confidence * 100)}%` : 'N/A'}
                              </b>
                              <span style={{ fontSize: '8px', color: '#55657e' }}>Preserved Edge detector</span>
                            </div>
                            <div style={{ background: '#0a0e16', border: '1px solid #18202d', borderRadius: '8px', padding: '10px 12px' }}>
                              <small style={{ color: '#73829c', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>Fused Observations</small>
                              <b style={{ color: '#ffb42d', fontSize: '15px', marginTop: '2px', display: 'block' }}>
                                {latestPothole.detectionCount || 1}
                              </b>
                              <span style={{ fontSize: '8px', color: '#55657e' }}>Spatial cross-bus fusion</span>
                            </div>
                            <div style={{ background: '#0a0e16', border: '1px solid #18202d', borderRadius: '8px', padding: '10px 12px' }}>
                              <small style={{ color: '#73829c', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>Detected By</small>
                              <b style={{ color: '#e2e8f0', fontSize: '12px', marginTop: '3px', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {(latestPothole.busesDetectedBy && latestPothole.busesDetectedBy.length > 0) ? latestPothole.busesDetectedBy.join(', ') : 'RAAHI-01'}
                              </b>
                              <span style={{ fontSize: '8px', color: '#55657e' }}>Reporting fleet units</span>
                            </div>
                            <div style={{ background: '#0a0e16', border: '1px solid #18202d', borderRadius: '8px', padding: '10px 12px' }}>
                              <small style={{ color: '#73829c', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>Last Detected</small>
                              <b style={{ color: '#94a3b8', fontSize: '11px', marginTop: '3px', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {latestPothole.lastDetectedAt
                                  ? new Date(latestPothole.lastDetectedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                  : (latestPothole.createdAt ? new Date(latestPothole.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'N/A')}
                              </b>
                              <span style={{ fontSize: '8px', color: '#55657e' }}>Authoritative timestamp</span>
                            </div>
                          </div>

                          {/* Evidence Strip */}
                          <div style={{ background: '#090d14', border: '1px solid #161e2a', borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Film style={{ width: 15, height: 15, color: latestPothole.videoUrl ? '#38bdf8' : '#64748b' }} />
                              <span style={{ fontSize: '10px', color: '#cbd5e1' }}>
                                {latestPothole.videoUrl ? 'Google Drive Evidence Linked' : 'No evidence media linked'}
                              </span>
                            </div>
                            {latestPothole.videoUrl ? (
                              <a
                                href={latestPothole.videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  color: '#38bdf8',
                                  textDecoration: 'none',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: 'rgba(56, 189, 248, 0.12)',
                                  padding: '4px 8px',
                                  borderRadius: '5px',
                                  border: '1px solid rgba(56, 189, 248, 0.3)'
                                }}
                              >
                                View Evidence <ExternalLink style={{ width: 11, height: 11 }} />
                              </a>
                            ) : (
                              <span style={{ fontSize: '9px', color: '#64748b' }}>None</span>
                            )}
                          </div>

                          {/* Action Button */}
                          <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
                            <button
                              onClick={() => selectIncident(latestPothole)}
                              style={{
                                width: '100%',
                                background: '#1e293b',
                                border: '1px solid #334155',
                                color: '#f8fafc',
                                borderRadius: '8px',
                                padding: '10px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span>Open Authoritative Incident Drawer</span>
                              <ChevronRight style={{ width: 14, height: 14 }} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* SECTIONS 3, 4, 5: RECENT INCIDENTS + PIPELINE SNAPSHOT + PLATFORM STATUS */}
              <section className="bottom-grid">
                {/* SECTION 3: RECENT AUTHORITATIVE INCIDENTS */}
                <div className="panel incidents-panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">
                        AUTHORITATIVE INCIDENTS <span className="real-tag">MONGODB SOURCE OF TRUTH</span>
                      </p>
                      <h3>Recent Incidents ({potholes.length} shown of {potholeStats.total} total)</h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="icon-btn"
                        onClick={handleManualRefresh}
                        title="Refresh Potholes from MongoDB"
                        style={{ width: '32px', height: '32px' }}
                      >
                        <RefreshCw style={{ width: 14, height: 14, animation: isRefreshing || loadingPotholes ? 'spin 1s linear infinite' : 'none' }} />
                      </button>
                      <button className="text-btn" onClick={() => setPage('incidents')}>
                        View all incidents <ChevronRight />
                      </button>
                    </div>
                  </div>

                  {/* Status filter tabs */}
                  <div style={{ padding: '8px 14px', display: 'flex', gap: '6px', flexWrap: 'wrap', borderBottom: '1px solid #1a2230', background: 'rgba(10, 15, 23, 0.4)' }}>
                    {[
                      { key: 'All', label: 'All', count: potholeStats.total },
                      { key: 'open', label: 'Open', count: potholeStats.open },
                      { key: 'investigating', label: 'Investigating', count: potholeStats.investigating },
                      { key: 'repaired', label: 'Repaired', count: potholeStats.repaired },
                      { key: 'ignored', label: 'Ignored', count: potholeStats.ignored },
                    ].map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => handleStatusFilter(tab.key)}
                        style={{
                          background: statusFilter === tab.key ? '#1e293b' : '#0d131c',
                          color: statusFilter === tab.key ? '#fff' : '#8e9ab1',
                          border: statusFilter === tab.key ? '1px solid #38bdf8' : '1px solid #1e2636',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '10px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span>{tab.label}</span>
                        <span style={{
                          fontSize: '9px',
                          background: statusFilter === tab.key ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)',
                          color: statusFilter === tab.key ? '#38bdf8' : '#64748b',
                          padding: '1px 5px',
                          borderRadius: '99px',
                          fontWeight: 700
                        }}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <IncidentList
                    potholes={displayedPotholes}
                    onSelect={selectIncident}
                    loading={loadingPotholes}
                    error={potholesError}
                  />
                </div>

                {/* RIGHT COLUMN: SECTION 4 (PIPELINE SNAPSHOT) + SECTION 5 (PLATFORM STATUS) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* SECTION 4: CENTRAL PIPELINE SNAPSHOT */}
                  <div className="panel">
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">
                          EVENT PROCESSING <span className="real-tag">PIPELINE ARCHITECTURE</span>
                        </p>
                        <h3>Central Pipeline Snapshot</h3>
                      </div>
                      <button className="text-btn" onClick={() => setPage('candidates')}>
                        Pipeline <ChevronRight />
                      </button>
                    </div>

                    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* Step 1: Edge Event */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#0a0f16', borderRadius: '6px', border: '1px solid #17202c' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '18px', height: '18px', borderRadius: '4px', background: 'rgba(59,140,255,0.15)', color: '#60a5fa', display: 'grid', placeItems: 'center', fontSize: '10px', fontWeight: 800 }}>1</span>
                          <div>
                            <b style={{ fontSize: '11px', color: '#e2e8f0', display: 'block' }}>Edge Event Ingestion</b>
                            <small style={{ fontSize: '9px', color: '#64748b' }}>Detector captures from Edge</small>
                          </div>
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#3ee2a2', background: 'rgba(62,226,162,0.12)', padding: '2px 6px', borderRadius: '4px' }}>Active</span>
                      </div>

                      <div style={{ textAlign: 'center', color: '#475569', fontSize: '10px', lineHeight: 1 }}>↓</div>

                      {/* Step 2: Candidate */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#0a0f16', borderRadius: '6px', border: '1px solid #17202c' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '18px', height: '18px', borderRadius: '4px', background: 'rgba(155,108,255,0.15)', color: '#c4b5fd', display: 'grid', placeItems: 'center', fontSize: '10px', fontWeight: 800 }}>2</span>
                          <div>
                            <b style={{ fontSize: '11px', color: '#e2e8f0', display: 'block' }}>Candidate Queue</b>
                            <small style={{ fontSize: '9px', color: '#64748b' }}>Canonical CandidateEvents</small>
                          </div>
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#c4b5fd', background: 'rgba(155,108,255,0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                          {candidates.length} in queue
                        </span>
                      </div>

                      <div style={{ textAlign: 'center', color: '#475569', fontSize: '10px', lineHeight: 1 }}>↓</div>

                      {/* Step 3: Promotion & 10m Spatial Fusion */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#0a0f16', borderRadius: '6px', border: '1px solid #17202c' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '18px', height: '18px', borderRadius: '4px', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', display: 'grid', placeItems: 'center', fontSize: '10px', fontWeight: 800 }}>3</span>
                          <div>
                            <b style={{ fontSize: '11px', color: '#e2e8f0', display: 'block' }}>Promotion & 10m Spatial Fusion</b>
                            <small style={{ fontSize: '9px', color: '#64748b' }}>Haversine cross-bus deduplication</small>
                          </div>
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.12)', padding: '2px 6px', borderRadius: '4px' }}>Deterministic</span>
                      </div>

                      <div style={{ textAlign: 'center', color: '#475569', fontSize: '10px', lineHeight: 1 }}>↓</div>

                      {/* Step 4: Authoritative Incident */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#0a0f16', borderRadius: '6px', border: '1px solid #17202c' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '18px', height: '18px', borderRadius: '4px', background: 'rgba(255,77,109,0.15)', color: '#ff4d6d', display: 'grid', placeItems: 'center', fontSize: '10px', fontWeight: 800 }}>4</span>
                          <div>
                            <b style={{ fontSize: '11px', color: '#e2e8f0', display: 'block' }}>Authoritative Incident</b>
                            <small style={{ fontSize: '9px', color: '#64748b' }}>MongoDB Pothole collection</small>
                          </div>
                        </div>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#3ee2a2', background: 'rgba(62,226,162,0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                          {potholeStats.total} Incidents
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 5: CENTRAL PLATFORM STATUS */}
                  <div className="panel">
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">
                          INFRASTRUCTURE <span className="real-tag">OPERATIONAL HEALTH</span>
                        </p>
                        <h3>Platform Subsystem Status</h3>
                      </div>
                      <button className="text-btn" onClick={() => setPage('health')}>
                        System Health <ChevronRight />
                      </button>
                    </div>

                    <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {/* Subsystem 1: Central API */}
                      <div style={{ background: '#0a0f16', border: '1px solid #17202c', borderRadius: '8px', padding: '9px 12px' }}>
                        <small style={{ fontSize: '8px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>Central API</small>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3ee2a2', boxShadow: '0 0 8px #3ee2a2' }}></span>
                          <b style={{ fontSize: '11px', color: '#fff' }}>OPERATIONAL</b>
                        </div>
                      </div>

                      {/* Subsystem 2: MongoDB */}
                      <div style={{ background: '#0a0f16', border: '1px solid #17202c', borderRadius: '8px', padding: '9px 12px' }}>
                        <small style={{ fontSize: '8px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>MongoDB</small>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: systemStatus.database?.connected || potholes.length >= 0 ? '#3ee2a2' : '#ff4d6d',
                            boxShadow: systemStatus.database?.connected || potholes.length >= 0 ? '0 0 8px #3ee2a2' : 'none'
                          }}></span>
                          <b style={{ fontSize: '11px', color: '#fff' }}>
                            {systemStatus.database?.connected || potholes.length >= 0 ? 'CONNECTED' : 'DISCONNECTED'}
                          </b>
                        </div>
                      </div>

                      {/* Subsystem 3: Event Ingestion */}
                      <div style={{ background: '#0a0f16', border: '1px solid #17202c', borderRadius: '8px', padding: '9px 12px' }}>
                        <small style={{ fontSize: '8px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>Event Ingestion</small>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3ee2a2', boxShadow: '0 0 8px #3ee2a2' }}></span>
                          <b style={{ fontSize: '11px', color: '#fff' }}>READY</b>
                        </div>
                      </div>

                      {/* Subsystem 4: 10m Spatial Fusion */}
                      <div style={{ background: '#0a0f16', border: '1px solid #17202c', borderRadius: '8px', padding: '9px 12px' }}>
                        <small style={{ fontSize: '8px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>10m Fusion</small>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: '#3ee2a2',
                            boxShadow: '0 0 8px #3ee2a2'
                          }}></span>
                          <b style={{ fontSize: '11px', color: '#fff' }}>ACTIVE</b>
                        </div>
                      </div>

                      {/* Subsystem 5: Evidence Storage */}
                      <div style={{ background: '#0a0f16', border: '1px solid #17202c', borderRadius: '8px', padding: '9px 12px', gridColumn: 'span 2' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <small style={{ fontSize: '8px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em' }}>Evidence Storage</small>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                              <span style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: evidenceStatus?.driveAuthenticated ? '#3ee2a2' : (evidenceStatus?.driveConfigured ? '#38bdf8' : '#8e9ab1'),
                                boxShadow: evidenceStatus?.driveAuthenticated ? '0 0 8px #3ee2a2' : 'none'
                              }}></span>
                              <b style={{ fontSize: '11px', color: '#fff' }}>
                                {evidenceStatus?.driveAuthenticated
                                  ? 'GOOGLE DRIVE AUTHENTICATED'
                                  : (evidenceStatus?.driveConfigured ? 'DRIVE CONFIGURED' : (evidenceStatus ? 'STANDBY' : 'CHECKING...'))}
                              </b>
                            </div>
                          </div>
                          {evidenceStatus?.localEvidenceClipsCount > 0 && (
                            <span style={{ fontSize: '9px', color: '#8e9ab1' }}>
                              {evidenceStatus.localEvidenceClipsCount} local clips cached
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {page === 'candidates' && (
            <CandidatePipeline
              setToast={setToast}
              onSelectCandidate={openCandidateDrawer}
              onViewIncident={openIncidentDrawer}
            />
          )}

          {page === 'health' && <SystemHealth setPage={setPage} />}

          {page === 'buses' && <FleetPage buses={buses} setPage={setPage} />}
          {page === 'incidents' && (
            <IncidentsPage
              potholes={displayedPotholes}
              statusFilter={statusFilter}
              onStatusFilter={handleStatusFilter}
              potholeStats={potholeStats}
              loading={loadingPotholes}
              error={potholesError}
              onSelect={selectIncident}
              onRefresh={handleManualRefresh}
              isRefreshing={isRefreshing}
              onExport={() => downloadCSV(potholes)}
            />
          )}
          {page === 'analytics' && <CentralAnalytics />}
          {page === 'gps' && <GpsSender onBack={() => setPage('overview')} />}
          {page === 'camera' && <PhoneCameraSender onBack={() => setPage('overview')} />}
          {page === 'settings' && <SettingsPage live={live} setLive={setLive} reset={reset} systemStatus={systemStatus} gpsLocation={gpsLocation} />}
        </div>
      </main>

      {/* INCIDENT DETAILS DRAWER */}
      {selected && (
        <IncidentDrawer
          incident={selected}
          onClose={() => setSelected(null)}
          onResolve={resolve}
          onStatusUpdate={handleStatusUpdate}
          onViewCandidate={openCandidateDrawer}
        />
      )}

      {/* CANDIDATE DETAILS DRAWER (PHASE 6C BIDIRECTIONAL LINEAGE) */}
      {selectedCandidate && (
        <CandidateDrawer
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onViewIncident={openIncidentDrawer}
        />
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="toast">
          <ShieldCheck /> {toast}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// SUB-PAGE: FLEET (Requirement 11: Clearly marked as Demo Fleet)
// ----------------------------------------------------------------------
function FleetPage({ buses = [], setPage }) {
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <p className="eyebrow">
            FLEET MANAGEMENT <span className="live-tag" style={{ background: '#052e16', color: '#4ade80', border: '1px solid #166534', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 800 }}>LIVE EDGE TELEMETRY</span>
          </p>
          <h2>Connected Bus Fleet</h2>
          <p>
            Live vehicle telemetry and edge-device perception status reported from connected RAAHI buses.
          </p>
        </div>
        <button className="secondary" onClick={() => setPage('overview')}>
          <MapPinned /> Open GIS
        </button>
      </div>

      {buses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#0b1017', border: '1px solid #1e293b', borderRadius: '12px', color: '#94a3b8' }}>
          <BusFront style={{ width: 44, height: 44, margin: '0 auto 12px', opacity: 0.5 }} />
          <b style={{ color: '#cbd5e1', fontSize: '14px', display: 'block' }}>No Active Buses Connected</b>
          <p style={{ fontSize: '11px', maxWidth: 450, margin: '6px auto 0' }}>
            Start the RAAHI-Edge pipeline on a vehicle or send phone GPS telemetry to register an active bus in the central fleet.
          </p>
        </div>
      ) : (
        <div className="fleet-grid">
          {buses.map(b => (
            <div className="fleet-card" key={b.id}>
              <div className="fleet-icon">
                <BusFront />
              </div>
              <div className="fleet-main">
                <div>
                  <b>{b.id}</b>
                  <span className={`status ${b.status}`}>{b.status}</span>
                </div>
                <p>{b.route || 'Edge Sensing Unit'}</p>
                <div className="fleet-metrics">
                  <span>
                    <Gauge /> {b.speed || 0} km/h
                  </span>
                  <span>
                    <Camera /> {b.camera ? 'Online' : 'Offline'}
                  </span>
                  <span>
                    <MapPinned /> {typeof b.lat === 'number' ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}` : 'No GPS Fix'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// SUB-PAGE: INCIDENTS (Shows both Real YOLO Detections & Demo Events)
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// SUB-PAGE: INCIDENTS (Real MongoDB Pothole Incident Register)
// ----------------------------------------------------------------------
function IncidentsPage({
  potholes = [],
  statusFilter,
  onStatusFilter,
  potholeStats,
  loading,
  error,
  onSelect,
  onRefresh,
  isRefreshing,
  onExport
}) {
  const statusOptions = [
    { key: 'All', label: 'All', count: potholeStats.total },
    { key: 'open', label: 'Open', count: potholeStats.open },
    { key: 'investigating', label: 'Investigating', count: potholeStats.investigating },
    { key: 'repaired', label: 'Repaired', count: potholeStats.repaired },
    { key: 'ignored', label: 'Ignored', count: potholeStats.ignored },
  ];

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <p className="eyebrow">
            INCIDENT MANAGEMENT <span className="real-tag">MONGODB VERIFIED INCIDENTS</span>
          </p>
          <h2>Pothole incident register</h2>
          <p>
            Aggregated, deduplicated road hazard incidents stored in MongoDB with reverse-geocoded addresses,
            detection frequencies, and Google Drive evidence clips.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary" onClick={onRefresh} title="Refresh from MongoDB">
            <RefreshCw style={{ width: 14, height: 14, animation: isRefreshing || loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
          <button className="secondary" onClick={onExport}>
            <Download /> Export CSV
          </button>
        </div>
      </div>

      {/* STATS SUMMARY BAR */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '16px' }}>
        {statusOptions.map(st => (
          <div
            key={st.key}
            onClick={() => onStatusFilter(st.key)}
            style={{
              background: '#0e121a',
              border: statusFilter === st.key ? '1px solid #38bdf8' : '1px solid #222a38',
              borderRadius: '10px',
              padding: '12px 14px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ fontSize: '9px', color: '#8e9ab1', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
              {st.label}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: statusFilter === st.key ? '#38bdf8' : '#fff', marginTop: '2px' }}>
              {st.count}
            </div>
          </div>
        ))}
      </div>

      {/* FILTER BUTTONS */}
      <div className="filters">
        {statusOptions.map(st => (
          <button
            key={st.key}
            className={statusFilter === st.key ? 'selected' : ''}
            onClick={() => onStatusFilter(st.key)}
          >
            {st.label} ({st.count})
          </button>
        ))}
      </div>

      {/* TABLE PANEL */}
      <div className="panel table-panel">
        <div className="table-head" style={{ gridTemplateColumns: '1.2fr 1.8fr 0.8fr 1fr 1fr 0.8fr 0.8fr' }}>
          <span>Pothole ID</span>
          <span>Address</span>
          <span>Confidence</span>
          <span>Detections</span>
          <span>Detected By</span>
          <span>Status</span>
          <span>Evidence</span>
        </div>

        {loading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#8e9ab1' }}>
            <Loader2 style={{ width: '22px', height: '22px', margin: '0 auto 8px', display: 'block', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '11px' }}>Loading pothole incidents from MongoDB...</span>
          </div>
        ) : error ? (
          <div style={{ padding: '30px 16px', textAlign: 'center', color: '#ff6b81' }}>
            <AlertCircle style={{ width: '22px', height: '22px', margin: '0 auto 8px', display: 'block' }} />
            <b style={{ fontSize: '12px', display: 'block' }}>Failed to load incidents</b>
            <small style={{ fontSize: '10px', color: '#8e9ab1' }}>{error}</small>
          </div>
        ) : potholes.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#8e9ab1' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>No pothole incidents match this filter</span>
            <small style={{ fontSize: '10px', color: '#68758e', marginTop: '4px', display: 'block' }}>
              Try selecting "All" or a different status.
            </small>
          </div>
        ) : (
          potholes.map(p => {
            const confPercent = p.confidence != null
              ? `${Math.round(p.confidence > 1 ? p.confidence : p.confidence * 100)}%`
              : 'N/A';
            const busesList = (p.busesDetectedBy && p.busesDetectedBy.length > 0)
              ? p.busesDetectedBy.join(', ')
              : 'None';
            const displayAddress = p.address && p.address.trim() !== ''
              ? p.address
              : (p.location ? `${p.location.latitude?.toFixed(4)}, ${p.location.longitude?.toFixed(4)}` : 'Coordinates only');
            const hasEvidence = !!(p.videoUrl && p.videoUrl.trim() !== '');

            return (
              <button
                className="table-row"
                key={p.potholeId || p._id}
                onClick={() => onSelect(p)}
                style={{ gridTemplateColumns: '1.2fr 1.8fr 0.8fr 1fr 1fr 0.8fr 0.8fr' }}
              >
                <span>
                  <b style={{ color: '#fff', fontSize: '11px' }}>{p.potholeId}</b>
                  <small style={{ color: '#00ffc4', fontSize: '8px' }}>
                    {p.location ? `${p.location.latitude?.toFixed(4)}, ${p.location.longitude?.toFixed(4)}` : ''}
                  </small>
                </span>
                <span style={{ fontSize: '10px', color: '#cbd5e1', lineHeight: 1.35 }}>
                  {displayAddress}
                </span>
                <span style={{ color: '#3ee2a2', fontWeight: 700 }}>
                  {confPercent}
                </span>
                <span>
                  <b>{p.detectionCount || 1}</b>
                  <small style={{ color: '#8e9ab1' }}>detections</small>
                </span>
                <span>
                  <b style={{ fontSize: '10px', color: '#e2e8f0' }}>{busesList}</b>
                </span>
                <span>
                  <span className={`status-pill ${p.status}`}>{p.status}</span>
                </span>
                <span>
                  {hasEvidence ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        fontWeight: 700
                      }}
                      title="Google Drive Video Available"
                    >
                      <Film style={{ width: 10, height: 10 }} /> Drive
                    </span>
                  ) : (
                    <span style={{ color: '#64748b', fontSize: '9px' }}>None</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}



// ----------------------------------------------------------------------
// SUB-PAGE: SETTINGS
// ----------------------------------------------------------------------
function SettingsPage({ live, setLive, reset, systemStatus, gpsLocation }) {
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <p className="eyebrow">SYSTEM CONFIGURATION</p>
          <h2>RAAHI settings</h2>
          <p>Controls for the edge-to-dashboard pipeline and telemetry integration.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel settings-card">
          <div>
            <b>Live data simulation</b>
            <p>Moves connected demo buses and refreshes GIS telemetry periodically.</p>
          </div>
          <button className={`switch ${live ? 'on' : ''}`} onClick={() => setLive(!live)}>
            <i />
          </button>
        </div>

        <div className="panel settings-card">
          <div>
            <b>Trained YOLO Model</b>
            <p>Active detection weights: {systemStatus.model}</p>
          </div>
          <span className="setting-value">{systemStatus.model}</span>
        </div>

        <div className="panel settings-card">
          <div>
            <b>Video Stream Source</b>
            <p>Active test video: {systemStatus.video} ({systemStatus.frames} frames)</p>
          </div>
          <span className="setting-value">/api/video</span>
        </div>

        <div className="panel settings-card">
          <div>
            <b>GPS Status (Phase 7 Telemetry)</b>
            <p>Real phone GPS position via local Wi-Fi API.</p>
          </div>
          {gpsLocation && gpsLocation.connected ? (
            <span className="setting-value" style={{ color: '#00ffc4', borderColor: '#1b7056', background: '#0d241d' }}>
              GPS: Connected ({gpsLocation.latitude?.toFixed(4)}, {gpsLocation.longitude?.toFixed(4)})
            </span>
          ) : (
            <span className="setting-value" style={{ color: '#8e9ab1', borderColor: '#2c3a4e', background: '#101721' }}>
              GPS: Not connected
            </span>
          )}
        </div>

        {/* DEVELOPER TESTING SECTION (Task 13) */}
        <div className="panel settings-card" style={{ display: 'block' }}>
          <div style={{ marginBottom: 10 }}>
            <b>Developer & Testing: Phone GPS API (Phase 7)</b>
            <p>Send real-time GPS telemetry from a phone or curl script over the local Wi-Fi network.</p>
          </div>
          <div className="developer-curl-box">
            curl -X POST http://192.168.0.78:5001/api/gps \<br />
            &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
            &nbsp;&nbsp;-d '&#123;"latitude":28.6139,"longitude":77.2090,"accuracy":10&#125;'
          </div>
          <p style={{ marginTop: 8, fontSize: '10px', color: '#76859e' }}>
            Mac Local Wi-Fi IP: <code>192.168.0.78:5001</code> • Endpoint: <code>POST /api/gps</code> • Query: <code>GET /api/gps</code>
          </p>
        </div>

        <div className="panel settings-card danger">
          <div>
            <b>Reset demo data</b>
            <p>Restore default demo state in localStorage.</p>
          </div>
          <button className="danger-btn" onClick={reset}>
            <RefreshCw /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}
