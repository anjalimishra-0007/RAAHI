import React from 'react';
import { ChevronRight, CircleHelp, Menu, Search } from 'lucide-react';

/**
 * Page titles mapping for topbar breadcrumbs
 */
const pageTitles = {
  overview: 'Command Center',
  incidents: 'Authoritative Incidents',
  candidates: 'Candidate Pipeline',
  analytics: 'Analytics & Fusion',
  health: 'System Health',
  buses: 'Fleet (Demo)',
  gps: 'Phone GPS Sender',
  camera: 'Phone Camera Streamer',
  settings: 'System Configuration'
};

/**
 * Topbar Component
 *
 * Preserves search input, breadcrumbs, live polling toggle, and help trigger.
 */
export default function Topbar({
  page,
  query,
  setQuery,
  live,
  setLive,
  menuOpen,
  setMenuOpen,
  onHelp
}) {
  const currentTitle = pageTitles[page] || page[0].toUpperCase() + page.slice(1);

  return (
    <header className="topbar">
      <button
        className="menu-btn icon-btn"
        onClick={() => setMenuOpen(!menuOpen)}
        title="Toggle menu"
      >
        <Menu />
      </button>

      <div className="crumb">
        <span>RAAHI</span>
        <ChevronRight />
        <b>{currentTitle}</b>
      </div>

      <div className="top-actions">
        <div className="search">
          <Search />
          <input
            placeholder="Search incidents, potholes, buses..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <button
          className={`live-toggle ${live ? 'on' : ''}`}
          onClick={() => setLive(!live)}
          title={live ? 'Pause auto-refresh' : 'Resume live auto-refresh'}
        >
          <span></span>
          {live ? 'LIVE' : 'PAUSED'}
        </button>

        <button
          className="icon-btn"
          onClick={onHelp}
          title="System Health & API Information"
        >
          <CircleHelp />
        </button>
      </div>
    </header>
  );
}
