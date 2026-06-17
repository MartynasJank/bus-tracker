import { $, escapeHtml, haversine, parseGpsText, makeBusIcon, makeSecondaryBusIcon } from './utils.js';
import { state } from './state.js';
import { startUserTracking, stopUserTracking, setLeafletMap, createUserPositionMarker } from './tracking.js';

export let leafletMap      = null;
let busMarker              = null;
let mapPollTimer           = null;
let mapPolylines           = [];
let secondaryBusMarkers    = [];

const WALK_SPEED_MPS = 80;

export function getLeafletMap() { return leafletMap; }

async function osrmWalk(fromLat, fromLon, toLat, toLon) {
  const straightLineMin = Math.max(1, Math.round(haversine(fromLat, fromLon, toLat, toLon) / WALK_SPEED_MPS));
  const fallback        = { coords: [[fromLat, fromLon], [toLat, toLon]], walkMin: straightLineMin };
  try {
    const url  = `https://router.project-osrm.org/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
    const data = await fetch(url).then(response => response.json());
    const route = data.routes?.[0];
    if (!route) return fallback;
    return {
      coords:  route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      walkMin: Math.max(1, Math.round(route.distance / WALK_SPEED_MPS)),
    };
  } catch {
    return fallback;
  }
}

function addPolyline(coords, color, weight, opacity, dashArray) {
  const options = { color, weight, opacity, lineJoin: 'round' };
  if (dashArray) options.dashArray = dashArray;
  const polyline = L.polyline(coords, options);
  polyline.addTo(leafletMap);
  mapPolylines.push(polyline);
  return polyline;
}

function addMapPin(lat, lon, cssClass, popupLabel) {
  const marker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: `<div class="${cssClass}"><div class="ring"></div><div class="core"></div></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9],
    }),
  });
  marker._isMarker = true;
  marker.bindPopup(popupLabel).addTo(leafletMap);
}

function nearestShapeIndex(shapePoints, lat, lon) {
  let bestIndex    = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < shapePoints.length; i++) {
    const distance = haversine(lat, lon, shapePoints[i][0], shapePoints[i][1]);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
  }
  return bestIndex;
}

export function updateMapInfo(speed, stopsLeft, arrivalTime) {
  $('map-speed').querySelector('.map-info-value').textContent  = speed ?? '—';
  $('map-stops').querySelector('.map-info-value').textContent  = stopsLeft ?? '—';
  if (arrivalTime !== undefined) {
    $('map-arrival').querySelector('.map-info-value').textContent = arrivalTime ?? '—';
  }
}

export function calcStopsRemaining(tripStops, busLat, busLon, destStopName) {
  if (!tripStops?.length) return null;
  let nearestIndex    = 0;
  let nearestDistance = Infinity;
  for (let i = 0; i < tripStops.length; i++) {
    const distance = haversine(busLat, busLon, tripStops[i].stop_lat, tripStops[i].stop_lon);
    if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = i; }
  }
  const destIndex = tripStops.findLastIndex(stop => stop.stop_name === destStopName);
  if (destIndex < 0 || destIndex <= nearestIndex) return 0;
  return destIndex - nearestIndex;
}

export function stopMapTracking() {
  clearInterval(mapPollTimer);
  mapPollTimer = null;
  $('map-info').classList.add('hidden');
  stopUserTracking();
  secondaryBusMarkers.forEach(marker => leafletMap?.removeLayer(marker));
  secondaryBusMarkers = [];
}

export async function showBusMap(tracking) {
  state.mapTracking = tracking;

  // showScreen called by caller before this
  await new Promise(resolve => setTimeout(resolve, 30));

  if (!leafletMap) {
    leafletMap = L.map('map-container', { zoomControl: false }).setView([tracking.bus_lat, tracking.bus_lon], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(leafletMap);
    L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);
  } else {
    leafletMap.invalidateSize();
    leafletMap.setView([tracking.bus_lat, tracking.bus_lon], 15);
  }
  setLeafletMap(leafletMap);

  mapPolylines.forEach(polyline => leafletMap.removeLayer(polyline));
  mapPolylines = [];
  leafletMap.eachLayer(layer => { if (layer._isMarker) leafletMap.removeLayer(layer); });

  const boardingStopName = state.selectedStop.stop_name;
  const destStopName     = state.selectedDirection?.headsign;

  if (tracking.trip_id) {
    const [shapeResult, stopsResult] = await Promise.allSettled([
      fetch(`/api/trips/${encodeURIComponent(tracking.trip_id)}/shape`).then(r => r.json()),
      fetch(`/api/trips/${encodeURIComponent(tracking.trip_id)}/stops`).then(r => r.json()),
    ]);

    if (shapeResult.status === 'fulfilled' && shapeResult.value.length) {
      const shapePoints = shapeResult.value.map(point => [point.lat, point.lon]);
      const stops       = stopsResult.status === 'fulfilled' ? stopsResult.value : [];
      const boardingStop = stops.find(stop => stop.stop_name === boardingStopName);
      const destStop     = stops.find(stop => stop.stop_name === destStopName);
      const boardIdx     = boardingStop ? nearestShapeIndex(shapePoints, boardingStop.stop_lat, boardingStop.stop_lon) : null;
      const destIdx      = destStop     ? nearestShapeIndex(shapePoints, destStop.stop_lat,     destStop.stop_lon)     : null;
      const [startIdx, endIdx] = boardIdx !== null && destIdx !== null && boardIdx <= destIdx
        ? [boardIdx, destIdx] : [null, null];

      if (startIdx !== null) {
        if (startIdx > 0) addPolyline(shapePoints.slice(0, startIdx + 1), '#8b7cf8', 3, 0.45);
        addPolyline(shapePoints.slice(startIdx, endIdx + 1), '#34d399', 5, 0.9);
        if (endIdx < shapePoints.length - 1) addPolyline(shapePoints.slice(endIdx), '#8b7cf8', 3, 0.45);
      } else {
        addPolyline(shapePoints, '#8b7cf8', 4, 0.7);
      }
    }

    if (stopsResult.status === 'fulfilled') {
      state.mapTracking.tripStops = stopsResult.value;
      const destStop = stopsResult.value.find(stop => stop.stop_name === destStopName);
      for (const stop of stopsResult.value) {
        if (stop.stop_name === boardingStopName || stop.stop_name === destStopName) continue;
        const marker = L.marker([stop.stop_lat, stop.stop_lon], {
          icon: L.divIcon({ className: '', html: '<div class="map-stop-dot"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }),
        });
        marker._isMarker = true;
        marker.bindPopup(stop.stop_name).addTo(leafletMap);
      }
      if (destStop) addMapPin(destStop.stop_lat, destStop.stop_lon, 'map-pin-dest', destStop.stop_name);
    }
  }

  if (state.userLat) {
    const youMarker = L.marker([state.userLat, state.userLng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="map-pin-you"><div class="ring"></div><div class="core"></div></div>',
        iconSize: [18, 18], iconAnchor: [9, 9],
      }),
    });
    youMarker._isMarker = true;
    youMarker.bindPopup('You').addTo(leafletMap);
  }

  const { stop_lat, stop_lon, stop_name } = state.selectedStop;
  if (stop_lat) addMapPin(stop_lat, stop_lon, 'map-pin-boarding', stop_name);

  busMarker = L.marker([tracking.bus_lat, tracking.bus_lon], {
    icon: makeBusIcon(tracking.bus_azimuth, tracking.route, tracking.bus_speed),
    zIndexOffset: 1000,
  });
  busMarker._isMarker = true;
  busMarker.bindPopup(tracking.route).addTo(leafletMap);

  $('map-info').classList.remove('hidden');
  updateMapInfo(tracking.bus_speed ?? 0, null);

  stopMapTracking();
  mapPollTimer = setInterval(refreshBusPosition, 2000);
}

export async function showJourneyMap(journey, allJourneys = []) {
  state.planMapMode = true;

  // showScreen called by caller before this
  await new Promise(resolve => setTimeout(resolve, 30));

  if (!leafletMap) {
    const midLat = (state.userLat + state.planDest.lat) / 2;
    const midLon = (state.userLng + state.planDest.lon) / 2;
    leafletMap = L.map('map-container', { zoomControl: false }).setView([midLat, midLon], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(leafletMap);
    L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);
  } else {
    leafletMap.invalidateSize();
  }
  setLeafletMap(leafletMap);

  mapPolylines.forEach(polyline => leafletMap.removeLayer(polyline));
  mapPolylines = [];
  leafletMap.eachLayer(layer => { if (layer._isMarker) leafletMap.removeLayer(layer); });

  const [walkToBoard, walkFromAlight] = await Promise.all([
    osrmWalk(state.userLat, state.userLng, journey.board_stop.lat, journey.board_stop.lon),
    osrmWalk(journey.alight_stop.lat, journey.alight_stop.lon, state.planDest.lat, state.planDest.lon),
  ]);
  addPolyline(walkToBoard.coords,    '#a78bfa', 3, 0.75, '6 8');
  addPolyline(walkFromAlight.coords, '#a78bfa', 3, 0.75, '6 8');

  const tripStartTimeStr = journey.trip_start_time || journey.board_time;
  const [boardHour, boardMin]  = tripStartTimeStr.split(':').map(Number);
  const [alightHour, alightMin] = journey.alight_time.split(':').map(Number);
  const tripStartSec  = boardHour  * 3600 + boardMin  * 60;
  const alightTimeSec = alightHour * 3600 + alightMin * 60;

  state.mapTracking = {
    route:        journey.route_short_name,
    bus_trip_start: tripStartSec,
    trip_id:      journey.trip_id,
    destStopName: journey.alight_stop.name,
    alightLat:    journey.alight_stop.lat,
    alightLon:    journey.alight_stop.lon,
    alightTimeSec,
    siblingRoutes: [...new Set(allJourneys.map(j => j.route_short_name))],
  };

  try {
    const [shapeData, stopsData] = await Promise.all([
      fetch(`/api/trips/${encodeURIComponent(journey.trip_id)}/shape`).then(r => r.json()),
      fetch(`/api/trips/${encodeURIComponent(journey.trip_id)}/stops`).then(r => r.json()),
    ]);

    if (shapeData.length) {
      const shapePoints = shapeData.map(point => [point.lat, point.lon]);
      const boardIdx    = nearestShapeIndex(shapePoints, journey.board_stop.lat,  journey.board_stop.lon);
      const alightIdx   = nearestShapeIndex(shapePoints, journey.alight_stop.lat, journey.alight_stop.lon);
      const [startIdx, endIdx] = boardIdx <= alightIdx ? [boardIdx, alightIdx] : [alightIdx, boardIdx];

      if (startIdx > 0) addPolyline(shapePoints.slice(0, startIdx + 1), '#8b7cf8', 3, 0.4);
      addPolyline(shapePoints.slice(startIdx, endIdx + 1), '#34d399', 5, 0.9);
      if (endIdx < shapePoints.length - 1) addPolyline(shapePoints.slice(endIdx), '#8b7cf8', 3, 0.4);
    }

    state.mapTracking.tripStops = stopsData;

    for (const stop of stopsData) {
      if (stop.stop_id === journey.board_stop.id || stop.stop_id === journey.alight_stop.id) continue;
      const marker = L.marker([stop.stop_lat, stop.stop_lon], {
        icon: L.divIcon({ className: '', html: '<div class="map-stop-dot"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }),
      });
      marker._isMarker = true;
      marker.bindPopup(stop.stop_name).addTo(leafletMap);
    }
  } catch { /* shape/stops fetch failed silently */ }

  if (state.userLat) {
    createUserPositionMarker(state.userLat, state.userLng);
  }
  startUserTracking();

  addMapPin(journey.board_stop.lat,  journey.board_stop.lon,  'map-pin-boarding', `Board: ${journey.board_stop.name}`);
  addMapPin(journey.alight_stop.lat, journey.alight_stop.lon, 'map-pin-dest',     `Alight: ${journey.alight_stop.name}`);
  addMapPin(state.planDest.lat,      state.planDest.lon,       'map-pin-dest',    state.planDest.name.split(',')[0]);

  leafletMap.fitBounds(
    L.latLngBounds([
      [state.userLat,                state.userLng],
      [journey.board_stop.lat,       journey.board_stop.lon],
      [journey.alight_stop.lat,      journey.alight_stop.lon],
      [state.planDest.lat,           state.planDest.lon],
    ]),
    { padding: [40, 40] }
  );

  clearInterval(mapPollTimer);
  secondaryBusMarkers.forEach(marker => leafletMap.removeLayer(marker));
  secondaryBusMarkers = [];
  $('map-info').classList.add('hidden');
  busMarker    = null;
  mapPollTimer = setInterval(refreshBusPosition, 2000);
}

async function refreshBusPosition() {
  if (state.screen !== 'map' || !state.mapTracking) return;
  try {
    const text     = await fetch('/api/gps').then(response => response.text());
    const vehicles = parseGpsText(text);
    const { route, bus_trip_start } = state.mapTracking;

    // Pick the closest-matching bus on the tracked route
    const matchedVehicle = vehicles
      .filter(vehicle => vehicle.route === route)
      .reduce((best, vehicle) => {
        if (!best) return vehicle;
        return Math.abs(vehicle.tripStartSec - bus_trip_start) < Math.abs(best.tripStartSec - bus_trip_start)
          ? vehicle : best;
      }, null);

    if (matchedVehicle) {
      if (!busMarker) {
        busMarker = L.marker([matchedVehicle.lat, matchedVehicle.lon], {
          icon: makeBusIcon(matchedVehicle.azimuth, route, matchedVehicle.speed),
          zIndexOffset: 1000,
        });
        busMarker._isMarker = true;
        busMarker.bindPopup(route).addTo(leafletMap);
        $('map-info').classList.remove('hidden');
      } else {
        busMarker.setLatLng([matchedVehicle.lat, matchedVehicle.lon]);
        busMarker.setIcon(makeBusIcon(matchedVehicle.azimuth, route, matchedVehicle.speed));
      }

      const stopsRemaining = calcStopsRemaining(
        state.mapTracking.tripStops,
        matchedVehicle.lat, matchedVehicle.lon,
        state.mapTracking.destStopName ?? state.selectedDirection?.headsign
      );

      let arrivalTimeStr;
      if (state.mapTracking.alightTimeSec) {
        const hours   = Math.floor(state.mapTracking.alightTimeSec / 3600) % 24;
        const minutes = Math.floor((state.mapTracking.alightTimeSec % 3600) / 60);
        arrivalTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
      updateMapInfo(matchedVehicle.speed, stopsRemaining, arrivalTimeStr);
    }

    if (leafletMap) {
      secondaryBusMarkers.forEach(marker => leafletMap.removeLayer(marker));
      secondaryBusMarkers = [];

      const siblingRoutes = state.mapTracking.siblingRoutes || [];
      const siblingVehicles = vehicles.filter(vehicle => {
        if (!siblingRoutes.includes(vehicle.route)) return false;
        if (matchedVehicle && vehicle.route === route &&
            Math.abs(vehicle.tripStartSec - matchedVehicle.tripStartSec) < 120) return false;
        return true;
      });

      for (const vehicle of siblingVehicles) {
        const marker = L.marker([vehicle.lat, vehicle.lon], {
          icon: makeSecondaryBusIcon(vehicle.azimuth, vehicle.route),
        });
        marker.bindPopup(`${escapeHtml(vehicle.route)} · ${vehicle.speed} km/h`);
        marker.addTo(leafletMap);
        secondaryBusMarkers.push(marker);
      }
    }
  } catch { /* GPS fetch failed silently */ }
}
