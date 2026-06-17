import { $, haversine } from './utils.js';
import { state } from './state.js';

let userWatchId    = null;
let userPosMarker  = null;
let arriveToastShown = false;

// leafletMap is provided by map-journey.js at runtime via setLeafletMap()
let leafletMapRef = null;
export function setLeafletMap(map) { leafletMapRef = map; }

export function startUserTracking() {
  if (!navigator.geolocation || userWatchId !== null) return;
  userWatchId = navigator.geolocation.watchPosition(
    position => updateUserPosition(position.coords.latitude, position.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

export function stopUserTracking() {
  if (userWatchId !== null) {
    navigator.geolocation.clearWatch(userWatchId);
    userWatchId = null;
  }
  if (userPosMarker && leafletMapRef) {
    leafletMapRef.removeLayer(userPosMarker);
    userPosMarker = null;
  }
  arriveToastShown = false;
  $('arrive-toast').classList.add('hidden');
}

export function createUserPositionMarker(lat, lon) {
  userPosMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: '<div class="map-pin-you"><div class="ring"></div><div class="core"></div></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
    zIndexOffset: 900,
  });
  userPosMarker._isMarker = true;
  userPosMarker.bindPopup('You').addTo(leafletMapRef);
}

export function updateUserPosition(lat, lon) {
  state.userLat = lat;
  state.userLng = lon;

  if (state.screen !== 'map' || !leafletMapRef) return;

  if (!userPosMarker) {
    createUserPositionMarker(lat, lon);
  } else {
    userPosMarker.setLatLng([lat, lon]);
  }

  if (state.planMapMode && state.mapTracking?.alightLat) {
    const distanceToAlight = haversine(lat, lon, state.mapTracking.alightLat, state.mapTracking.alightLon);
    if (distanceToAlight < 200 && !arriveToastShown) {
      arriveToastShown = true;
      const toast = $('arrive-toast');
      toast.textContent = `Arriving at ${state.mapTracking.destStopName || 'destination'}`;
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 8000);
    }
  }
}
