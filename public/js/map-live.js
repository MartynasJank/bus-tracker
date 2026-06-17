import { escapeHtml, parseGpsText, makeBusIcon } from './utils.js';
import { state } from './state.js';

let liveMap        = null;
let liveBusMarkers = new Map();
let liveMapTimer   = null;

export async function openLiveMap() {
  state.prevScreen = state.screen;

  // showScreen is called by the caller (main.js) before this runs
  await new Promise(resolve => setTimeout(resolve, 30));

  if (!liveMap) {
    const center = state.userLat ? [state.userLat, state.userLng] : [54.689, 25.279];
    liveMap = L.map('live-map-container', { zoomControl: false }).setView(center, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(liveMap);
    L.control.zoom({ position: 'bottomright' }).addTo(liveMap);

    if (state.userLat) {
      L.marker([state.userLat, state.userLng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="map-pin-you"><div class="ring"></div><div class="core"></div></div>',
          iconSize: [18, 18], iconAnchor: [9, 9],
        }),
      }).addTo(liveMap);
    }
  } else {
    liveMap.invalidateSize();
  }

  await refreshLiveMap();
  liveMapTimer = setInterval(refreshLiveMap, 4000);
}

export function stopLiveMap() {
  clearInterval(liveMapTimer);
  liveMapTimer = null;
}

async function refreshLiveMap() {
  if (state.screen !== 'live-map' || !liveMap) return;
  try {
    const text     = await fetch('/api/gps').then(response => response.text());
    const vehicles = parseGpsText(text);
    const activeKeys = new Set();

    for (const vehicle of vehicles) {
      const key  = `${vehicle.route}:${vehicle.tripStartSec}`;
      const icon = makeBusIcon(vehicle.azimuth, vehicle.route, vehicle.speed);
      activeKeys.add(key);

      if (liveBusMarkers.has(key)) {
        const marker = liveBusMarkers.get(key);
        marker.setLatLng([vehicle.lat, vehicle.lon]);
        marker.setIcon(icon);
      } else {
        const marker = L.marker([vehicle.lat, vehicle.lon], { icon });
        marker.bindPopup(`<b>${escapeHtml(vehicle.route)}</b> · ${vehicle.speed} km/h`);
        marker.addTo(liveMap);
        liveBusMarkers.set(key, marker);
      }
    }

    // Remove markers for buses that are no longer in the GPS feed
    for (const [key, marker] of liveBusMarkers) {
      if (!activeKeys.has(key)) {
        liveMap.removeLayer(marker);
        liveBusMarkers.delete(key);
      }
    }
  } catch { /* GPS fetch failed silently */ }
}
