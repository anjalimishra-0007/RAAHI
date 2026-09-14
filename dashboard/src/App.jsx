import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Square, RotateCw, Video, Settings, Smartphone, HardDrive,
  Cloud, AlertTriangle, CheckCircle2, XCircle, Clock, ShieldAlert,
  ChevronRight, Database, Activity, RefreshCw, Layers, ExternalLink,
  Film, Filter, Radio, Eye
} from 'lucide-react';
import './styles.css';

export default function App() {
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [storageStats, setStorageStats] = useState(null);
  const [transmissionStats, setTransmissionStats] = useState(null);
  const [phoneDiag, setPhoneDiag] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logCategory, setLogCategory] = useState('ALL');
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [settingsForm, setSettingsForm] = useState({
    busId: 'RAAHI-001',
    rtspUrl: 'rtsp://127.0.0.1:8555/live',
    centralUrl: 'http://localhost:5001',
    confThreshold: 0.35,
    preBufferSec: 2.0,
    postBufferSec: 3.0
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // 1. WebSocket Telemetry connection
  useEffect(() => {
    let ws;
    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:5050/ws/telemetry`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.health) setPipelineStatus(data.health);
          if (data.storage) setStorageStats(data.storage);
          if (data.phone) setPhoneDiag(data.phone);
        } catch (e) {
          // parse error
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => setTimeout(connectWs, 2500);
    };

    connectWs();
    return () => {
      if (ws) ws.close();
    };
  }, []);

  // 2. Periodic Polling for Data & Logs
  const fetchAllData = async () => {
    try {
      const [pRes, sRes, tRes, eRes, lRes] = await Promise.all([
        fetch('/api/pipeline/status').then(r => r.json()).catch(() => null),
        fetch('/api/storage/stats').then(r => r.json()).catch(() => null),
        fetch('/api/transmission/stats').then(r => r.json()).catch(() => null),
        fetch('/api/events?limit=25').then(r => r.json()).catch(() => ({ events: [] })),
        fetch(`/api/logs?limit=40&category=${logCategory}`).then(r => r.json()).catch(() => ({ logs: [] }))
      ]);

      if (pRes) setPipelineStatus(pRes);
      if (sRes) setStorageStats(sRes);
      if (tRes) setTransmissionStats(tRes);
      if (eRes && eRes.events) setEvents(eRes.events);
      if (lRes && lRes.logs) setLogs(lRes.logs);
    } catch (err) {
      console.warn('Poll error:', err);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 2000);
    return () => clearInterval(interval);
  }, [logCategory]);

  // Load settings on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data) setSettingsForm(data);
      })
      .catch(() => {});
  }, []);

  // Pipeline Actions
  const handleStart = async () => {
    const res = await fetch('/api/pipeline/start', { method: 'POST' }).then(r => r.json());
    showToast(res.message || 'Pipeline started');
    fetchAllData();
  };

  const handleStop = async () => {
    const res = await fetch('/api/pipeline/stop', { method: 'POST' }).then(r => r.json());
    showToast(res.message || 'Pipeline stopped');
    fetchAllData();
  };

  const handleRestart = async () => {
    const res = await fetch('/api/pipeline/restart', { method: 'POST' }).then(r => r.json());
    showToast(res.message || 'Pipeline restarted');
    fetchAllData();
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsForm)
    });
    setShowSettingsModal(false);
    showToast('Edge settings updated successfully');
    fetchAllData();
  };

  // Status Pill Helper
  const renderDotClass = (statusStr) => {
    if (!statusStr) return 'dot-amber';
    const s = statusStr.toUpperCase();
    if (s === 'ONLINE' || s === 'RUNNING' || s === 'STREAMING' || s === 'CONNECTED' || s === 'ACTIVE' || s === 'INFERRING') return 'dot-green';
    if (s === 'CONNECTING' || s === 'STANDBY' || s === 'READY' || s === 'INITIALIZING') return 'dot-amber';
    return 'dot-red';
  };

  const comps = pipelineStatus?.components || {};
  const metrics = pipelineStatus?.metrics || {};
  const busId = pipelineStatus?.busId || settingsForm.busId;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 200,
          background: '#10b981',
          color: '#fff',
          padding: '10px 18px',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 13,
          boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)'
        }}>
          ✓ {toastMessage}
        </div>
      )}

      {/* TOP HEADER */}
      <header className="header-bar">
        <div className="brand-badge">
          <div className="brand-logo">
            <Radio size={22} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}>RAAHI EDGE CONTROL</h1>
              <span className="bus-badge">{busId}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Bus-Side Edge AI • Samsung S23 FE Pipeline
            </div>
          </div>
        </div>

        {/* Master Execution Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-start" onClick={handleStart}>
            <Play size={15} fill="currentColor" /> START RAAHI EDGE
          </button>
          <button className="btn btn-stop" onClick={handleStop}>
            <Square size={14} fill="currentColor" /> STOP
          </button>
          <button className="btn btn-outline" onClick={handleRestart}>
            <RotateCw size={14} /> RESTART
          </button>
          <button
            className="btn btn-outline"
            style={{ color: showLivePreview ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}
            onClick={() => setShowLivePreview(!showLivePreview)}
          >
            <Video size={15} /> {showLivePreview ? 'HIDE LIVE' : 'VIEW LIVE'}
          </button>
          <button className="btn btn-outline" onClick={() => setShowPhoneModal(true)}>
            <Smartphone size={15} /> PHONE DIAG
          </button>
          <button className="btn btn-outline" onClick={() => setShowSettingsModal(true)}>
            <Settings size={15} /> SETTINGS
          </button>
        </div>
      </header>

      {/* SERVICE HEALTH GRID (9 PILLS) */}
      <div className="health-grid">
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.camera)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Camera</div>
            <b style={{ fontSize: 11 }}>{comps.camera || 'STANDBY'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.rtsp)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>RTSP Port 8555</div>
            <b style={{ fontSize: 11 }}>{comps.rtsp || 'ONLINE'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.mediamtx)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>MediaMTX</div>
            <b style={{ fontSize: 11 }}>{comps.mediamtx || 'RUNNING'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.opencv)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>OpenCV Receiver</div>
            <b style={{ fontSize: 11 }}>{comps.opencv || 'STOPPED'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.yolo11n)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>YOLO11n (MPS)</div>
            <b style={{ fontSize: 11 }}>{comps.yolo11n || 'READY'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.gps)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>GPS Fix</div>
            <b style={{ fontSize: 11 }}>{comps.gps || 'DISCONNECTED'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.eventEngine)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Event Engine</div>
            <b style={{ fontSize: 11 }}>{comps.eventEngine || 'IDLE'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.localDb)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SQLite DB</div>
            <b style={{ fontSize: 11 }}>{comps.localDb || 'ONLINE'}</b>
          </div>
        </div>
        <div className="health-pill">
          <div className={`health-dot ${renderDotClass(comps.centralConnection)}`} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Central Client</div>
            <b style={{ fontSize: 11 }}>{comps.centralConnection || 'OFFLINE'}</b>
          </div>
        </div>
      </div>

      {/* PIPELINE FLOW DIAGRAM */}
      <div style={{ padding: '0 24px 16px' }}>
        <div className="glass-panel" style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 8px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>LIVE EDGE PROCESSING PIPELINE</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
              Inference: {metrics.inferenceFps || 0} FPS • Latency: {metrics.inferenceLatencyMs || 0} ms • Frame #{metrics.processedFrames || 0}
            </span>
          </div>
          <div className="pipeline-flow">
            <div className={`flow-node ${comps.camera === 'STREAMING' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>S23 FE Camera</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>1080p30 H.264</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${comps.rtsp === 'ONLINE' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>RTSP Stream</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>TCP :8555</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${comps.opencv === 'STREAMING' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>OpenCV Receiver</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{metrics.receiverFps || 0} FPS</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${comps.yolo11n === 'INFERRING' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>YOLO11n MPS</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{metrics.inferenceFps || 0} FPS</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${metrics.candidatesDetected > 0 ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Candidate Events</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{metrics.candidatesDetected || 0} Det</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${storageStats?.totalClips > 0 ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Evidence Clip</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>5s H.264 MP4</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${comps.localDb === 'ONLINE' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>SQLite DB</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>WAL Mode</div>
            </div>
            <span className="flow-arrow">➔</span>
            <div className={`flow-node ${comps.centralConnection === 'CONNECTED' ? 'active' : ''}`}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>Central Queue</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{storageStats?.pendingQueue || 0} Pending</div>
            </div>
          </div>
        </div>
      </div>

      {/* DASHBOARD BODY */}
      <div className="dashboard-body">
        {/* LEFT COLUMN: LIVE VIDEO & TELEMETRY */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Live Preview Card */}
          <div className="glass-panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Video size={16} color="var(--accent-cyan)" /> Live S23 FE Camera Feed
              </span>
              <span className="mono" style={{ fontSize: 11, color: comps.camera === 'STREAMING' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                {comps.camera === 'STREAMING' ? '● LIVE STREAM ACTIVE' : '○ STREAM STANDBY'}
              </span>
            </div>

            {showLivePreview ? (
              <div className="preview-screen">
                <img
                  src="/api/video/preview"
                  alt="Live Camera Feed"
                  className="preview-img"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                  onLoad={(e) => {
                    e.target.style.display = 'block';
                    if (e.target.nextSibling) e.target.nextSibling.style.display = 'none';
                  }}
                />
                <div style={{ display: 'none', position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', background: '#090d16', color: 'var(--text-muted)', fontSize: 12 }}>
                  Connecting to S23 FE RTSP stream...
                </div>
                <div className="hud-overlay">
                  RAAHI-001 • {metrics.resolution || '1920x1080'} • {metrics.inferenceFps || 0} FPS • {metrics.candidatesDetected || 0} DETS
                </div>
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center', background: '#040711', borderRadius: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                Live preview hidden to conserve local GPU/display rendering resources. Inference continues at full speed in the background.
              </div>
            )}
          </div>

          {/* Storage & Central Transmission Monitors */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Storage Monitor */}
            <div className="glass-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <HardDrive size={15} color="var(--accent-emerald)" /> Local Persistent Storage
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>SQLite Database:</span>
                  <b className="mono">{storageStats?.databaseSizeMB || 0} MB</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Evidence MP4s:</span>
                  <b className="mono">{storageStats?.evidenceSizeMB || 0} MB</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Storage:</span>
                  <b className="mono" style={{ color: 'var(--accent-cyan)' }}>{storageStats?.totalStorageMB || 0} MB</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Saved Events:</span>
                  <b className="mono">{storageStats?.totalEvents || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Evidence Clips:</span>
                  <b className="mono">{storageStats?.totalClips || 0}</b>
                </div>
              </div>
            </div>

            {/* Central Transmission Monitor */}
            <div className="glass-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Cloud size={15} color="var(--accent-cyan)" /> Central Transmission
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                  <b style={{ color: transmissionStats?.connected ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                    {transmissionStats?.connected ? 'CONNECTED' : 'OFFLINE'}
                  </b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Sent to Central:</span>
                  <b className="mono" style={{ color: 'var(--accent-emerald)' }}>{transmissionStats?.sentCount || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Pending Queue:</span>
                  <b className="mono" style={{ color: 'var(--accent-amber)' }}>{transmissionStats?.pendingCount || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Failed Retries:</span>
                  <b className="mono" style={{ color: 'var(--accent-rose)' }}>{transmissionStats?.failedCount || 0}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Queue Mode:</span>
                  <span style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>Offline-First Auto Drain</span>
                </div>
              </div>
            </div>
          </div>

          {/* S23 FE Hardware Telemetry */}
          <div className="glass-panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Smartphone size={15} color="var(--accent-amber)" /> Physical Samsung S23 FE Telemetry
              </span>
              <span className="mono" style={{ fontSize: 11, color: phoneDiag?.hotspotReachable ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                Hotspot: {phoneDiag?.hotspotIp || '10.159.195.5'} ({phoneDiag?.hotspotPingMs || '5.7'} ms)
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>ADB Link:</span><br />
                <b>{phoneDiag?.adbConnected ? '🟢 Connected' : '🟡 Wi-Fi Stream'}</b>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>Device Model:</span><br />
                <b>Samsung S23 FE</b>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 6 }}>
                <span style={{ color: 'var(--text-muted)' }}>MediaMTX Listener:</span><br />
                <b style={{ color: 'var(--accent-emerald)' }}>Port 8555 Ready</b>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: DATA INSPECTOR & SYSTEM LOGS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Data Inspector (Real SQLite Events) */}
          <div className="glass-panel" style={{ padding: 14, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Database size={16} color="var(--accent-cyan)" /> Local Data Inspector (SQLite)
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {events.length} Candidate Events Persisted
              </span>
            </div>

            <div className="events-table-shell">
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Type</th>
                    <th>Confidence</th>
                    <th>GPS Fix</th>
                    <th>Central Status</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                        No events recorded yet. Detections will appear here in real time.
                      </td>
                    </tr>
                  ) : (
                    events.map((ev) => (
                      <tr key={ev.event_id} onClick={() => setSelectedEvent(ev)}>
                        <td className="mono" style={{ color: 'var(--accent-cyan)' }}>{ev.event_id}</td>
                        <td>
                          <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(244,63,94,0.15)', color: '#fb7185', fontSize: 10, fontWeight: 700 }}>
                            {ev.class_name?.toUpperCase() || 'POTHOLE'}
                          </span>
                        </td>
                        <td className="mono">{Math.round((ev.edge_confidence || 0) * 100)}%</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {ev.latitude ? `${ev.latitude.toFixed(4)}, ${ev.longitude.toFixed(4)}` : 'No GPS'}
                        </td>
                        <td>
                          <span style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', fontSize: 10, fontWeight: 700 }}>
                            {ev.verification_status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Real-time System Log Console */}
          <div className="glass-panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={15} color="var(--accent-emerald)" /> System Telemetry Logs
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {['ALL', 'EVENT', 'AI', 'GPS', 'NETWORK'].map((cat) => (
                  <button
                    key={cat}
                    style={{
                      border: 'none',
                      background: logCategory === cat ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      color: logCategory === cat ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onClick={() => setLogCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="log-console">
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>No logs yet</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="log-entry">
                    <span className="log-ts">[{l.timestamp?.split(' ')[1] || '00:00:00'}]</span>
                    <span className="log-cat">{l.category}</span>
                    <span style={{ color: l.level === 'WARNING' ? '#fbbf24' : (l.level === 'ERROR' ? '#f43f5e' : 'var(--text-primary)') }}>
                      {l.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* EVENT DETAIL MODAL / DRAWER */}
      {selectedEvent && (
        <div className="modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Candidate Event Details: {selectedEvent.event_id}</h3>
              <button style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }} onClick={() => setSelectedEvent(null)}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, fontSize: 12 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Event Type:</span> <b>{selectedEvent.event_type}</b></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Confidence:</span> <b>{Math.round((selectedEvent.edge_confidence || 0) * 100)}%</b></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Timestamp:</span> <b>{selectedEvent.timestamp}</b></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Bus Identifier:</span> <b>{selectedEvent.bus_id}</b></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Coordinates:</span> <b>{selectedEvent.latitude?.toFixed(6)}, {selectedEvent.longitude?.toFixed(6)}</b></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Verification:</span> <b style={{ color: '#fbbf24' }}>{selectedEvent.verification_status}</b></div>
            </div>

            {/* Evidence Video / Keyframe Preview */}
            <div style={{ background: '#040711', borderRadius: 8, padding: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>CAPTURED EVIDENCE PREVIEW</div>
              {selectedEvent.evidence_clip_path ? (
                <video
                  controls
                  src={`/api/evidence/${selectedEvent.event_id}_evidence.mp4`}
                  style={{ width: '100%', borderRadius: 6, maxHeight: 240 }}
                />
              ) : selectedEvent.evidence_frame_paths?.[0] ? (
                <img
                  src={`/api/evidence/${selectedEvent.event_id}_keyframe.jpg`}
                  alt="Keyframe"
                  style={{ width: '100%', borderRadius: 6, maxHeight: 240, objectFit: 'contain' }}
                />
              ) : (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Evidence clip recording in progress or pending generation.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-outline" onClick={() => setSelectedEvent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>RAAHI-Edge Bus Settings</h3>
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
              <div>
                <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Bus Identifier</label>
                <input
                  type="text"
                  value={settingsForm.busId}
                  onChange={(e) => setSettingsForm({ ...settingsForm, busId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', background: '#090d16', border: '1px solid var(--border-color)', color: '#fff', borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>MediaMTX RTSP URL</label>
                <input
                  type="text"
                  value={settingsForm.rtspUrl}
                  onChange={(e) => setSettingsForm({ ...settingsForm, rtspUrl: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', background: '#090d16', border: '1px solid var(--border-color)', color: '#fff', borderRadius: 6 }}
                />
              </div>
              <div>
                <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Central Ingestion URL</label>
                <input
                  type="text"
                  value={settingsForm.centralUrl}
                  onChange={(e) => setSettingsForm({ ...settingsForm, centralUrl: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', background: '#090d16', border: '1px solid var(--border-color)', color: '#fff', borderRadius: 6 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>YOLO Confidence (0-1)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={settingsForm.confThreshold}
                    onChange={(e) => setSettingsForm({ ...settingsForm, confThreshold: parseFloat(e.target.value) })}
                    style={{ width: '100%', padding: '8px 12px', background: '#090d16', border: '1px solid var(--border-color)', color: '#fff', borderRadius: 6 }}
                  />
                </div>
                <div>
                  <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Evidence Pre-Buffer (s)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={settingsForm.preBufferSec}
                    onChange={(e) => setSettingsForm({ ...settingsForm, preBufferSec: parseFloat(e.target.value) })}
                    style={{ width: '100%', padding: '8px 12px', background: '#090d16', border: '1px solid var(--border-color)', color: '#fff', borderRadius: 6 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowSettingsModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-start">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* S23 FE PHONE DIAGNOSTIC MODAL */}
      {showPhoneModal && (
        <div className="modal-backdrop" onClick={() => setShowPhoneModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Samsung Galaxy S23 FE Diagnostics</h3>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--text-secondary)' }}>
              <p>The physical Samsung Galaxy S23 FE connects via Wi-Fi hotspot for RTSP streaming and USB-C for ADB diagnostics.</p>
              <div style={{ background: '#040711', padding: 12, borderRadius: 6 }}>
                <div><b>Wi-Fi Hotspot IP:</b> {phoneDiag?.hotspotIp || '10.159.195.5'}</div>
                <div><b>Latency:</b> {phoneDiag?.hotspotPingMs || '5.7'} ms ({phoneDiag?.hotspotReachable ? 'Reachable' : 'Unreachable'})</div>
                <div><b>MediaMTX RTSP Target:</b> rtsp://10.159.195.80:8555/live</div>
                <div><b>ADB Device Status:</b> {phoneDiag?.adbConnected ? '🟢 Connected' : '🟡 USB cable disconnected / Wi-Fi mode active'}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Tip: To inspect real-time RootEncoder Android logs, plug in the USB-C cable and run:<br />
                <code style={{ color: 'var(--accent-cyan)' }}>adb logcat -s RootEncoder CameraManager</code>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn btn-outline" onClick={() => setShowPhoneModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
