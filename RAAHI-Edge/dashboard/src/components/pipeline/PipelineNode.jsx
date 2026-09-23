import React from 'react';
import { getNodeStatusClass } from '../../utils/telemetry';

/**
 * Individual hardware/software node in the pipeline ribbon.
 */
export function PipelineNode({ label, val, status }) {
  const statusClass = getNodeStatusClass(status);

  return (
    <div className={`pipe-node ${statusClass}`}>
      <div className="pipe-indicator-dot" />
      <div className="pipe-text-group">
        <span className="pipe-label">{label}</span>
        <span className="pipe-val mono">{val}</span>
      </div>
    </div>
  );
}
