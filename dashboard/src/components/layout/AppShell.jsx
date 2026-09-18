import React from 'react';

/**
 * AppShell provides the top-level operational page container and toast notifications.
 */
export function AppShell({ children, toastMessage }) {
  return (
    <div className="ops-container">
      {toastMessage && (
        <div className="tactical-toast">
          ✓ {toastMessage}
        </div>
      )}
      {children}
    </div>
  );
}
