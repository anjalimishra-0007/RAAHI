import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { getSettings, updateSettings } from '../../services/api';

/**
 * SettingsModal: Configure bus ID, RTSP URL, central URL, YOLO confidence, and evidence buffers.
 */
export function SettingsModal({ isOpen, onClose, onSaved }) {
  const [settingsForm, setSettingsForm] = useState({
    busId: 'RAAHI-001',
    rtspUrl: 'rtsp://127.0.0.1:8555/live',
    centralUrl: 'http://localhost:5001',
    confThreshold: 0.35,
    preBufferSec: 2.0,
    postBufferSec: 3.0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      getSettings()
        .then((data) => {
          if (data) setSettingsForm(data);
        })
        .catch((err) => console.warn('[SettingsModal] Load error:', err));
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSettings(settingsForm);
      if (onSaved) onSaved('Edge settings updated successfully');
      onClose();
    } catch {
      if (onSaved) onSaved('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="tactical-modal-backdrop" onClick={onClose}>
      <div className="tactical-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="tactical-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} color="var(--standby-blue)" />
            <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
              RAAHI EDGE CONTROL SETTINGS
            </h3>
          </div>
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 16,
            }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="tactical-modal-body">
          <div className="tactical-form-group">
            <label className="tactical-form-label">Bus Identifier</label>
            <input
              type="text"
              className="tactical-input"
              value={settingsForm.busId || ''}
              onChange={(e) => setSettingsForm({ ...settingsForm, busId: e.target.value })}
            />
          </div>

          <div className="tactical-form-group">
            <label className="tactical-form-label">MediaMTX RTSP URL</label>
            <input
              type="text"
              className="tactical-input"
              value={settingsForm.rtspUrl || ''}
              onChange={(e) => setSettingsForm({ ...settingsForm, rtspUrl: e.target.value })}
            />
          </div>

          <div className="tactical-form-group">
            <label className="tactical-form-label">Central Ingestion Service URL</label>
            <input
              type="text"
              className="tactical-input"
              value={settingsForm.centralUrl || ''}
              onChange={(e) => setSettingsForm({ ...settingsForm, centralUrl: e.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="tactical-form-group">
              <label className="tactical-form-label">YOLO Confidence Threshold (0.0 - 1.0)</label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="1.0"
                className="tactical-input"
                value={settingsForm.confThreshold ?? 0.35}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, confThreshold: parseFloat(e.target.value) })
                }
              />
            </div>
            <div className="tactical-form-group">
              <label className="tactical-form-label">Evidence Pre-Buffer (seconds)</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10.0"
                className="tactical-input"
                value={settingsForm.preBufferSec ?? 2.0}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, preBufferSec: parseFloat(e.target.value) })
                }
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" className="btn-tactical" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-tactical btn-primary-start" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
