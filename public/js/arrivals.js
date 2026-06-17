import { $, escapeHtml, haversine, routeChipHtml, formatCountdown, countdownUrgencyClass,
         formatGtfsTime, gtfsTimeToSeconds, parseGpsText, clientSecondsSinceMidnight } from './utils.js';
import { state } from './state.js';
import { showScreen } from './navigation.js';
import { showBusMap } from './map-journey.js';

const tripStopsCache = new Map();

async function getTripStops(tripId) {
  if (tripStopsCache.has(tripId)) return tripStopsCache.get(tripId);
  try {
    const stops = await fetch(`/api/trips/${encodeURIComponent(tripId)}/stops`).then(response => response.json());
    tripStopsCache.set(tripId, stops);
    return stops;
  } catch { return []; }
}

function renderChips(routes) {
  $('chips-row').innerHTML = routes.map(route =>
    routeChipHtml(route, !state.activeRoutes.has(route.route_short_name))
  ).join('');
  $('chips-row').querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const routeName = chip.dataset.route;
      if (state.activeRoutes.has(routeName)) {
        state.activeRoutes.delete(routeName);
        chip.classList.add('inactive');
      } else {
        state.activeRoutes.add(routeName);
        chip.classList.remove('inactive');
      }
      applyChipFilter();
    });
  });
}

export async function selectDirection(direction) {
  state.selectedDirection = direction;
  state.activeRoutes = new Set(direction.routes.map(route => route.route_short_name));
  showScreen('arrivals', direction.headsign);

  const destParam = encodeURIComponent(direction.headsign + ', Vilnius');
  const origin = state.userLat != null
    ? `${state.userLat},${state.userLng}`
    : `${state.selectedStop.stop_lat},${state.selectedStop.stop_lon}`;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destParam}&travelmode=transit`;
  const mapsBtn = $('header-map-btn');
  mapsBtn.href = mapsUrl;
  mapsBtn.classList.remove('hidden');

  renderChips(direction.routes);
  await loadArrivals();

  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(loadArrivals, 15000);
}

async function loadArrivals() {
  const { selectedStop, selectedDirection } = state;
  if (!selectedStop || !selectedDirection) return;

  const directionIds = (selectedDirection.direction_ids || [selectedDirection.direction_id]).join(',');
  const destParam = selectedDirection.headsign
    ? `&dest=${encodeURIComponent(selectedDirection.headsign)}` : '';
  const boardingStopIds = (selectedDirection.boardingStopIds || [selectedStop.stop_id]).join(',');

  const [arrivalsResult, gpsResult] = await Promise.allSettled([
    fetch(`/api/stops/${boardingStopIds}/arrivals?directionId=${directionIds}${destParam}`).then(r => r.json()),
    fetch('/api/gps').then(r => r.text()),
  ]);

  if (arrivalsResult.status === 'fulfilled') state.arrivals = arrivalsResult.value;
  if (gpsResult.status === 'fulfilled') state.gpsVehicles = parseGpsText(gpsResult.value);
  state.arrivalsFetchedAt = Date.now();

  renderArrivals(enrichWithGPS(state.arrivals, state.gpsVehicles));
  refineSegmentETA();
  $('last-updated').textContent = `Updated ${new Date().toLocaleTimeString('lt-LT')}`;

  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(tickCountdowns, 1000);
}

function enrichWithGPS(arrivals, vehicles) {
  if (!vehicles.length) return arrivals;
  const boardingStop = state.selectedStop;

  return arrivals.map(arrival => {
    if (!arrival.trip_start_time) return arrival;

    const [startHour, startMin] = arrival.trip_start_time.split(':').map(Number);
    const tripStartSec = startHour * 3600 + startMin * 60;

    const matchingVehicles = vehicles.filter(vehicle => vehicle.route === arrival.route_short_name);
    if (!matchingVehicles.length) return arrival;

    const bestMatch = matchingVehicles.reduce((closest, vehicle) =>
      Math.abs(vehicle.tripStartSec - tripStartSec) < Math.abs(closest.tripStartSec - tripStartSec)
        ? vehicle : closest
    );

    if (Math.abs(bestMatch.tripStartSec - tripStartSec) > 300) return arrival;

    const [depHour, depMin, depSec] = arrival.departure_time.split(':').map(Number);
    const freshCountdown = Math.max(
      0,
      depHour * 3600 + depMin * 60 + (depSec || 0) + bestMatch.delay - clientSecondsSinceMidnight()
    );
    const busDistanceMeters = boardingStop
      ? Math.round(haversine(bestMatch.lat, bestMatch.lon, boardingStop.stop_lat, boardingStop.stop_lon))
      : null;

    return {
      ...arrival,
      countdown_seconds: freshCountdown,
      live: true,
      delay_sec: bestMatch.delay,
      bus_dist_m: busDistanceMeters,
      bus_lat: bestMatch.lat,
      bus_lon: bestMatch.lon,
      bus_trip_start: bestMatch.tripStartSec,
      bus_speed: bestMatch.speed,
      bus_azimuth: bestMatch.azimuth,
    };
  });
}

function renderArrivals(arrivals) {
  const list = $('arrivals-list');
  if (!arrivals.length) {
    list.innerHTML = '<p class="empty">No upcoming buses in the next 90 minutes.</p>';
    return;
  }

  const countPerRoute = {};
  const visibleArrivals = arrivals.filter(arrival => {
    countPerRoute[arrival.route_short_name] = (countPerRoute[arrival.route_short_name] || 0) + 1;
    return countPerRoute[arrival.route_short_name] <= 3;
  });

  list.innerHTML = visibleArrivals.map(arrival => {
    const urgencyClass = countdownUrgencyClass(arrival.countdown_seconds);
    const bg = arrival.route_color ? `#${arrival.route_color}` : '#444';
    const fg = arrival.route_text_color ? `#${arrival.route_text_color}` : '#fff';
    const isActive = state.activeRoutes.has(arrival.route_short_name);
    const liveIndicator = arrival.live ? '<span class="live-dot"></span>' : '';
    const prefix = arrival.live ? '' : '~';

    const delaySec = arrival.delay_sec ?? null;
    const delayBadge = delaySec === null ? '' :
      delaySec > 60  ? `<span class="delay-badge delay-late">+${Math.round(delaySec / 60)} min</span>` :
      delaySec < -60 ? `<span class="delay-badge delay-early">${Math.round(delaySec / 60)} min</span>` :
      `<span class="delay-badge delay-ok">on time</span>`;

    const departTime = formatGtfsTime(arrival.departure_time);
    const destTime = formatGtfsTime(arrival.dest_time);
    const travelMinutes = (arrival.dest_time && arrival.departure_time)
      ? Math.round((gtfsTimeToSeconds(arrival.dest_time) - gtfsTimeToSeconds(arrival.departure_time)) / 60)
      : null;
    const distanceKm = arrival.dist_m ? (arrival.dist_m / 1000).toFixed(1) : null;
    const metaText = [travelMinutes ? `${travelMinutes} min` : null, distanceKm ? `${distanceKm} km` : null]
      .filter(Boolean).join(' · ');

    const destHtml = destTime
      ? `<div class="arrival-dest">arr. ${destTime}${metaText ? `<span class="arrival-meta"> · ${metaText}</span>` : ''}</div>`
      : '';
    const busDistHtml = arrival.live && arrival.bus_dist_m != null
      ? `<div class="bus-at-stop" data-trip-id="${escapeHtml(arrival.trip_id || '')}" data-bus-lat="${arrival.bus_lat || ''}" data-bus-lon="${arrival.bus_lon || ''}">${arrival.bus_dist_m}m away</div>`
      : '';
    const mapButtonHtml = (arrival.live && arrival.bus_lat)
      ? `<button class="map-btn" aria-label="Show on map">&#8857;</button>` : '';

    const countdownText = arrival.countdown_seconds >= 3600
      ? prefix + departTime
      : prefix + formatCountdown(arrival.countdown_seconds);
    const countdownSub = arrival.countdown_seconds >= 3600 && departTime
      ? `<span class="depart-sub">${formatCountdown(arrival.countdown_seconds)}</span>` : '';

    return `
      <div class="arrival-item${isActive ? '' : ' hidden'}" style="--route-bg:${bg}"
           data-route="${escapeHtml(arrival.route_short_name)}"
           data-base-countdown="${arrival.countdown_seconds}"
           data-live="${arrival.live ? '1' : ''}"
           data-depart-time="${departTime || ''}"
           data-bus-lat="${arrival.bus_lat || ''}"
           data-bus-lon="${arrival.bus_lon || ''}"
           data-bus-trip-start="${arrival.bus_trip_start || ''}"
           data-bus-azimuth="${arrival.bus_azimuth || 0}"
           data-bus-speed="${arrival.bus_speed || 0}"
           data-trip-id="${escapeHtml(arrival.trip_id || '')}">
        <span class="arrival-route" style="background:${bg};color:${fg}">${escapeHtml(arrival.route_short_name)}</span>
        <div class="arrival-info">
          <div class="arrival-headsign">${escapeHtml(arrival.headsign)}</div>
          ${destHtml}
          ${busDistHtml}
        </div>
        <div class="arrival-countdown ${urgencyClass}">
          <span class="countdown-main">${liveIndicator}<span class="countdown-text">${countdownText}</span></span>
          ${countdownSub}${delayBadge}
        </div>
        ${mapButtonHtml}
      </div>`;
  }).join('');

  list.querySelectorAll('.map-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const row = button.closest('.arrival-item');
      const tracking = {
        route: row.dataset.route,
        bus_lat: parseFloat(row.dataset.busLat),
        bus_lon: parseFloat(row.dataset.busLon),
        bus_trip_start: parseInt(row.dataset.busTripStart) || 0,
        bus_azimuth: parseInt(row.dataset.busAzimuth) || 0,
        bus_speed: parseInt(row.dataset.busSpeed) || 0,
        trip_id: row.dataset.tripId,
      };
      const mapTitle = tracking.route + (state.selectedDirection ? ' to ' + state.selectedDirection.headsign : '');
      showScreen('map', mapTitle);
      showBusMap(tracking);
    });
  });
}

async function refineSegmentETA() {
  if (state.screen !== 'arrivals') return;
  const liveElements = [...$('arrivals-list').querySelectorAll('.bus-at-stop')];
  await Promise.all(liveElements.map(async element => {
    const tripId = element.dataset.tripId;
    const busLat = parseFloat(element.dataset.busLat);
    const busLon = parseFloat(element.dataset.busLon);
    if (!tripId || isNaN(busLat)) return;

    const stops = await getTripStops(tripId);
    if (!stops.length) return;

    let nearestIndex = 0, nearestDistance = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const distance = haversine(busLat, busLon, stops[i].stop_lat, stops[i].stop_lon);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = i; }
    }
    const nearestStop = stops[nearestIndex];
    const distMatch = element.textContent.match(/^(\d+)m/);
    element.textContent = distMatch
      ? `${distMatch[1]}m · at ${nearestStop.stop_name}`
      : `at ${nearestStop.stop_name}`;
  }));
}

export function tickCountdowns() {
  const elapsed = Math.floor((Date.now() - state.arrivalsFetchedAt) / 1000);
  $('arrivals-list').querySelectorAll('.arrival-item').forEach(row => {
    const baseCountdown = parseInt(row.dataset.baseCountdown) || 0;
    const remaining = Math.max(0, baseCountdown - elapsed);
    const isLive = row.dataset.live === '1';
    const textEl = row.querySelector('.countdown-text');
    const subEl = row.querySelector('.depart-sub');
    const countdownEl = row.querySelector('.arrival-countdown');
    if (!textEl || !countdownEl) return;

    const prefix = isLive ? '' : '~';
    if (remaining >= 3600) {
      textEl.textContent = prefix + (row.dataset.departTime || formatCountdown(remaining));
      if (subEl) subEl.textContent = formatCountdown(remaining);
    } else {
      textEl.textContent = prefix + formatCountdown(remaining);
      if (subEl) subEl.textContent = '';
    }
    const urgencyClass = countdownUrgencyClass(remaining);
    countdownEl.className = `arrival-countdown${urgencyClass ? ' ' + urgencyClass : ''}`;
  });
}

export function applyChipFilter() {
  $('arrivals-list').querySelectorAll('.arrival-item').forEach(row => {
    row.classList.toggle('hidden', !state.activeRoutes.has(row.dataset.route));
  });
}
