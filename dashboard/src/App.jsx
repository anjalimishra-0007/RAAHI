import React, { useState, useEffect } from 'react';
import {
  Play, Square, RotateCw, Video, Settings, Smartphone, HardDrive,
  Cloud, Database, Activity, Film, Radio, MapPin, Cpu
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

  // 1. WebSocket Telemetry connection (routed cleanly through proxy)
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Use window.location.host so Vite proxy (/ws) or direct port 5050 both work seamlessly
      const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;
      
      try {
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

        ws.onerror = () => {
          if (ws) ws.close();
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connectWs, 2000);
        };
      } catch (err) {
        reconnectTimeout = setTimeout(connectWs, 2000);
      }
    };

    connectWs();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
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
    try {
      const res = await fetch('/api/pipeline/start', { method: 'POST' }).then(r => r.json());
      showToast(res.message || 'Pipeline started');
      fetchAllData();
    } catch (e) {
      showToast('Error starting pipeline');
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch('/api/pipeline/stop', { method: 'POST' }).then(r => r.json());
      showToast(res.message || 'Pipeline stopped');
      fetchAllData();
    } catch (e) {
      showToast('Error stopping pipeline');
    }
  };

  const handleRestart = async () => {
    try {
      const res = await fetch('/api/pipeline/restart', { method: 'POST' }).then(r => r.json());
      showToast(res.message || 'Pipeline restarted');
      fetchAllData();
    } catch (e) {
      showToast('Error restarting pipeline');
    }
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

  const comps = pipelineStatus?.components || {};
  const metrics = pipelineStatus?.metrics || {};
  const latestGps = pipelineStatus?.latestGps || null;
  const busId = pipelineStatus?.busId || settingsForm.busId;
  const isPipelineRunning = pipelineStatus?.pipelineRunning || false;

  // Derive genuine rates cleanly without confusing preview with camera
  const cameraInputFps = metrics.inputFps ?? metrics.receiverFps ?? 0.0;
  const avgInputFps = metrics.averageInputFps ?? 0.0;
  const aiLatencyMs = metrics.inferenceLatencyMs ?? 0.0;
  const aiThroughputFps = metrics.processingFps ?? metrics.inferenceFps ?? 0.0;
  const framesReceived = metrics.framesReceived ?? metrics.processedFrames ?? 0;
  const framesDropped = metrics.framesDropped ?? metrics.droppedFrames ?? 0;
  const streamResolution = metrics.resolution || '1920x1080';

  // Overall system operational state
  const isStreamLive = (comps.camera === 'LIVE' || comps.camera === 'STREAMING') && cameraInputFps > 0;
  const isGpsLocked = latestGps && latestGps.isFresh;

  return (
    <div className="ops-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="tactical-toast">
          ✓ {toastMessage}
        </div>
      )}

      {/* 1. MASTER HEADER / SYSTEM IDENTITY */}
      <header className="ops-header">
        <div className="ops-branding">
          <div className="ops-badge-icon">
            <Radio size={20} color="#ffffff" />
          </div>
          <div className="ops-title-group">
            <div className="ops-title-row">
              <span className="ops-title">RAAHI EDGE CONTROL</span>
              <span className="ops-bus-tag mono">{busId}</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.5,
                fontWeight: 700,
                color: isStreamLive ? 'var(--live-green)' : (isPipelineRunning ? 'var(--standby-blue)' : 'var(--text-muted)'),
                marginLeft: 6
              }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: isStreamLive ? 'var(--live-green)' : (isPipelineRunning ? 'var(--standby-blue)' : 'var(--text-dim)'),
                  boxShadow: isStreamLive ? '0 0 8px var(--live-green)' : 'none'
                }} />
                {isStreamLive ? 'LIVE SENSING ACTIVE' : (isPipelineRunning ? 'STANDBY / LISTENING' : 'OFFLINE')}
              </span>
            </div>
            <span className="ops-subtitle">
              Mission-Critical Road Intelligence Gateway • Samsung S23 FE Physical Pipeline
            </span>
          </div>
        </div>

        {/* Master Execution Controls */}
        <div className="ops-controls">
          <button className="btn-tactical btn-primary-start" onClick={handleStart} title="Start real-time inference pipeline">
            <Play size={13} fill="currentColor" /> START
          </button>
          <button className="btn-tactical btn-danger-stop" onClick={handleStop} title="Halt pipeline safely">
            <Square size={13} fill="currentColor" /> STOP
          </button>
          <button className="btn-tactical" onClick={handleRestart} title="Restart RTSP and AI workers">
            <RotateCw size={13} /> RESTART
          </button>
          <button
            className={`btn-tactical ${showLivePreview ? 'btn-toggle-active' : ''}`}
            onClick={() => setShowLivePreview(!showLivePreview)}
            title="Toggle client-side video preview (saves rendering resources)"
          >
            <Video size={13} /> {showLivePreview ? 'HIDE PREVIEW' : 'SHOW PREVIEW'}
          </button>
          <button className="btn-tactical" onClick={() => setShowPhoneModal(true)}>
            <Smartphone size={13} color="var(--warn-amber)" /> PHONE DIAG
          </button>
          <button className="btn-tactical" onClick={() => setShowSettingsModal(true)}>
            <Settings size={13} /> SETTINGS
          </button>
        </div>
      </header>

      {/* 2. PIPELINE STAGE VISUALIZATION (8 HARDWARE/SOFTWARE STAGES) */}
      <div className="pipeline-ribbon">
        <div className="pipeline-nodes-wrapper">
          {/* Stage 1: Camera */}
          <div className={`pipe-node ${isStreamLive ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">1. S23 FE Camera</span>
              <span className="pipe-val mono">{isStreamLive ? '1080p30 H.264' : (comps.camera || 'STANDBY')}</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 2: MediaMTX */}
          <div className={`pipe-node ${comps.mediamtx === 'LIVE' || comps.mediamtx === 'RUNNING' ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">2. MediaMTX</span>
              <span className="pipe-val mono">RTSP :8555</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 3: OpenCV */}
          <div className={`pipe-node ${isStreamLive ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">3. OpenCV</span>
              <span className="pipe-val mono">{cameraInputFps > 0 ? `${cameraInputFps} FPS` : (comps.opencv || 'IDLE')}</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 4: YOLO11n */}
          <div className={`pipe-node ${comps.yolo11n === 'LIVE' || comps.yolo11n === 'INFERRING' ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">4. YOLO11n</span>
              <span className="pipe-val mono">{aiLatencyMs > 0 ? `${aiLatencyMs} ms` : 'MPS READY'}</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 5: Event Engine */}
          <div className={`pipe-node ${comps.eventEngine === 'LIVE' || comps.eventEngine === 'ACTIVE' ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">5. Event Engine</span>
              <span className="pipe-val mono">{metrics.candidatesDetected || 0} DETS</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 6: Evidence Ring Buffer */}
          <div className={`pipe-node ${metrics.ringBufferFrames > 0 ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">6. Ring Buffer</span>
              <span className="pipe-val mono">{metrics.ringBufferFrames || 0} / 90 F</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 7: SQLite DB */}
          <div className={`pipe-node ${comps.localDb === 'LIVE' || comps.localDb === 'ONLINE' ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">7. SQLite DB</span>
              <span className="pipe-val mono">{storageStats?.totalEvents || 0} EVTS</span>
            </div>
          </div>
          <span className="pipe-divider-arrow">➔</span>

          {/* Stage 8: Central Client */}
          <div className={`pipe-node ${comps.centralConnection === 'LIVE' || comps.centralConnection === 'CONNECTED' ? 'node-live' : 'node-offline'}`}>
            <div className="pipe-indicator-dot" />
            <div className="pipe-text-group">
              <span className="pipe-label">8. Central Queue</span>
              <span className="pipe-val mono">{transmissionStats?.pendingCount || 0} PENDING</span>
            </div>
          </div>
        </div>

        {/* Global GPS Fix State Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: isGpsLocked ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
          border: `1px solid ${isGpsLocked ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
          padding: '4px 10px',
          borderRadius: 4,
          flexShrink: 0
        }}>
          <MapPin size={13} color={isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)'} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)' }}>
            {isGpsLocked ? `GNSS LOCKED (±${latestGps?.accuracy || 0}m)` : (latestGps ? `GNSS STALE (${latestGps?.ageSec}s)` : 'NO GNSS FIX')}
          </span>
        </div>
      </div>

      {/* 3. OPERATIONS WORKSPACE BODY */}
      <div className="ops-body-grid">
        {/* LEFT COLUMN: DOMINANT CAMERA FEED & REAL-TIME HARDWARE TELEMETRY */}
        <div className="ops-left-column">
          {/* Primary Hero: Live S23 FE Stream */}
          <div className="camera-hero-panel">
            <div className="camera-viewport">
              {showLivePreview ? (
                <>
                  <img
                    src="/api/video/preview"
                    alt="Live Camera Stream"
                    className="camera-img-stream"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                    }}
                    onLoad={(e) => {
                      e.target.style.display = 'block';
                      if (e.target.nextSibling) e.target.nextSibling.style.display = 'none';
                    }}
                  />
                  <div style={{
                    display: 'none',
                    position: 'absolute',
                    inset: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#040711',
                    color: 'var(--text-muted)',
                    fontSize: 12,
                    flexDirection: 'column',
                    gap: 8
                  }}>
                    <Activity size={24} color="var(--accent-cyan)" />
                    <span>Connecting to physical S23 FE stream (MediaMTX :8555)...</span>
                  </div>
                </>
              ) : (
                <div style={{
                  padding: 40,
                  textAlign: 'center',
                  background: '#040711',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <Video size={28} color="var(--standby-blue)" />
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Live Browser Preview Suspended</div>
                  <div style={{ fontSize: 11, maxWidth: 360 }}>
                    Inference and evidence recording continue at full physical rate (30 FPS) on Apple Silicon MPS in the background.
                  </div>
                </div>
              )}

              {/* HUD Corner Tech Accents */}
              <div className="hud-corner hud-top-left" />
              <div className="hud-corner hud-top-right" />
              <div className="hud-corner hud-bottom-left" />
              <div className="hud-corner hud-bottom-right" />

              {/* HUD Top Strip */}
              <div className="hud-top-strip">
                <div className="hud-status-tag">
                  <div className="hud-status-indicator" style={{
                    backgroundColor: isStreamLive ? 'var(--live-green)' : 'var(--text-muted)',
                    boxShadow: isStreamLive ? '0 0 6px var(--live-green)' : 'none'
                  }} />
                  <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: isStreamLive ? 'var(--live-green)' : 'var(--text-muted)' }}>
                    {isStreamLive ? 'S23 FE H.264 HARDWARE FEED' : 'STREAM STANDBY'}
                  </span>
                </div>
                <div className="hud-status-tag mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                  {busId} • {streamResolution}
                </div>
              </div>

              {/* HUD Bottom Telemetry Ribbon (Fixes 1-2 FPS Display Bug!) */}
              <div className="hud-bottom-telemetry-bar">
                <div className="telemetry-chip-group">
                  {/* Real Physical Camera Ingestion FPS */}
                  <div className="telemetry-chip">
                    <span className="telemetry-chip-label">Camera Input (OpenCV)</span>
                    <span className="telemetry-chip-val mono" style={{ color: cameraInputFps > 20 ? 'var(--live-green)' : 'var(--warn-amber)' }}>
                      {cameraInputFps > 0 ? `${cameraInputFps.toFixed(1)} FPS` : 'STANDBY'}
                      {avgInputFps > 0 && <span style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 4 }}>({avgInputFps.toFixed(1)} avg)</span>}
                    </span>
                  </div>

                  {/* Real YOLO11n MPS Inference Telemetry */}
                  <div className="telemetry-chip">
                    <span className="telemetry-chip-label">YOLO11n (Apple MPS)</span>
                    <span className="telemetry-chip-val mono" style={{ color: 'var(--accent-cyan)' }}>
                      {aiLatencyMs > 0 ? `${aiLatencyMs} ms` : 'READY'}
                      {aiThroughputFps > 0 && <span style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 4 }}>({aiThroughputFps} FPS)</span>}
                    </span>
                  </div>

                  {/* Browser Web Preview Rate (Distinguished Separately) */}
                  <div className="telemetry-chip">
                    <span className="telemetry-chip-label">Web Monitor Preview</span>
                    <span className="telemetry-chip-val mono" style={{ color: 'var(--text-secondary)' }}>
                      {showLivePreview ? (cameraInputFps > 0 ? '~15 FPS (Throttled)' : '0 FPS') : 'DISABLED'}
                    </span>
                  </div>
                </div>

                <div className="telemetry-chip-group">
                  {/* Frame Counters */}
                  <div className="telemetry-chip" style={{ textAlign: 'right' }}>
                    <span className="telemetry-chip-label">Frames Ingested / Dropped</span>
                    <span className="telemetry-chip-val mono" style={{ color: 'var(--text-primary)' }}>
                      {framesReceived.toLocaleString()} RX • <span style={{ color: framesDropped > 0 ? 'var(--warn-amber)' : 'var(--live-green)' }}>{framesDropped} DROP</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Subsystems Telemetry Grid (Perception AI + Physical GNSS) */}
          <div className="subsystems-grid">
            {/* Panel 1: Perception & Detection Telemetry */}
            <div className="tactical-card">
              <div className="card-header-bar">
                <div className="card-title-group">
                  <Cpu size={14} color="var(--accent-cyan)" />
                  <span className="card-title">Perception & AI Telemetry</span>
                </div>
                <span className="card-badge mono" style={{ background: 'rgba(0, 240, 255, 0.1)', color: 'var(--accent-cyan)' }}>
                  YOLO11n MPS
                </span>
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div className="metric-row">
                  <span className="metric-row-label">MPS Inference Latency:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
                    {aiLatencyMs > 0 ? `${aiLatencyMs} ms` : 'NOT MEASURED'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Processing Throughput:</span>
                  <span className="metric-row-val mono">
                    {aiThroughputFps > 0 ? `${aiThroughputFps} FPS` : 'IDLE'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Road Hazards Detected:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>
                    {metrics.candidatesDetected || 0} Candidate Events
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Spatial Suppressions:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--text-muted)' }}>
                    {metrics.candidatesSuppressed || 0} Duplicates Suppressed
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Rolling Ring Buffer:</span>
                  <span className="metric-row-val mono">
                    {metrics.ringBufferFrames || 0} / 90 Frames (~3.0s memory)
                  </span>
                </div>
              </div>
            </div>

            {/* Panel 2: Physical GNSS / GPS Telemetry */}
            <div className="tactical-card">
              <div className="card-header-bar">
                <div className="card-title-group">
                  <MapPin size={14} color="var(--live-green)" />
                  <span className="card-title">Physical GNSS Telemetry</span>
                </div>
                <span className="card-badge mono" style={{
                  background: isGpsLocked ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)'
                }}>
                  {isGpsLocked ? 'LOCK ACQUIRED' : (latestGps ? 'STALE FIX' : 'DISCONNECTED')}
                </span>
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div className="metric-row">
                  <span className="metric-row-label">Coordinates (Lat / Lon):</span>
                  <span className="metric-row-val mono" style={{ color: latestGps ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {latestGps?.latitude ? `${latestGps.latitude.toFixed(6)}, ${latestGps.longitude.toFixed(6)}` : 'WAITING FOR FIX'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Horizontal Accuracy:</span>
                  <span className="metric-row-val mono" style={{ color: isGpsLocked ? 'var(--live-green)' : 'var(--warn-amber)' }}>
                    {latestGps?.accuracy ? `±${latestGps.accuracy} meters` : 'N/A'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Fix Freshness / Age:</span>
                  <span className="metric-row-val mono">
                    {latestGps?.ageSec !== undefined ? `${latestGps.ageSec} seconds ago` : 'N/A'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Ground Speed:</span>
                  <span className="metric-row-val mono">
                    {latestGps?.speed !== undefined && latestGps.speed !== null ? `${latestGps.speed} km/h` : '0.0 km/h'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Telemetry Ingest Port:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
                    HTTP POST :5001 /api/gps
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Subsystems Telemetry Grid (Storage + Transmission) */}
          <div className="subsystems-grid">
            {/* Storage Panel */}
            <div className="tactical-card">
              <div className="card-header-bar">
                <div className="card-title-group">
                  <HardDrive size={14} color="var(--standby-blue)" />
                  <span className="card-title">Edge Storage & Evidence</span>
                </div>
                <span className="card-badge mono" style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--standby-blue)' }}>
                  SQLite WAL Mode
                </span>
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div className="metric-row">
                  <span className="metric-row-label">SQLite DB Disk Footprint:</span>
                  <span className="metric-row-val mono">{storageStats?.databaseSizeMB || 0} MB</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Evidence MP4 Video Clustered:</span>
                  <span className="metric-row-val mono">{storageStats?.evidenceSizeMB || 0} MB</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Total Persistent Events:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
                    {storageStats?.totalEvents || 0} Recorded
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Evidence Video Clips:</span>
                  <span className="metric-row-val mono">{storageStats?.totalClips || 0} Clips (5s H.264)</span>
                </div>
              </div>
            </div>

            {/* Central Cloud Transmission Panel */}
            <div className="tactical-card">
              <div className="card-header-bar">
                <div className="card-title-group">
                  <Cloud size={14} color="var(--accent-cyan)" />
                  <span className="card-title">Central Transmission</span>
                </div>
                <span className="card-badge mono" style={{
                  background: transmissionStats?.connected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                  color: transmissionStats?.connected ? 'var(--live-green)' : 'var(--error-rose)'
                }}>
                  {transmissionStats?.connected ? 'CONNECTED' : 'OFFLINE MODE'}
                </span>
              </div>
              <div style={{ padding: '10px 14px' }}>
                <div className="metric-row">
                  <span className="metric-row-label">Uploaded to Central:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>
                    {transmissionStats?.sentCount || 0} Events
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Pending Transmission Queue:</span>
                  <span className="metric-row-val mono" style={{ color: (transmissionStats?.pendingCount || 0) > 0 ? 'var(--warn-amber)' : 'var(--text-primary)' }}>
                    {transmissionStats?.pendingCount || 0} Payloads
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Transmission Retries / Failed:</span>
                  <span className="metric-row-val mono" style={{ color: (transmissionStats?.failedCount || 0) > 0 ? 'var(--error-rose)' : 'var(--text-dim)' }}>
                    {transmissionStats?.failedCount || 0} Failed
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Architecture Resilience:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>
                    Offline-First Auto Drain
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CANDIDATE EVENT FEED & SYSTEM LOGS */}
        <div className="ops-right-column">
          {/* Real SQLite Events Table */}
          <div className="tactical-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header-bar">
              <div className="card-title-group">
                <Database size={14} color="var(--accent-cyan)" />
                <span className="card-title">Live Candidate Events</span>
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                {events.length} Events Logged
              </span>
            </div>

            <div className="table-scroll-container" style={{ flex: 1 }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Type</th>
                    <th>Confidence</th>
                    <th>GPS Coordinates</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}>
                        No road hazards detected yet. YOLO detections will populate here in real time.
                      </td>
                    </tr>
                  ) : (
                    events.map((ev) => (
                      <tr key={ev.event_id} onClick={() => setSelectedEvent(ev)}>
                        <td className="mono" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{ev.event_id}</td>
                        <td>
                          <span style={{
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: 'rgba(244,63,94,0.15)',
                            color: '#fda4af',
                            fontSize: 9.5,
                            fontWeight: 700
                          }}>
                            {ev.class_name?.toUpperCase() || 'POTHOLE'}
                          </span>
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>{Math.round((ev.edge_confidence || 0) * 100)}%</td>
                        <td className="mono" style={{ fontSize: 10.5, color: ev.latitude ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
                          {ev.latitude ? `${ev.latitude.toFixed(4)}, ${ev.longitude.toFixed(4)}` : 'NO GPS'}
                        </td>
                        <td>
                          <span style={{
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: 'rgba(245,158,11,0.15)',
                            color: 'var(--warn-amber)',
                            fontSize: 9.5,
                            fontWeight: 700
                          }}>
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

          {/* System Diagnostics & Operations Log Console */}
          <div className="tactical-card">
            <div className="card-header-bar">
              <div className="card-title-group">
                <Activity size={14} color="var(--live-green)" />
                <span className="card-title">Operations Console Logs</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['ALL', 'EVENT', 'AI', 'GPS', 'NETWORK'].map((cat) => (
                  <button
                    key={cat}
                    style={{
                      border: 'none',
                      background: logCategory === cat ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      color: logCategory === cat ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      padding: '2px 7px',
                      borderRadius: 3,
                      fontSize: 9.5,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                    onClick={() => setLogCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="log-console-shell">
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>No telemetry logs recorded</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="log-line">
                    <span className="log-time">[{l.timestamp?.split(' ')[1] || '00:00:00'}]</span>
                    <span className="log-tag">{l.category}</span>
                    <span
                      className="log-msg"
                      style={{
                        color: l.level === 'WARNING' ? 'var(--warn-amber)' : (l.level === 'ERROR' ? 'var(--error-rose)' : 'var(--text-secondary)')
                      }}
                    >
                      {l.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. EVENT DETAIL / EVIDENCE MODAL */}
      {selectedEvent && (
        <div className="tactical-modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tactical-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Film size={16} color="var(--accent-cyan)" />
                <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
                  CANDIDATE EVENT EVIDENCE: {selectedEvent.event_id}
                </h3>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
                onClick={() => setSelectedEvent(null)}
              >
                ✕
              </button>
            </div>

            <div className="tactical-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14, fontSize: 11.5 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>Hazard Type:</span> <b>{selectedEvent.event_type?.toUpperCase()}</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>YOLO Confidence:</span> <b>{Math.round((selectedEvent.edge_confidence || 0) * 100)}%</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>Detection Time:</span> <b className="mono">{selectedEvent.timestamp}</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>Bus Identifier:</span> <b className="mono">{selectedEvent.bus_id}</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>GNSS Fix:</span> <b className="mono">{selectedEvent.latitude?.toFixed(6)}, {selectedEvent.longitude?.toFixed(6)}</b></div>
                <div><span style={{ color: 'var(--text-muted)' }}>Status:</span> <b style={{ color: 'var(--warn-amber)' }}>{selectedEvent.verification_status}</b></div>
              </div>

              {/* Video Player or Keyframe Viewer */}
              <div style={{ background: '#02040a', borderRadius: 4, padding: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase' }}>
                  SYNCHRONIZED EVIDENCE PLAYBACK (~5.0s H.264 MP4)
                </div>
                {selectedEvent.evidence_clip_path ? (
                  <video
                    controls
                    autoPlay
                    src={`/api/evidence/${selectedEvent.event_id}_evidence.mp4`}
                    style={{ width: '100%', borderRadius: 4, maxHeight: 260 }}
                  />
                ) : selectedEvent.evidence_frame_paths?.[0] ? (
                  <img
                    src={`/api/evidence/${selectedEvent.event_id}_keyframe.jpg`}
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
                <button className="btn-tactical" onClick={() => setSelectedEvent(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. PHONE DIAGNOSTICS MODAL */}
      {showPhoneModal && (
        <div className="tactical-modal-backdrop" onClick={() => setShowPhoneModal(false)}>
          <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tactical-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Smartphone size={16} color="var(--warn-amber)" />
                <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
                  SAMSUNG GALAXY S23 FE DIAGNOSTICS
                </h3>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
                onClick={() => setShowPhoneModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="tactical-modal-body">
              <div style={{ background: '#030610', padding: 12, borderRadius: 4, border: '1px solid var(--border-subtle)', marginBottom: 12, fontSize: 11.5 }}>
                <div className="metric-row">
                  <span className="metric-row-label">Physical Hardware Model:</span>
                  <span className="metric-row-val mono">Samsung Galaxy S23 FE ({phoneDiag?.adbDevice || 'SM-S711B'})</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Android OS Version:</span>
                  <span className="metric-row-val mono">Android {phoneDiag?.androidVersion || '16'}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Phone Wi-Fi Hotspot Gateway:</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--accent-cyan)' }}>{phoneDiag?.hotspotIp || '10.147.108.78'}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Hotspot ICMP Ping Latency:</span>
                  <span className="metric-row-val mono">
                    {phoneDiag?.hotspotPingMs ? `${phoneDiag.hotspotPingMs} ms` : 'N/A'} ({phoneDiag?.hotspotReachable ? 'Reachable' : 'Standby'})
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">Mac Wi-Fi Host IP (MediaMTX):</span>
                  <span className="metric-row-val mono" style={{ color: 'var(--live-green)' }}>{phoneDiag?.macIp || '10.147.108.80'}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">ADB Hardware Diagnostic Link:</span>
                  <span className="metric-row-val mono">
                    {phoneDiag?.adbConnected ? '🟢 Connected (USB-C Debugging)' : '🟡 Wireless Ingestion Active'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-row-label">MediaMTX RTSP Target:</span>
                  <span className="metric-row-val mono">rtsp://{phoneDiag?.macIp || '10.147.108.80'}:8555/live</span>
                </div>
              </div>

              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                RootEncoder logcat inspection command:<br />
                <code className="mono" style={{ color: 'var(--accent-cyan)', background: 'rgba(0,240,255,0.06)', padding: '2px 6px', borderRadius: 3, display: 'inline-block', marginTop: 4 }}>
                  adb logcat -s RootEncoder CameraManager RAAHI_GPS
                </code>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn-tactical" onClick={() => setShowPhoneModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="tactical-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tactical-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={16} color="var(--standby-blue)" />
                <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
                  RAAHI EDGE CONTROL SETTINGS
                </h3>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
                onClick={() => setShowSettingsModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="tactical-modal-body">
              <div className="tactical-form-group">
                <label className="tactical-form-label">Bus Identifier</label>
                <input
                  type="text"
                  className="tactical-input"
                  value={settingsForm.busId}
                  onChange={(e) => setSettingsForm({ ...settingsForm, busId: e.target.value })}
                />
              </div>

              <div className="tactical-form-group">
                <label className="tactical-form-label">MediaMTX RTSP URL</label>
                <input
                  type="text"
                  className="tactical-input"
                  value={settingsForm.rtspUrl}
                  onChange={(e) => setSettingsForm({ ...settingsForm, rtspUrl: e.target.value })}
                />
              </div>

              <div className="tactical-form-group">
                <label className="tactical-form-label">Central Ingestion Service URL</label>
                <input
                  type="text"
                  className="tactical-input"
                  value={settingsForm.centralUrl}
                  onChange={(e) => setSettingsForm({ ...settingsForm, centralUrl: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="tactical-form-group">
                  <label className="tactical-form-label">YOLO Confidence Threshold (0.0 - 1.0)</label>
                  <input
                    type="number"
                    step="0.05"
                    className="tactical-input"
                    value={settingsForm.confThreshold}
                    onChange={(e) => setSettingsForm({ ...settingsForm, confThreshold: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="tactical-form-group">
                  <label className="tactical-form-label">Evidence Pre-Buffer (seconds)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="tactical-input"
                    value={settingsForm.preBufferSec}
                    onChange={(e) => setSettingsForm({ ...settingsForm, preBufferSec: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button type="button" className="btn-tactical" onClick={() => setShowSettingsModal(false)}>Cancel</button>
                <button type="submit" className="btn-tactical btn-primary-start">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
