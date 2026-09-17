import React from 'react';
import {
  Layers3,
  Siren,
  Radio,
  TrendingUp,
  Activity,
  BusFront,
  Smartphone,
  Camera,
  Settings
} from 'lucide-react';

/**
 * Sidebar Navigation Component
 *
 * Visually and architecturally separates:
 * 1. CENTRAL COMMAND (Core authoritative incident ops, candidates, analytics, system health)
 * 2. EDGE / TESTING (Simulation fleet, phone GPS & phone camera streams)
 * 3. CONFIGURATION (Settings)
 */
export default function Sidebar({
  page,
  setPage,
  menuOpen,
  openIncidentsCount = 0,
  systemStatus = {}
}) {
  return (
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <span></span>
          <span></span>
        </div>
        <div>
          <h1>RAAHI</h1>
          <p>Safer Roads. Brighter Journeys.</p>
        </div>
      </div>

      <nav>
        {/* ============================================================ */}
        {/* SECTION: CENTRAL COMMAND                                     */}
        {/* ============================================================ */}
        <div className="nav-section-label">CENTRAL COMMAND</div>

        <button
          className={page === 'overview' ? 'active' : ''}
          onClick={() => setPage('overview')}
        >
          <Layers3 /> Command Center
        </button>

        <button
          className={page === 'incidents' ? 'active' : ''}
          onClick={() => setPage('incidents')}
        >
          <Siren /> Authoritative Incidents <em>{openIncidentsCount}</em>
        </button>

        <button
          className={page === 'candidates' ? 'active' : ''}
          onClick={() => setPage('candidates')}
          title="Candidate Events Ingestion & Promotion Pipeline"
        >
          <Radio style={{ color: page === 'candidates' ? '#9b6cff' : '#a78bfa' }} />
          Candidate Pipeline
        </button>

        <button
          className={page === 'analytics' ? 'active' : ''}
          onClick={() => setPage('analytics')}
        >
          <TrendingUp /> Analytics &amp; Fusion
        </button>

        <button
          className={page === 'health' ? 'active' : ''}
          onClick={() => setPage('health')}
        >
          <Activity /> System Health
        </button>

        {/* ============================================================ */}
        {/* SECTION: EDGE & TESTING                                      */}
        {/* ============================================================ */}
        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          EDGE / TESTING
        </div>

        <button
          className={page === 'buses' ? 'active' : ''}
          onClick={() => setPage('buses')}
        >
          <BusFront /> Fleet <span className="demo-tag">DEMO</span>
        </button>

        <button
          className={page === 'gps' ? 'active' : ''}
          onClick={() => setPage('gps')}
          style={{ color: page === 'gps' ? '#00ffc4' : '#38bdf8' }}
        >
          <Smartphone /> Phone GPS
        </button>

        <button
          className={page === 'camera' ? 'active' : ''}
          onClick={() => setPage('camera')}
          style={{ color: page === 'camera' ? '#ff496c' : '#38bdf8' }}
        >
          <Camera /> Phone Camera
        </button>

        {/* ============================================================ */}
        {/* SECTION: CONFIGURATION                                       */}
        {/* ============================================================ */}
        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          CONFIGURATION
        </div>

        <button
          className={page === 'settings' ? 'active' : ''}
          onClick={() => setPage('settings')}
        >
          <Settings /> Settings
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="system">
          <span className="online-dot"></span>
          <div>
            <b>Central Platform • Active</b>
            <small>Spatial Fusion & Ingestion</small>
          </div>
        </div>
        <small>RAAHI Central Command • v1.0</small>
      </div>
    </aside>
  );
}
