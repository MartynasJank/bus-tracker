import { $ } from './utils.js';
import { state } from './state.js';
import { showScreen, showOverlay, hideOverlay } from './navigation.js';
import { loadFavorites } from './favorites.js';
import { showJourneyMap, stopMapTracking } from './map-journey.js';
import { openLiveMap, stopLiveMap } from './map-live.js';
import { renderStopsList, handleSearchInput } from './stops.js';
import { renderPlanRecents, setupPlanInputHandlers } from './plan.js';
import { openStats } from './stats.js';

$('back-btn').addEventListener('click', () => {
  if (state.screen === 'live-map') {
    stopLiveMap();
    history.replaceState(null, '', '/');
    showScreen(state.prevScreen === 'stops' ? 'stops' : 'plan',
               state.prevScreen === 'stops' ? 'Nearby Stops' : 'Plan Journey');
    return;
  }

  if (state.screen === 'stats') {
    history.replaceState(null, '', '/');
    showScreen(state.prevScreen === 'stops' ? 'stops' : 'plan',
               state.prevScreen === 'stops' ? 'Nearby Stops' : 'Plan Journey');
    return;
  }

  if (state.screen === 'map') {
    stopMapTracking();
    if (state.planMapMode) {
      state.planMapMode = false;
      showScreen('plan', 'Plan Journey');
    } else {
      showScreen('arrivals', state.selectedDirection.headsign);
    }
    return;
  }

  if (state.screen === 'arrivals') {
    clearInterval(state.refreshTimer);
    clearInterval(state.tickTimer);
    state.refreshTimer = null;
    state.tickTimer = null;
    showScreen('directions', state.selectedStop.stop_name);
    return;
  }

  if (state.screen === 'directions') {
    $('search').value = '';
    $('search').placeholder = 'Search stops…';
    state.destResults = [];
    showScreen('stops', 'Nearby Stops');
    renderStopsList();
  }
});

$('header-live-btn').addEventListener('click', () => {
  history.replaceState(null, '', '/live');
  showScreen('live-map', 'Live Buses');
  openLiveMap();
});

$('header-stats-btn').addEventListener('click', () => openStats(7));

$('header-plan-btn').addEventListener('click', () => {
  showScreen('plan', 'Plan Journey');
  $('plan-input').focus();
});

$('search').addEventListener('input', handleSearchInput);

setupPlanInputHandlers((journey, allJourneys) => {
  const destShortName = state.planDest?.name?.split(',')[0] || '';
  showScreen('map', `${journey.route_short_name} to ${destShortName}`);
  showJourneyMap(journey, allJourneys);
});

function init() {
  state.favorites = loadFavorites();

  if (location.pathname === '/stats') {
    openStats(7);
    return;
  }

  if (location.pathname === '/live') {
    history.replaceState(null, '', '/live');
    showScreen('live-map', 'Live Buses');
    openLiveMap();
    return;
  }

  fetch('/api/stops/all')
    .then(response => response.json())
    .then(data => {
      state.allGroups = data;
      if (state.screen === 'stops' && $('search').value.trim()) renderStopsList();
    })
    .catch(() => {});

  fetch('/api/routes/colors')
    .then(response => response.json())
    .then(data => { state.routeColors = data; })
    .catch(() => {});

  if (!navigator.geolocation) {
    showScreen('stops', 'Nearby Stops');
    renderStopsList();
    return;
  }

  showOverlay('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    position => {
      state.userLat = position.coords.latitude;
      state.userLng = position.coords.longitude;
      hideOverlay();
      showScreen('plan', 'Plan Journey');
      renderPlanRecents();
      fetch(`/api/stops/nearby?lat=${position.coords.latitude}&lng=${position.coords.longitude}`)
        .then(response => response.json())
        .then(data => {
          state.groups = data;
          state.filteredGroups = data;
        })
        .catch(() => {});
    },
    () => {
      hideOverlay();
      showScreen('stops', 'Nearby Stops');
      renderStopsList();
    },
    { timeout: 8000 }
  );
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
