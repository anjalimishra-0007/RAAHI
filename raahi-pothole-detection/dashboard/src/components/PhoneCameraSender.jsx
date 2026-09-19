import React, { useState, useEffect, useRef } from 'react';
import { Camera, RefreshCw, ShieldAlert, ArrowLeft, Radio, CheckCircle2, AlertTriangle, Video, Smartphone, Sparkles, Flame, Eye, Navigation } from 'lucide-react';

export default function PhoneCameraSender({ onBack }) {
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState('Standby'); // Standby | Requesting | Streaming | Error
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (rear) | 'user' (front)
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSecure, setIsSecure] = useState(true);
  const [macHost, setMacHost] = useState('192.168.0.209');
  const [includeGps, setIncludeGps] = useState(true);
  const [gpsTelemetry, setGpsTelemetry] = useState(null);
  const [gpsStatusText, setGpsStatusText] = useState('Standby');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const intervalIdRef = useRef(null);
  const isStreamingRef = useRef(false);
  const isUploadingRef = useRef(false);
  const fpsWindowRef = useRef({ count: 0, lastTime: Date.now() });
  const gpsWatchIdRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const secure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      setIsSecure(secure);
      setMacHost(window.location.hostname || '192.168.0.209');
    }
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setErrorMsg('');
    setStatus('Requesting Camera...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg('Camera access API (getUserMedia) is unavailable. Ensure you are visiting via HTTPS (https://) or a secure origin.');
      setStatus('Error');
      return;
    }

    try {
      // Prioritize road-facing rear camera with 640x360 resolution for YOLO11n
      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 25, max: 30 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStreaming(true);
      isStreamingRef.current = true;
      setStatus('Streaming Live');

      // Start transmission loop (~20 FPS target with zero-queue lock)
      fpsWindowRef.current = { count: 0, lastTime: Date.now() };

      intervalIdRef.current = setInterval(() => {
        captureAndTransmitFrame();
      }, 50); // 50ms interval = up to 20 FPS

      // Also start live GPS telemetry if enabled
      if (includeGps) {
        startGpsTracking();
      }

    } catch (err) {
      console.error('Failed to access camera:', err);
      let message = 'Could not start camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = 'Camera permission was denied. Please allow camera access in your mobile browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        message = 'No camera found on this device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        message = 'Camera is already in use by another application.';
      } else {
        message = `Camera error: ${err.message || err.name}`;
      }
      setErrorMsg(message);
      setStatus('Error');
      setStreaming(false);
      isStreamingRef.current = false;
      stopGpsTracking();
    }
  };

  const startGpsTracking = () => {
    if (!navigator.geolocation) {
      setGpsStatusText('Not supported');
      return;
    }
    setGpsStatusText('Acquiring GPS...');
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };
    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGpsTelemetry({
          latitude,
          longitude,
          accuracy: Math.round(accuracy * 10) / 10
        });
        setGpsStatusText(`${latitude.toFixed(4)}, ${longitude.toFixed(4)} (±${Math.round(accuracy)}m)`);
        fetch('/api/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude,
            longitude,
            accuracy: accuracy ? Math.round(accuracy * 10) / 10 : null,
            timestamp: new Date(pos.timestamp).toISOString()
          })
        }).catch(() => {});
      },
      (err) => {
        setGpsStatusText(`GPS: ${err.message || 'Signal lost'}`);
      },
      options
    );
  };

  const stopGpsTracking = () => {
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setGpsStatusText('Standby');
  };

  const captureAndTransmitFrame = () => {
    if (!isStreamingRef.current || isUploadingRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return; // HAVE_CURRENT_DATA

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw video frame to offscreen canvas scaled to 640x360
    ctx.drawImage(video, 0, 0, 640, 360);

    isUploadingRef.current = true;
    const t0 = performance.now();

    canvas.toBlob(async (blob) => {
      if (!blob || !isStreamingRef.current) {
        isUploadingRef.current = false;
        return;
      }

      try {
        const res = await fetch('/api/live/frame', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob
        });

        if (res.ok) {
          const lat = Math.round(performance.now() - t0);
          setLatencyMs(lat);
          setFrameCount(c => c + 1);

          // Update moving FPS calculation
          const now = Date.now();
          fpsWindowRef.current.count++;
          if (now - fpsWindowRef.current.lastTime >= 1000) {
            const calculatedFps = Math.round((fpsWindowRef.current.count * 1000) / (now - fpsWindowRef.current.lastTime) * 10) / 10;
            setFps(calculatedFps);
            fpsWindowRef.current = { count: 0, lastTime: now };
          }
        }
      } catch (uploadErr) {
        // Silent catch for network hiccups
      } finally {
        isUploadingRef.current = false;
      }
    }, 'image/jpeg', 0.68);
  };

  const stopCamera = () => {
    isStreamingRef.current = false;
    isUploadingRef.current = false;
    setStreaming(false);
    setStatus('Standby');
    stopGpsTracking();

    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    if (streaming) {
      stopCamera();
      setTimeout(() => {
        startCamera();
      }, 200);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '50px' }}>
      {/* Hidden offscreen canvas used for frame capture */}
      <canvas ref={canvasRef} width="640" height="360" style={{ display: 'none' }} />

      {/* TOPBAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#0e141d',
            border: '1px solid #1f2a38',
            color: '#8e9ab1',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Dashboard
        </button>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '10px',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: '99px',
            background: streaming ? 'rgba(62, 226, 162, 0.15)' : 'rgba(142, 154, 177, 0.15)',
            color: streaming ? '#3ee2a2' : '#8e9ab1',
            border: streaming ? '1px solid rgba(62, 226, 162, 0.35)' : '1px solid rgba(142, 154, 177, 0.3)'
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: streaming ? '#3ee2a2' : '#8e9ab1',
              boxShadow: streaming ? '0 0 8px #3ee2a2' : 'none'
            }}
          />
          {status}
        </span>
      </div>

      {/* TITLE & HEADER */}
      <div style={{ marginBottom: '20px' }}>
        <p className="eyebrow" style={{ color: '#ff496c' }}>
          <span></span> MOBILE ROAD SCANNER • PHASE 14
        </p>
        <h2 style={{ fontSize: '26px', margin: '0 0 6px', color: '#fff' }}>
          Live Phone Camera Streamer
        </h2>
        <p style={{ color: '#8e9ab1', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
          Turns this mobile phone into a vehicle-mounted road sensor. Captures frames from the road camera
          and streams them over Wi-Fi to your Mac for real-time YOLO11n pothole detection.
        </p>
      </div>

      {/* SECURITY NOTICE IF NOT SECURE */}
      {!isSecure && (
        <div
          style={{
            background: 'rgba(255, 180, 45, 0.08)',
            border: '1px solid rgba(255, 180, 45, 0.3)',
            borderRadius: '10px',
            padding: '14px 16px',
            marginBottom: '16px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start'
          }}
        >
          <ShieldAlert style={{ width: 20, height: 20, color: '#ffb42d', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <b style={{ fontSize: '12px', color: '#ffb42d', display: 'block' }}>Browser Security Requirement</b>
            <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '4px 0 0', lineHeight: 1.4 }}>
              Mobile browsers require a Secure Context (HTTPS) for camera hardware access.
              Please connect via <code>https://{macHost}:5173/camera</code>.
              When prompted, tap <i>Show Details &rarr; Visit this website</i> once to allow local streaming.
            </p>
          </div>
        </div>
      )}

      {/* ERROR NOTICE */}
      {errorMsg && (
        <div
          style={{
            background: 'rgba(255, 77, 109, 0.1)',
            border: '1px solid rgba(255, 77, 109, 0.35)',
            borderRadius: '10px',
            padding: '14px 16px',
            marginBottom: '16px',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            color: '#ff667f'
          }}
        >
          <AlertTriangle style={{ width: 18, height: 18, flexShrink: 0 }} />
          <span style={{ fontSize: '11px', lineHeight: 1.4 }}>{errorMsg}</span>
        </div>
      )}

      {/* TELEMETRY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <div style={{ background: '#0e121a', border: '1px solid #222a38', borderRadius: '10px', padding: '12px 14px' }}>
          <small style={{ fontSize: '9px', color: '#7f8ca3', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
            Capture FPS
          </small>
          <b style={{ fontSize: '18px', color: streaming ? '#3ee2a2' : '#fff', display: 'block', marginTop: '3px' }}>
            {streaming ? `${fps} FPS` : '0 FPS'}
          </b>
        </div>

        <div style={{ background: '#0e121a', border: '1px solid #222a38', borderRadius: '10px', padding: '12px 14px' }}>
          <small style={{ fontSize: '9px', color: '#7f8ca3', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
            Frames Sent
          </small>
          <b style={{ fontSize: '18px', color: '#38bdf8', display: 'block', marginTop: '3px' }}>
            {frameCount}
          </b>
        </div>

        <div style={{ background: '#0e121a', border: '1px solid #222a38', borderRadius: '10px', padding: '12px 14px' }}>
          <small style={{ fontSize: '9px', color: '#7f8ca3', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
            Wi-Fi Latency
          </small>
          <b style={{ fontSize: '18px', color: latencyMs ? (latencyMs < 30 ? '#3ee2a2' : '#ffb42d') : '#fff', display: 'block', marginTop: '3px' }}>
            {latencyMs ? `${latencyMs} ms` : '—'}
          </b>
        </div>

        <div style={{ background: '#0e121a', border: '1px solid #222a38', borderRadius: '10px', padding: '12px 14px' }}>
          <small style={{ fontSize: '9px', color: '#7f8ca3', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
            Resolution
          </small>
          <b style={{ fontSize: '18px', color: '#fff', display: 'block', marginTop: '3px' }}>
            640×360
          </b>
        </div>
      </div>

      {/* GPS SYNC STATUS / TOGGLE BAR */}
      <div style={{
        background: includeGps ? 'rgba(56, 189, 248, 0.08)' : 'rgba(30, 41, 59, 0.5)',
        border: includeGps ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(100, 116, 139, 0.2)',
        borderRadius: '10px',
        padding: '10px 14px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Navigation style={{ width: 16, height: 16, color: includeGps ? '#38bdf8' : '#64748b' }} />
          <div>
            <b style={{ fontSize: '11px', color: '#e2e8f0' }}>Integrated Phone GPS: {gpsStatusText}</b>
            <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0 }}>Transmits live GPS telemetry to Express for real-time pothole association</p>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#cbd5e1', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeGps}
            onChange={(e) => {
              const checked = e.target.checked;
              setIncludeGps(checked);
              if (streaming) {
                if (checked) startGpsTracking();
                else stopGpsTracking();
              }
            }}
          />
          Sync GPS with Camera
        </label>
      </div>

      {/* CAMERA VIEWER PANEL */}
      <div
        style={{
          background: '#070a0f',
          border: '1px solid #1f2a38',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '18px',
          position: 'relative'
        }}
      >
        <div style={{ padding: '12px 16px', background: '#0c1119', borderBottom: '1px solid #1f2a38', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Camera style={{ width: 15, height: 15, color: '#38bdf8' }} />
            <b style={{ fontSize: '12px', color: '#fff' }}>Road Camera Preview</b>
            <span className={streaming ? "real-tag" : "demo-tag"} style={{ fontSize: '8px' }}>
              {facingMode === 'environment' ? 'REAR ROAD CAMERA' : 'FRONT CAMERA'}
            </span>
          </div>

          <button
            onClick={toggleFacingMode}
            title="Toggle Front/Rear Camera"
            style={{
              background: '#131c28',
              border: '1px solid #26354a',
              color: '#8e9ab1',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            Flip Camera
          </button>
        </div>

        {/* PREVIEW CONTAINER */}
        <div style={{ position: 'relative', width: '100%', minHeight: '340px', background: '#05070a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              width: '100%',
              maxHeight: '440px',
              objectFit: 'contain',
              display: streaming ? 'block' : 'none'
            }}
          />

          {!streaming && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 14px',
                  color: '#38bdf8'
                }}
              >
                <Camera style={{ width: 28, height: 28 }} />
              </div>
              <b style={{ fontSize: '14px', color: '#e2e8f0', display: 'block', marginBottom: '6px' }}>
                Camera Ready to Stream
              </b>
              <p style={{ fontSize: '11px', color: '#94a3b8', maxWidth: '380px', margin: '0 auto 16px', lineHeight: 1.4 }}>
                Mount phone horizontally facing the road. Tap <b>Start Camera</b> to stream live video frames to your Mac.
              </p>
            </div>
          )}

          {/* STREAMING HUD OVERLAY */}
          {streaming && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                right: 12,
                display: 'flex',
                justifyContent: 'space-between',
                pointerEvents: 'none'
              }}
            >
              <div
                style={{
                  background: 'rgba(7, 10, 15, 0.75)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 77, 109, 0.4)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 800
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d6d', boxShadow: '0 0 8px #ff4d6d' }} />
                REC • STREAMING LIVE
              </div>

              <div
                style={{
                  background: 'rgba(7, 10, 15, 0.75)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  color: '#38bdf8',
                  fontSize: '9px',
                  fontWeight: 700
                }}
              >
                MAC TARGET: {macHost}:5001
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{ display: 'grid', gridTemplateColumns: streaming ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '22px' }}>
        {!streaming ? (
          <button
            onClick={startCamera}
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 15px rgba(37, 99, 235, 0.35)'
            }}
          >
            <Camera style={{ width: 17, height: 17 }} /> Start Road Camera
          </button>
        ) : (
          <>
            <button
              onClick={stopCamera}
              style={{
                background: '#251319',
                color: '#ff8498',
                border: '1px solid #61303b',
                borderRadius: '10px',
                padding: '14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              Stop Camera
            </button>

            <button
              onClick={toggleFacingMode}
              style={{
                background: '#0e141d',
                color: '#dce5f5',
                border: '1px solid #1f2a38',
                borderRadius: '10px',
                padding: '14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              Flip to {facingMode === 'environment' ? 'Front' : 'Rear'}
            </button>
          </>
        )}
      </div>

      {/* MAC TERMINAL INSTRUCTION CARD */}
      <div
        style={{
          background: '#0c1017',
          border: '1px solid #1c2533',
          borderRadius: '12px',
          padding: '16px 18px'
        }}
      >
        <b style={{ fontSize: '12px', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <Sparkles style={{ width: 14, height: 14, color: '#3ee2a2' }} />
          Run Live YOLO11n Inference on Mac
        </b>
        <p style={{ fontSize: '11px', color: '#94a3b8', margin: '6px 0 10px', lineHeight: 1.4 }}>
          Once the camera is streaming above, open a terminal on your Mac and run the dedicated live inference module:
        </p>

        <div className="developer-curl-box" style={{ padding: '10px 12px', fontSize: '11px' }}>
          python src/live_camera.py --model runs/detect/runs/pothole_yolo11n/weights/best.pt --conf 0.35
        </div>

        <p style={{ fontSize: '10px', color: '#64748b', margin: '8px 0 0' }}>
          • Ingests stream: <code>http://localhost:5001/api/live/stream</code> • Hardware: <b>Apple Silicon MPS</b> • Exit key: <code>q</code>
        </p>
      </div>
    </div>
  );
}
