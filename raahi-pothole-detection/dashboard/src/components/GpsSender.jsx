import React, { useState, useEffect, useRef } from 'react';
import { Navigation, Radio, AlertTriangle, CheckCircle2, XCircle, ArrowLeft, ShieldAlert, RefreshCw, Smartphone } from 'lucide-react';

export default function GpsSender({ onBack }) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Standby'); // Standby | Acquiring | Connected | Error
  const [telemetry, setTelemetry] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [packetCount, setPacketCount] = useState(0);
  const [lastSentTime, setLastSentTime] = useState('');
  const [apiStatus, setApiStatus] = useState('');
  const [isSecure, setIsSecure] = useState(true);

  const watchIdRef = useRef(null);

  useEffect(() => {
    // Check if running in a secure context (HTTPS or localhost)
    if (typeof window !== 'undefined') {
      const secure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      setIsSecure(secure);
    }
    return () => {
      stopGps();
    };
  }, []);

  const sendGpsTelemetry = async (coords, timestamp) => {
    const payload = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ? Math.round(coords.accuracy * 10) / 10 : null,
      timestamp: new Date(timestamp).toISOString()
    };

    try {
      const res = await fetch('/api/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setPacketCount(prev => prev + 1);
        setLastSentTime(new Date().toLocaleTimeString());
        setApiStatus('200 OK • Updated');
        setStatus('Connected');
      } else {
        setApiStatus(`HTTP ${res.status} Error`);
      }
    } catch (err) {
      setApiStatus(`Network Error: ${err.message}`);
    }
  };

  const startGps = () => {
    setErrorMsg('');
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      setStatus('Error');
      return;
    }

    setStatus('Acquiring...');
    setActive(true);

    const options = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setTelemetry({
          latitude,
          longitude,
          accuracy: Math.round(accuracy * 10) / 10,
          timestamp: pos.timestamp
        });
        sendGpsTelemetry(pos.coords, pos.timestamp);
      },
      (err) => {
        let message = 'Failed to acquire GPS signal.';
        if (err.code === err.PERMISSION_DENIED) {
          message = 'Location permission denied. Please allow location access in your mobile browser settings.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = 'Position unavailable. Check that phone Location / GPS is toggled ON.';
        } else if (err.code === err.TIMEOUT) {
          message = 'GPS request timed out. Searching for satellites...';
        }
        setErrorMsg(message);
        setStatus('Error');
      },
      options
    );
  };

  const stopGps = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setActive(false);
    setStatus('Standby');
  };

  return (
    <div style={{
      maxWidth: '560px',
      margin: '0 auto',
      padding: '20px 16px',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: 'var(--text)'
    }}>
      {/* Top Bar with Back Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--muted)',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
        )}
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--muted)',
          textTransform: 'uppercase'
        }}>
          RAAHI Telemetry v1.0
        </div>
      </div>

      {/* Title Card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(31, 143, 255, 0.12), rgba(0, 255, 196, 0.08))',
        border: '1px solid rgba(0, 255, 196, 0.25)',
        borderRadius: '16px',
        padding: '20px',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: 'rgba(0, 255, 196, 0.12)',
          color: '#00ffc4',
          marginBottom: '12px'
        }}>
          <Navigation size={28} />
        </div>
        <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: 800, color: 'var(--text)' }}>
          RAAHI GPS Sender
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          Continuous mobile GPS transmitter over local Wi-Fi
        </p>

        {/* Live Status Badge */}
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '999px',
            fontSize: '13px',
            fontWeight: 700,
            background: status === 'Connected'
              ? 'rgba(0, 255, 196, 0.15)'
              : status === 'Acquiring...'
              ? 'rgba(255, 176, 32, 0.15)'
              : status === 'Error'
              ? 'rgba(255, 73, 108, 0.15)'
              : 'rgba(100, 116, 139, 0.2)',
            color: status === 'Connected'
              ? '#00ffc4'
              : status === 'Acquiring...'
              ? '#ffb020'
              : status === 'Error'
              ? '#ff496c'
              : '#94a3b8',
            border: `1px solid ${
              status === 'Connected'
                ? '#00ffc4'
                : status === 'Acquiring...'
                ? '#ffb020'
                : status === 'Error'
                ? '#ff496c'
                : '#475569'
            }`
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: status === 'Connected' ? '#00ffc4' : status === 'Acquiring...' ? '#ffb020' : status === 'Error' ? '#ff496c' : '#94a3b8',
              boxShadow: status === 'Connected' ? '0 0 10px #00ffc4' : 'none'
            }} />
            GPS Status: {status}
          </div>
        </div>
      </div>

      {/* Insecure Context Notice (Task 6) */}
      {!isSecure && (
        <div style={{
          background: 'rgba(255, 176, 32, 0.1)',
          border: '1px solid rgba(255, 176, 32, 0.35)',
          borderRadius: '12px',
          padding: '14px 16px',
          fontSize: '12px',
          color: '#cbd5e1',
          lineHeight: '1.5'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffb020', fontWeight: 700, marginBottom: '6px' }}>
            <ShieldAlert size={16} /> Browser Security Notice (HTTP LAN)
          </div>
          <p style={{ margin: '0 0 6px 0' }}>
            Modern mobile browsers (iOS Safari, Android Chrome) require a <b>Secure Context</b> (HTTPS or localhost) for <code style={{ color: '#ffb020' }}>navigator.geolocation</code>.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            • <b>Android Chrome</b>: Open <code style={{ color: '#00ffc4' }}>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> and add your Mac IP (e.g. <code style={{ color: '#00ffc4' }}>http://10.134.43.134:5173</code>), then relaunch.<br />
            • <b>Local HTTPS</b>: Run Vite with HTTPS enabled (<code style={{ color: '#00ffc4' }}>npm run dev -- --https</code>) and access via <code style={{ color: '#00ffc4' }}>https://...</code>.
          </p>
        </div>
      )}

      {/* Error Message */}
      {errorMsg && (
        <div style={{
          background: 'rgba(255, 73, 108, 0.12)',
          border: '1px solid rgba(255, 73, 108, 0.4)',
          borderRadius: '12px',
          padding: '12px 16px',
          fontSize: '13px',
          color: '#ff859c',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px'
        }}>
          <XCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>{errorMsg}</div>
        </div>
      )}

      {/* Control Button */}
      <div>
        {!active ? (
          <button
            onClick={startGps}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '14px',
              fontSize: '17px',
              fontWeight: 800,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #00ffc4, #00b4d8)',
              color: '#04101d',
              border: 'none',
              boxShadow: '0 8px 24px rgba(0, 255, 196, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s ease'
            }}
          >
            <Radio size={22} /> Start GPS
          </button>
        ) : (
          <button
            onClick={stopGps}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '14px',
              fontSize: '17px',
              fontWeight: 800,
              cursor: 'pointer',
              background: 'rgba(255, 73, 108, 0.15)',
              color: '#ff496c',
              border: '2px solid #ff496c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            Stop GPS
          </button>
        )}
      </div>

      {/* Telemetry Displays */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px'
      }}>
        {/* Latitude Card */}
        <div style={{
          background: 'var(--panel2)', border: '1px solid var(--line)',
                    borderRadius: '12px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Latitude</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: telemetry ? 'var(--blue)' : 'var(--muted)', marginTop: '4px' }}>
            {telemetry ? telemetry.latitude.toFixed(6) : '— — —'}
          </div>
        </div>

        {/* Longitude Card */}
        <div style={{
          background: 'var(--panel2)', border: '1px solid var(--line)',
                    borderRadius: '12px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Longitude</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: telemetry ? 'var(--blue)' : 'var(--muted)', marginTop: '4px' }}>
            {telemetry ? telemetry.longitude.toFixed(6) : '— — —'}
          </div>
        </div>

        {/* Accuracy Card */}
        <div style={{
          background: 'var(--panel2)', border: '1px solid var(--line)',
                    borderRadius: '12px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Accuracy</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: telemetry ? 'var(--green)' : 'var(--muted)', marginTop: '4px' }}>
            {telemetry ? `±${telemetry.accuracy} m` : '— — —'}
          </div>
        </div>

        {/* Last Sent Card */}
        <div style={{
          background: 'var(--panel2)', border: '1px solid var(--line)',
                    borderRadius: '12px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Last Sent</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: lastSentTime ? 'var(--text)' : 'var(--muted)', marginTop: '4px' }}>
            {lastSentTime || '— — —'}
          </div>
        </div>
      </div>

      {/* Network & Transmission Diagnostics */}
      <div style={{
        background: 'var(--panel2)', border: '1px solid var(--line)',
                borderRadius: '14px',
        padding: '16px'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', marginBottom: '10px' }}>
          TRANSMISSION DIAGNOSTICS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Target API Endpoint:</span>
            <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>POST /api/gps</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Packets Transmitted:</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{packetCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Backend Response:</span>
            <span style={{ color: apiStatus.includes('200') ? '#00ffc4' : apiStatus ? '#ff496c' : '#64748b', fontWeight: 600 }}>
              {apiStatus || 'Awaiting transmission'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Associated Vehicle:</span>
            <span style={{ color: 'var(--text)' }}>RAAHI-01 (Primary Bus)</span>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div style={{ textAlign: 'center', fontSize: '11px', color: '#475569', marginTop: 'auto' }}>
        RAAHI Road Sensing System • Local Wi-Fi Telemetry Stream
      </div>
    </div>
  );
}
