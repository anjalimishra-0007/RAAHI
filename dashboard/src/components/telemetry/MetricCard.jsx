import React from 'react';

/**
 * Reusable tactical card wrapper with header, icon, title, badge, and content slot.
 */
export function MetricCard({ icon: Icon, title, iconColor, badge, badgeStyle, children }) {
  return (
    <div className="tactical-card">
      <div className="card-header-bar">
        <div className="card-title-group">
          {Icon && <Icon size={14} color={iconColor} />}
          <span className="card-title">{title}</span>
        </div>
        {badge && (
          <span className="card-badge mono" style={badgeStyle}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: '10px 14px' }}>
        {children}
      </div>
    </div>
  );
}
