import React from 'react';
import RaahiLogo from '../common/RaahiLogo';
import {
  Layers3,
  Siren,
  Radio,
  TrendingUp,
  Activity,
  BusFront,
  Smartphone,
  Camera,
  Settings,
  X
} from 'lucide-react';

export default function Sidebar({
  page,
  setPage,
  menuOpen,
  setMenuOpen,
  openIncidentsCount = 0,
  systemStatus = {}
}) {
  const handleNav = (targetPage) => {
    setPage(targetPage);
    if (typeof setMenuOpen === 'function') {
      setMenuOpen(false);
    }
  };

  return (
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
      <div className="brand">
        <RaahiLogo size="md" />
        <div className="brand-text">
          <h1>RAAHI</h1>
          <p>Safer Roads. Brighter Journeys.</p>
        </div>
        {/* Mobile close button */}
        <button
          className="sidebar-close-btn icon-btn"
          onClick={() => typeof setMenuOpen === 'function' && setMenuOpen(false)}
          title="Close navigation drawer"
          aria-label="Close navigation drawer"
        >
          <X style={{ width: 18, height: 18 }} />
        </button>
      </div>

      <nav>
        <div className="nav-section-label">CENTRAL COMMAND</div>

        <button
          className={page === 'overview' ? 'active' : ''}
          onClick={() => handleNav('overview')}
          title="Command Center"
        >
          <Layers3 /> <span className="nav-label">Command Center</span>
        </button>

        <button
          className={page === 'incidents' ? 'active' : ''}
          onClick={() => handleNav('incidents')}
          title="Authoritative Incidents"
        >
          <Siren /> <span className="nav-label">Authoritative Incidents</span>
          <em>{openIncidentsCount}</em>
        </button>

        <button
          className={page === 'candidates' ? 'active' : ''}
          onClick={() => handleNav('candidates')}
          title="Candidate Events Ingestion & Promotion Pipeline"
        >
          <Radio style={{ color: page === 'candidates' ? 'var(--purple)' : '#a78bfa' }} />
          <span className="nav-label">Candidate Pipeline</span>
        </button>

        <button
          className={page === 'analytics' ? 'active' : ''}
          onClick={() => handleNav('analytics')}
          title="Analytics & Fusion"
        >
          <TrendingUp /> <span className="nav-label">Analytics &amp; Fusion</span>
        </button>

        <button
          className={page === 'health' ? 'active' : ''}
          onClick={() => handleNav('health')}
          title="System Health"
        >
          <Activity /> <span className="nav-label">System Health</span>
        </button>

        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          EDGE / TESTING
        </div>

        <button
          className={page === 'buses' ? 'active' : ''}
          onClick={() => handleNav('buses')}
          title="Fleet (Demo)"
        >
          <BusFront /> <span className="nav-label">Fleet <span className="demo-tag">DEMO</span></span>
        </button>

        <button
          className={page === 'gps' ? 'active' : ''}
          onClick={() => handleNav('gps')}
          title="Phone GPS Sender"
          style={{ color: page === 'gps' ? 'var(--green)' : 'var(--cyan)' }}
        >
          <Smartphone /> <span className="nav-label">Phone GPS</span>
        </button>

        <button
          className={page === 'camera' ? 'active' : ''}
          onClick={() => handleNav('camera')}
          title="Phone Camera Streamer"
          style={{ color: page === 'camera' ? 'var(--red)' : 'var(--cyan)' }}
        >
          <Camera /> <span className="nav-label">Phone Camera</span>
        </button>

        <div className="nav-section-label" style={{ marginTop: '12px' }}>
          CONFIGURATION
        </div>

        <button
          className={page === 'settings' ? 'active' : ''}
          onClick={() => handleNav('settings')}
          title="System Configuration"
        >
          <Settings /> <span className="nav-label">Settings</span>
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="system" title="Central Platform • Active (Spatial Fusion & Ingestion)">
          <span className="online-dot"></span>
          <div className="system-text">
            <b>Central Platform • Active</b>
            <small>Spatial Fusion & Ingestion</small>
          </div>
        </div>
        <small className="version-tag">RAAHI Central Command • v1.0</small>
      </div>
    </aside>
  );
}
