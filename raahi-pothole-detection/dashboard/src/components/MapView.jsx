import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Loader2, AlertCircle, AlertTriangle } from 'lucide-react';

const statusPinColors = {
  open: '#ff496c',
  investigating: '#ffb020',
  repaired: '#3ee2a2',
  ignored: '#8e9ab1'
};

const statusLabels = {
  open: 'Open',
  investigating: 'Investigating',
  repaired: 'Repaired',
  ignored: 'Ignored'
};

function busMarkerIcon() {
  return L.divIcon({
    className: 'raahi-marker bus-demo-marker',
    html: `<div class="marker-pin" style="--pin:#1f8fff;" title="Demo Fleet Bus">🚌</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function phoneGpsMarkerIcon() {
  return L.divIcon({
    className: 'raahi-marker phone-live-marker',
    html: `<div class="marker-pin live-phone-pin" style="--pin:#00ffc4">📱</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

function trafficMarkerIcon(severity = 'high') {
  const pinColor = severity === 'critical' ? '#ef4444' : (severity === 'high' ? '#f97316' : '#eab308');
  return L.divIcon({
    className: 'raahi-marker traffic-incident-marker',
    html: `<div class="marker-pin" style="--pin:${pinColor}; box-shadow: 0 0 16px ${pinColor}99; border: 2px solid #fff; font-size: 15px;" title="Traffic Incident">🚗</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function potholeMarkerIcon(status = 'open') {
  const pinColor = statusPinColors[status?.toLowerCase()] || '#ff496c';
  return L.divIcon({
    className: 'raahi-marker pothole-incident-marker',
    html: `<div class="marker-pin" style="--pin:${pinColor}; box-shadow: 0 0 16px ${pinColor}99; border: 2px solid #fff; font-size: 15px;" title="Authoritative Road Hazard">🕳️</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

export default function MapView({
  mode = 'central', // 'central' | 'edge'
  potholes = [],
  buses = [],
  incidents = [],
  trafficIncidents = [],
  onSelectIncident,
  gpsLocation,
  showFleet = false,
  loading = false,
  error = null
}) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const layersRef = useRef([]);

  const isCentral = mode === 'central' && !showFleet;

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;
    
    // Municipal Delhi NCR initial default center
    const initialCoords = [28.6139, 77.2090];

    const map = L.map(mapRef.current, { zoomControl: false }).setView(initialCoords, 11);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    instanceRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      instanceRef.current = null;
    };
  }, []);

  // Expose global callback for Leaflet popup interaction
  useEffect(() => {
    window.__raahiSelectIncident = (id) => {
      const targetPool = isCentral ? (potholes || []) : [...(potholes || []), ...(incidents || [])];
      const match = targetPool.find(p => (p.potholeId === id || p.id === id || p._id === id));
      if (match && onSelectIncident) {
        onSelectIncident(match);
      }
    };
    return () => {
      delete window.__raahiSelectIncident;
    };
  }, [potholes, incidents, onSelectIncident, isCentral]);

  // Update Markers
  useEffect(() => {
    const map = instanceRef.current;
    if (!map) return;
    layersRef.current.forEach(l => l.remove());
    layersRef.current = [];

    // 1. Connected Fleet Buses and Live Phone GPS
    if (showFleet && Array.isArray(buses) && buses.length > 0) {
      buses.forEach(bus => {
        const isConnectedGps = (bus.id === 'RAAHI-01' && gpsLocation && gpsLocation.connected && typeof gpsLocation.latitude === 'number' && typeof gpsLocation.longitude === 'number');
        const lat = isConnectedGps ? gpsLocation.latitude : bus.lat;
        const lng = isConnectedGps ? gpsLocation.longitude : bus.lng;
        const icon = isConnectedGps ? phoneGpsMarkerIcon() : busMarkerIcon();

        const m = L.marker([lat, lng], {
          icon,
          zIndexOffset: isConnectedGps ? 1200 : 100
        }).addTo(map);

        if (isConnectedGps) {
          const accInfo = gpsLocation.accuracy ? `<br>Accuracy: ±${gpsLocation.accuracy}m` : '';
          const timeInfo = gpsLocation.timestamp ? `<br><small>Time: ${gpsLocation.timestamp}</small>` : '';
          m.bindPopup(`<b>📱 RAAHI-01 • Phone GPS (Connected)</b><br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}${accInfo}${timeInfo}`);
          m.bindTooltip(`GPS: Connected (${lat.toFixed(4)}, ${lng.toFixed(4)})`, {
            permanent: true,
            direction: 'top',
            offset: [0, -20]
          });

          const radius = (gpsLocation.accuracy && gpsLocation.accuracy > 0) ? gpsLocation.accuracy : 15;
          const circle = L.circle([lat, lng], {
            radius,
            color: '#00ffc4',
            fillColor: '#00ffc4',
            fillOpacity: 0.12,
            weight: 1.5,
            dashArray: '4, 4'
          }).addTo(map);
          layersRef.current.push(circle);
        } else {
          m.bindPopup(`<b>🚌 ${bus.id} • Connected Bus</b><br>${bus.route}<br>${bus.status === 'online' ? 'Online' : 'Offline'} • ${bus.speed} km/h`);
        }
        layersRef.current.push(m);
      });

      // Auto-pan to GPS position if phone connected in Edge mode
      if (
        gpsLocation &&
        gpsLocation.connected &&
        typeof gpsLocation.latitude === 'number' &&
        typeof gpsLocation.longitude === 'number'
      ) {
        map.panTo([gpsLocation.latitude, gpsLocation.longitude]);
      }
    }

    // 2. Authoritative MongoDB Pothole Markers
    // IN CENTRAL MODE: ONLY potholes array is permitted. NEVER fall back to incidents or mockData.
    const itemsToDisplay = isCentral
      ? (Array.isArray(potholes) ? potholes : [])
      : ((Array.isArray(potholes) && potholes.length > 0) ? potholes : (Array.isArray(incidents) ? incidents : []));

    itemsToDisplay.forEach(p => {
      const lat = p.location?.latitude ?? p.lat;
      const lng = p.location?.longitude ?? p.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const pId = p.potholeId || p.id || 'POTHOLE';
      const status = (p.status || 'open').toLowerCase();
      const hazardClass = p.verifiedClass || p.class || p.eventType || 'pothole';
      const confPercent = p.confidence != null ? `${Math.round(p.confidence > 1 ? p.confidence : p.confidence * 100)}%` : 'N/A';
      const detCount = p.detectionCount || 1;
      const busesList = (p.busesDetectedBy && p.busesDetectedBy.length > 0)
        ? p.busesDetectedBy.join(', ')
        : (p.bus || 'RAAHI-01');
      const address = p.address && p.address.trim() !== ''
        ? p.address
        : `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      const accuracyInfo = p.location?.accuracy ? `±${p.location.accuracy}m` : null;
      const lastDetectedText = p.lastDetectedAt
        ? new Date(p.lastDetectedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : (p.createdAt ? new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Recorded');

      const hasDriveVideo = !!(p.videoUrl && p.videoUrl.trim() !== '');

      const m = L.marker([lat, lng], {
        icon: potholeMarkerIcon(status),
        zIndexOffset: 800
      }).addTo(map);

      // Popup Content (Rich authoritative municipal inspection card)
      const popupHtml = `
        <div style="font-family: Inter, system-ui, -apple-system, sans-serif; min-width: 230px; max-width: 275px; color: #0f172a; line-height: 1.4; padding: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 6px;">
            <div>
              <b style="font-size: 13px; color: #0f172a; letter-spacing: 0.02em;">${pId}</b>
              <span style="display: block; font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase;">${hazardClass}</span>
            </div>
            <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; background: ${status === 'open' ? '#fee2e2' : (status === 'investigating' ? '#fef3c7' : (status === 'repaired' ? '#dcfce7' : '#f1f5f9'))}; color: ${status === 'open' ? '#dc2626' : (status === 'investigating' ? '#d97706' : (status === 'repaired' ? '#15803d' : '#475569'))};">
              ${statusLabels[status] || status}
            </span>
          </div>
          <div style="font-size: 11px; color: #334155; margin-bottom: 6px; line-height: 1.35;">
            ${address}
            ${accuracyInfo ? `<span style="font-size: 9px; color: #64748b; margin-left: 4px;">(${accuracyInfo})</span>` : ''}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px; color: #475569; background: #f8fafc; padding: 6px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid #e2e8f0;">
            <div>Edge Conf: <b style="color: #0f172a;">${confPercent}</b></div>
            <div>Fused Obs: <b style="color: #0f172a;">${detCount}</b></div>
            <div style="grid-column: span 2;">Reporting buses: <b style="color: #0f172a;">${busesList}</b></div>
            <div style="grid-column: span 2; font-size: 9px; color: #64748b;">Last observed: <b style="color: #334155;">${lastDetectedText}</b></div>
          </div>
          ${hasDriveVideo ? `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 10px; color: #0284c7; font-weight: 700; margin-bottom: 6px; background: #f0f9ff; padding: 4px 6px; border-radius: 4px; border: 1px solid #bae6fd;">
              <span>📁 Evidence Linked</span>
              <a href="${p.videoUrl}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; text-decoration: none; font-size: 9px;">Open ↗</a>
            </div>
          ` : `
            <div style="font-size: 9px; color: #94a3b8; margin-bottom: 6px; font-style: italic;">
              No evidence media linked
            </div>
          `}
          <button
            onclick="window.__raahiSelectIncident && window.__raahiSelectIncident('${pId}')"
            style="width: 100%; border: none; background: #0f172a; color: #fff; font-size: 10px; font-weight: 700; padding: 7px 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: background 0.15s ease;"
            onmouseover="this.style.background='#1e293b'"
            onmouseout="this.style.background='#0f172a'"
          >
            Open Incident Details Drawer →
          </button>
        </div>
      `;

      m.bindPopup(popupHtml, { maxWidth: 290 });
      m.bindTooltip(`${pId} • ${confPercent} Edge Conf • ${detCount} obs`, {
        direction: 'top',
        offset: [0, -18]
      });

      m.on('click', () => {
        if (onSelectIncident) {
          onSelectIncident(p);
        }
      });

      layersRef.current.push(m);
    });

    // 3. Authoritative Traffic Incidents Layer
    const activeTraffic = Array.isArray(trafficIncidents) ? trafficIncidents : [];
    activeTraffic.forEach(trf => {
      const lat = trf.location?.latitude;
      const lng = trf.location?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const tId = trf.incidentId || 'TRF-INC';
      const sev = (trf.severity || 'high').toLowerCase();
      const state = trf.trafficState || 'CONGESTED';
      const detCount = trf.detectionCount || 1;
      const busesList = (trf.busesReportedBy && trf.busesReportedBy.length > 0)
        ? trf.busesReportedBy.join(', ')
        : 'RAAHI-01';
      const metrics = trf.metrics || {};
      const occ = metrics.occupancyRatio != null ? `${Math.round(metrics.occupancyRatio * 100)}%` : 'N/A';
      const flow = metrics.flowVpm != null ? `${metrics.flowVpm} VPM` : 'N/A';
      const veh = metrics.activeVehicles != null ? metrics.activeVehicles : 0;

      const m = L.marker([lat, lng], {
        icon: trafficMarkerIcon(sev),
        zIndexOffset: 700
      }).addTo(map);

      const popupHtml = `
        <div style="font-family: Inter, system-ui, -apple-system, sans-serif; min-width: 220px; max-width: 260px; color: #0f172a; padding: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 5px;">
            <div>
              <b style="font-size: 12px; color: #0f172a;">${tId}</b>
              <span style="display: block; font-size: 9px; font-weight: 700; color: #f97316; text-transform: uppercase;">${state}</span>
            </div>
            <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: ${sev === 'critical' ? '#fee2e2' : '#ffedd5'}; color: ${sev === 'critical' ? '#dc2626' : '#c2410c'};">
              ${sev}
            </span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px; color: #475569; background: #fff7ed; padding: 5px 7px; border-radius: 6px; margin-bottom: 5px; border: 1px solid #fed7aa;">
            <div>Vehicles: <b style="color: #0f172a;">${veh}</b></div>
            <div>Occupancy: <b style="color: #0f172a;">${occ}</b></div>
            <div>Flow: <b style="color: #0f172a;">${flow}</b></div>
            <div>Fused Obs: <b style="color: #0f172a;">${detCount}</b></div>
            <div style="grid-column: span 2;">Buses: <b style="color: #0f172a;">${busesList}</b></div>
          </div>
        </div>
      `;

      m.bindPopup(popupHtml, { maxWidth: 280 });
      m.bindTooltip(`${tId} • ${state} (${occ})`, { direction: 'top', offset: [0, -18] });
      layersRef.current.push(m);
    });

  }, [buses, potholes, incidents, trafficIncidents, onSelectIncident, gpsLocation, showFleet, isCentral]);

  return (
    <div className="map-shell">
      <div ref={mapRef} className="map" />

      {/* Map Status Overlays (Loading, Error, Empty) */}
      {loading && (
        <div className="map-status-overlay loading">
          <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
          <span>Loading authoritative incidents...</span>
        </div>
      )}

      {error && !loading && (
        <div className="map-status-overlay error">
          <AlertTriangle style={{ width: 14, height: 14 }} />
          <span>Authoritative incident data unavailable: {error}</span>
        </div>
      )}

      {!loading && !error && isCentral && Array.isArray(potholes) && potholes.length === 0 && (
        <div className="map-status-overlay empty">
          <AlertCircle style={{ width: 14, height: 14 }} />
          <span>No authoritative incidents recorded.</span>
        </div>
      )}

      {/* Map Legend: Central vs Edge */}
      <div className="map-legend">
        {isCentral ? (
          // CENTRAL AUTHORITATIVE LEGEND
          <div className="map-legend-pills">
            <span style={{ fontWeight: 800, color: '#e2e8f0', marginRight: '4px', letterSpacing: '0.04em' }}>
              AUTHORITATIVE HAZARDS:
            </span>
            <span className="map-legend-pill">
              <i className="map-legend-dot" style={{ background: statusPinColors.open, boxShadow: `0 0 6px ${statusPinColors.open}` }} /> Open
            </span>
            <span className="map-legend-pill">
              <i className="map-legend-dot" style={{ background: statusPinColors.investigating }} /> Investigating
            </span>
            <span className="map-legend-pill">
              <i className="map-legend-dot" style={{ background: statusPinColors.repaired }} /> Repaired
            </span>
            <span className="map-legend-pill">
              <i className="map-legend-dot" style={{ background: statusPinColors.ignored }} /> Ignored
            </span>
          </div>
        ) : (
          // EDGE / TESTING LEGEND
          <>
            {showFleet && <span><i className="dot bus" /> Bus (Demo Fleet)</span>}
            <span><i className="dot hazard" style={{ background: '#ff496c' }} /> Authoritative Hazard (MongoDB)</span>
            {gpsLocation && gpsLocation.connected ? (
              <span style={{ color: '#00ffc4', fontWeight: 700 }}>
                <i className="dot" style={{ background: '#00ffc4', boxShadow: '0 0 8px #00ffc4' }} /> GPS: Connected ({gpsLocation.latitude?.toFixed(4)}, {gpsLocation.longitude?.toFixed(4)})
              </span>
            ) : (
              showFleet && (
                <span style={{ color: '#8e9ab1' }}>
                  <i className="dot" style={{ background: '#62718a' }} /> GPS: Not connected
                </span>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
