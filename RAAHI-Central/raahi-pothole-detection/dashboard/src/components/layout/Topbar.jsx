import React from 'react';
import { ChevronRight, CircleHelp, Menu, Moon, Search, Sun, Zap } from 'lucide-react';

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

export default function Topbar({
  page,
  query,
  setQuery,
  live,
  setLive,
  menuOpen,
  setMenuOpen,
  onHelp,
  theme = 'dark',
  setTheme
}) {
  const currentTitle = pageTitles[page] || page[0].toUpperCase() + page.slice(1);

  const cycleTheme = () => {
    if (typeof setTheme !== 'function') return;
    if (theme === 'dark') setTheme('oled');
    else if (theme === 'oled') setTheme('light');
    else setTheme('dark');
  };

  const themeIcon = theme === 'oled'
    ? <Zap style={{ width: 14, height: 14, color: 'var(--amber)' }} />
    : theme === 'light'
    ? <Sun style={{ width: 14, height: 14, color: 'var(--amber)' }} />
    : <Moon style={{ width: 14, height: 14, color: 'var(--cyan)' }} />;

  const themeLabel = theme === 'oled' ? 'OLED Dark' : theme === 'light' ? 'Light' : 'Tactical Dark';

  return (
    <header className="topbar">
      <button
        className="menu-btn icon-btn"
        onClick={() => typeof setMenuOpen === 'function' && setMenuOpen(!menuOpen)}
        title="Toggle navigation drawer"
        aria-label="Toggle navigation menu"
        aria-expanded={menuOpen}
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
            placeholder="Search incidents..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search incidents and buses"
          />
        </div>

        {/* Multi-Theme Switcher Button */}
        <button
          className="theme-switch-btn"
          onClick={cycleTheme}
          title={`Active Theme: ${themeLabel}. Click to switch theme (Tactical Dark / OLED / Light)`}
          aria-label={`Current theme is ${themeLabel}. Click to cycle theme`}
        >
          {themeIcon}
          <span className="theme-name">{themeLabel}</span>
        </button>

        <button
          className={`live-toggle ${live ? 'on' : ''}`}
          onClick={() => setLive(!live)}
          title={live ? 'Pause live auto-refresh' : 'Resume live auto-refresh'}
        >
          <span></span>
          {live ? 'LIVE' : 'PAUSED'}
        </button>

        <button
          className="icon-btn help-btn"
          onClick={onHelp}
          title="System Health & API Information"
          aria-label="System Health Information"
        >
          <CircleHelp />
        </button>
      </div>
    </header>
  );
}
