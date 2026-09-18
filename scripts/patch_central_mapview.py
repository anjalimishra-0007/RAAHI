#!/usr/bin/env python3
"""
Patch script for RAAHI22 Central MapView.jsx:
1. Adds trafficMarkerIcon for traffic congestion visualization.
2. Accepts trafficIncidents prop.
3. Renders real connected buses in both Central and Edge modes.
4. Renders traffic congestion incidents on the map.
5. Preserves all authoritative Pothole inspection popups and Google Drive video links.
"""

MAPVIEW_PATH = "/Users/ujjwalraj/Desktop/RAAHI22/raahi-pothole-detection/dashboard/src/components/MapView.jsx"

with open(MAPVIEW_PATH, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Add trafficMarkerIcon if missing
traffic_icon_func = """function trafficMarkerIcon(severity = 'high') {
  const pinColor = severity === 'critical' ? '#ef4444' : (severity === 'high' ? '#f97316' : '#eab308');
  return L.divIcon({
    className: 'raahi-marker traffic-incident-marker',
    html: `<div class="marker-pin" style="--pin:${pinColor}; box-shadow: 0 0 16px ${pinColor}99; border: 2px solid #fff; font-size: 15px;" title="Traffic Incident">🚗</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}
"""

if "trafficMarkerIcon" not in code:
    marker = "function potholeMarkerIcon"
    code = code.replace(marker, traffic_icon_func + "\n" + marker)

# 2. Add trafficIncidents to MapView props
props_target = """export default function MapView({
  mode = 'central', // 'central' | 'edge'
  potholes = [],
  buses = [],
  incidents = [],"""

props_replacement = """export default function MapView({
  mode = 'central', // 'central' | 'edge'
  potholes = [],
  buses = [],
  incidents = [],
  trafficIncidents = [],"""

if "trafficIncidents = []" not in code:
    code = code.replace(props_target, props_replacement)

# 3. Update marker rendering loop to include fleet buses (when showFleet or buses present)
old_fleet_block = """    // 1. Edge/Demo Mode ONLY: Demo Fleet Buses and Phone GPS
    if (!isCentral && showFleet && Array.isArray(buses)) {"""

new_fleet_block = """    // 1. Connected Fleet Buses and Live Phone GPS
    if (showFleet && Array.isArray(buses) && buses.length > 0) {"""

code = code.replace(old_fleet_block, new_fleet_block)

# Also update demo popup label to real active bus
code = code.replace("<b>🚌 ${bus.id} [DEMO FLEET]</b>", "<b>🚌 ${bus.id} • Connected Bus</b>")

# 4. Add Traffic Incidents layer right after Pothole markers
pothole_end_marker = "layersRef.current.push(m);\n    });"
traffic_incident_layer = """layersRef.current.push(m);
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
    });"""

if "3. Authoritative Traffic Incidents Layer" not in code:
    code = code.replace(pothole_end_marker, traffic_incident_layer)

# Update useEffect dependency array
dep_marker = "}, [buses, potholes, incidents, onSelectIncident, gpsLocation, showFleet, isCentral]);"
dep_replacement = "}, [buses, potholes, incidents, trafficIncidents, onSelectIncident, gpsLocation, showFleet, isCentral]);"
code = code.replace(dep_marker, dep_replacement)

with open(MAPVIEW_PATH, "w", encoding="utf-8") as f:
    f.write(code)

print("Patched MapView.jsx successfully")
