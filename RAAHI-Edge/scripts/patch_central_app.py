#!/usr/bin/env python3
"""
Patch script for RAAHI22 Central App.jsx:
1. Replaces mockData imports with fetchFleetBuses and fetchTrafficIncidents from ./services/api.
2. Replaces simulated initialBuses state with real buses and trafficIncidents state.
3. Removes 4-second demo bus movement interval.
4. Updates data fetching hooks to load real buses and traffic incidents.
5. Updates MapView props to pass real buses, traffic incidents, and enable live fleet display.
6. Modernizes FleetPage to display real connected fleet with empty state.
"""

APP_PATH = "/Users/ujjwalraj/Desktop/RAAHI22/raahi-pothole-detection/dashboard/src/App.jsx"

with open(APP_PATH, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Update API imports
old_api_import = """import {
  fetchPotholes as apiFetchPotholes,
  fetchPotholeStats as apiFetchPotholeStats,
  fetchCandidate as apiFetchCandidate,
  fetchCandidates as apiFetchCandidates,
  fetchEvidenceStatus as apiFetchEvidenceStatus
} from './services/api';"""

new_api_import = """import {
  fetchPotholes as apiFetchPotholes,
  fetchPotholeStats as apiFetchPotholeStats,
  fetchCandidate as apiFetchCandidate,
  fetchCandidates as apiFetchCandidates,
  fetchEvidenceStatus as apiFetchEvidenceStatus,
  fetchFleetBuses,
  fetchTrafficIncidents
} from './services/api';"""

code = code.replace(old_api_import, new_api_import)

# Remove mockData import
code = code.replace("import { initialBuses } from './data/mockData';", "// import { initialBuses } from './data/mockData';")

# 2. Update initial state and loadState
old_state_def = "  const [{ buses, incidents }, setData] = useState(loadState);"
new_state_def = """  const [buses, setBuses] = useState([]);
  const [trafficIncidents, setTrafficIncidents] = useState([]);
  const [{ incidents }, setData] = useState({ incidents: [] });"""

code = code.replace(old_state_def, new_state_def)

# 3. Add fetchBusesData and fetchTrafficData functions
data_fetchers = """
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
"""

marker_for_fetchers = "  const fetchEvidenceData = async () => {"
if "fetchBusesData" not in code:
    code = code.replace(marker_for_fetchers, data_fetchers + "\n" + marker_for_fetchers)

# 4. Include fetchBusesData and fetchTrafficData in initial useEffect and polling useEffect
old_initial_effect = """    fetchPotholes('All');
    fetchPotholeStats();
    fetchCandidatesData();
    fetchEvidenceData();"""

new_initial_effect = """    fetchPotholes('All');
    fetchPotholeStats();
    fetchCandidatesData();
    fetchEvidenceData();
    fetchBusesData();
    fetchTrafficData();"""

code = code.replace(old_initial_effect, new_initial_effect)

old_poll_effect = """      fetchPotholes(statusFilter);
      fetchPotholeStats();
      fetchCandidatesData();"""

new_poll_effect = """      fetchPotholes(statusFilter);
      fetchPotholeStats();
      fetchCandidatesData();
      fetchBusesData();
      fetchTrafficData();"""

code = code.replace(old_poll_effect, new_poll_effect)

# In handleRefresh:
old_refresh = """    await Promise.all([
      fetchPotholes(statusFilter),
      fetchPotholeStats(),
      fetchCandidatesData(),
      fetchEvidenceData()
    ]);"""

new_refresh = """    await Promise.all([
      fetchPotholes(statusFilter),
      fetchPotholeStats(),
      fetchCandidatesData(),
      fetchEvidenceData(),
      fetchBusesData(),
      fetchTrafficData()
    ]);"""

code = code.replace(old_refresh, new_refresh)

# 5. Remove simulated demo bus movement useEffect
old_sim_effect = """  // Demo bus movement simulation (clearly marked as demo)
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setData(s => ({
        buses: s.buses.map((b, i) =>
          b.status === 'online'
            ? {
                ...b,
                lat: b.lat + (i % 2 ? 0.00018 : -0.00012),
                lng: b.lng + (i % 3 ? 0.00013 : -0.0001),
                speed: Math.max(8, Math.min(48, b.speed + (Math.random() > 0.5 ? 1 : -1)))
              }
            : b
        ),
        incidents: s.incidents
      }));
    }, 4000);
    return () => clearInterval(id);
  }, [live]);"""

new_sim_effect = """  // Real-time bus telemetry refreshed from /api/fleet/buses
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      fetchBusesData();
      fetchTrafficData();
    }, 3000);
    return () => clearInterval(id);
  }, [live]);"""

code = code.replace(old_sim_effect, new_sim_effect)

# 6. Update MapView invocation
old_mapview_call = """                  <MapView
                    mode="central"
                    potholes={displayedPotholes}
                    showFleet={false}
                    onSelectIncident={selectIncident}
                    loading={loadingPotholes}
                    error={potholesError}
                  />"""

new_mapview_call = """                  <MapView
                    mode="central"
                    potholes={displayedPotholes}
                    buses={buses}
                    trafficIncidents={trafficIncidents}
                    gpsLocation={gpsLocation}
                    showFleet={true}
                    onSelectIncident={selectIncident}
                    loading={loadingPotholes}
                    error={potholesError}
                  />"""

code = code.replace(old_mapview_call, new_mapview_call)

# 7. Update FleetPage component
old_fleet_page = """function FleetPage({ buses, setPage }) {
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <p className="eyebrow">
            FLEET MANAGEMENT <span className="demo-tag">DEMO FLEET SIMULATION</span>
          </p>
          <h2>Connected bus fleet</h2>
          <p>
            Simulated vehicle positions and edge-device health (12 demo buses).
            Real hardware GPS telemetry will replace this once hardware units are connected.
          </p>
        </div>
        <button className="secondary" onClick={() => setPage('overview')}>
          <MapPinned /> Open GIS
        </button>
      </div>

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
              <p>{b.route}</p>
              <div className="fleet-metrics">
                <span>
                  <Gauge /> {b.speed} km/h
                </span>
                <span>
                  <Camera /> {b.camera ? 'Online' : 'Offline'}
                </span>
                <span>
                  <MapPinned /> {b.lat.toFixed(4)}, {b.lng.toFixed(4)} <small style={{ color: '#ffb42d' }}>[DEMO]</small>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}"""

new_fleet_page = """function FleetPage({ buses = [], setPage }) {
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
}"""

code = code.replace(old_fleet_page, new_fleet_page)

with open(APP_PATH, "w", encoding="utf-8") as f:
    f.write(code)

print("Patched App.jsx cleanly")
