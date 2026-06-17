import { $, escapeHtml, localiseStopDesc, haversine, routeChipHtml } from './utils.js';
import { state } from './state.js';
import { showScreen, showOverlay, hideOverlay } from './navigation.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { selectDirection } from './arrivals.js';

let directionSearchTimer = null;

export function groupItemHtml(group) {
  const isFav = isFavorite(group.stop_name);
  const distance = group.distance_m != null ? `${group.distance_m} m` : '';
  const singleDesc = group.stops.length === 1 && group.stops[0].stop_desc
    ? `<div class="stop-desc">${escapeHtml(localiseStopDesc(group.stops[0].stop_desc))}</div>` : '';
  return `
    <div class="stop-item" data-name="${escapeHtml(group.stop_name)}">
      <div class="stop-item-main">
        <div class="stop-name">${escapeHtml(group.stop_name)}</div>
        ${singleDesc}
      </div>
      <div class="stop-right">
        <span class="stop-dist">${distance}</span>
        <button class="star-btn${isFav ? ' active' : ''}" data-name="${escapeHtml(group.stop_name)}" aria-label="${isFav ? 'Remove favorite' : 'Add favorite'}">${isFav ? '★' : '☆'}</button>
      </div>
    </div>`;
}

export function renderStopsList() {
  const list = $('stops-list');
  const searchQuery = $('search').value.trim().toLowerCase();

  if (searchQuery) {
    const searchBase = state.allGroups.length ? state.allGroups : state.groups;
    const favoriteNames = new Set(state.favorites.map(favorite => favorite.stop_name));
    const favoriteMatches = state.favorites.filter(group =>
      group.stop_name.toLowerCase().includes(searchQuery) ||
      group.stops.some(stop => (stop.stop_desc || '').toLowerCase().includes(searchQuery))
    );
    const nearbyMatches = searchBase
      .filter(group => {
        if (favoriteNames.has(group.stop_name)) return false;
        return group.stop_name.toLowerCase().includes(searchQuery) ||
          group.stops.some(stop => (stop.stop_desc || '').toLowerCase().includes(searchQuery));
      })
      .map(group => {
        if (state.userLat == null) return group;
        const closestDistance = group.stops.reduce((best, stop) => {
          const distance = Math.round(haversine(state.userLat, state.userLng, stop.stop_lat || 0, stop.stop_lon || 0));
          return distance < best ? distance : best;
        }, Infinity);
        return { ...group, distance_m: closestDistance };
      })
      .sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0))
      .slice(0, 30);

    const allMatches = [...favoriteMatches, ...nearbyMatches];
    if (!allMatches.length) {
      list.innerHTML = '<p class="empty">No stops found.</p>';
      return;
    }
    list.innerHTML = '<div class="section-label">Stops</div>' + allMatches.map(groupItemHtml).join('');
    bindStopItems(list, allMatches);
    return;
  }

  if (state.destResults.length) {
    const resultHtml = state.destResults.map(destItemHtml).join('');
    list.innerHTML = '<div class="section-label">Destinations</div>' + resultHtml;
    bindDestItems(list);
    return;
  }

  let html = '';
  if (state.favorites.length) {
    html += '<div class="section-label">Favorites</div>';
    html += state.favorites.map(groupItemHtml).join('');
  }
  if (state.filteredGroups.length) {
    html += '<div class="section-label">Nearby</div>';
    html += state.filteredGroups.map(groupItemHtml).join('');
  }
  if (!html) {
    list.innerHTML = '<p class="empty">No stops found.</p>';
    return;
  }
  list.innerHTML = html;
  bindStopItems(list, [...state.favorites, ...state.filteredGroups]);
}

export function bindStopItems(list, groups) {
  list.querySelectorAll('.stop-item').forEach(element => {
    element.addEventListener('click', event => {
      if (event.target.closest('.star-btn')) return;
      const group = groups.find(g => g.stop_name === element.dataset.name);
      if (!group) return;
      state.selectedGroup = group;
      const closestStop = group.stops.reduce((best, current) =>
        (current.distance_m ?? Infinity) < (best.distance_m ?? Infinity) ? current : best
      );
      selectStop(
        closestStop.stop_id,
        group.stop_name,
        closestStop.stop_desc,
        closestStop.stop_lat,
        closestStop.stop_lon,
        group.stops.map(stop => stop.stop_id)
      );
    });
  });
  list.querySelectorAll('.star-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const group = groups.find(g => g.stop_name === button.dataset.name);
      if (!group) return;
      toggleFavorite(group);
      renderStopsList();
    });
  });
}

function destItemHtml(item) {
  const distance = item.distance_m != null ? `${item.distance_m} m` : '';
  const descSuffix = item.stop_desc ? ` · ${escapeHtml(localiseStopDesc(item.stop_desc))}` : '';
  const itemIndex = state.destResults.indexOf(item);
  return `
    <div class="stop-item dest-item" data-idx="${itemIndex}">
      <div class="stop-item-main">
        <div class="stop-name">→ ${escapeHtml(item.destination_name)}</div>
        <div class="stop-desc">Board: ${escapeHtml(item.stop_name)}${descSuffix}</div>
        <div class="direction-routes">${item.routes.map(route => routeChipHtml(route)).join('')}</div>
      </div>
      <div class="stop-right"><span class="stop-dist">${distance}</span></div>
    </div>`;
}

function bindDestItems(list) {
  list.querySelectorAll('.dest-item').forEach(element => {
    element.addEventListener('click', () => {
      const item = state.destResults[parseInt(element.dataset.idx)];
      if (item) openDestination(item);
    });
  });
}

async function openDestination(item) {
  state.selectedStop = { stop_id: item.stop_id, stop_name: item.stop_name, stop_desc: item.stop_desc };
  state.selectedGroup = { stop_name: item.stop_name, stops: [{ stop_id: item.stop_id, stop_desc: item.stop_desc }] };
  const directionIds = item.direction_ids || [item.direction_id];
  await selectDirection({
    direction_id: directionIds[0],
    direction_ids: directionIds,
    headsign: item.destination_name,
    routes: item.routes,
  });
}

export function renderSubStops(group) {
  const list = $('stops-list');
  const sorted = [...group.stops].sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0));
  list.innerHTML = sorted.map(stop => `
    <div class="stop-item sub-stop-item" data-id="${stop.stop_id}">
      <div class="stop-desc-large">${escapeHtml(stop.stop_desc || 'Stop ' + stop.stop_id)}</div>
      <div class="stop-dist">${stop.distance_m != null ? stop.distance_m + ' m' : ''}</div>
    </div>`).join('');
  list.querySelectorAll('.sub-stop-item').forEach(element => {
    element.addEventListener('click', () => {
      const stopId = parseInt(element.dataset.id);
      const stop = group.stops.find(s => s.stop_id === stopId);
      if (stop) selectStop(stop.stop_id, group.stop_name, stop.stop_desc);
    });
  });
}

export async function loadNearbyStops(lat, lng) {
  state.userLat = lat;
  state.userLng = lng;
  showOverlay('Finding nearby stops…');
  try {
    const response = await fetch(`/api/stops/nearby?lat=${lat}&lng=${lng}`);
    state.groups = await response.json();
    state.filteredGroups = state.groups;
    renderStopsList();
  } catch {
    $('stops-list').innerHTML = '<p class="empty">Failed to load stops.</p>';
  } finally {
    hideOverlay();
  }
}

export async function selectStop(stopId, stopName, stopDesc, stopLat, stopLon, allStopIds) {
  state.selectedStop = {
    stop_id: stopId,
    stop_ids: allStopIds || [stopId],
    stop_name: stopName,
    stop_desc: stopDesc,
    stop_lat: stopLat,
    stop_lon: stopLon,
  };
  showScreen('directions', stopName);
  $('search').value = '';
  $('search').placeholder = 'Search destination…';
  $('directions-list').innerHTML = '<p class="empty">Loading…</p>';
  try {
    const response = await fetch(`/api/stops/${stopId}/directions`);
    state.directions = await response.json();
    renderDirections(state.directions);
  } catch {
    $('directions-list').innerHTML = '<p class="empty">Failed to load directions.</p>';
  }
}

export async function loadDestinations(query) {
  const locationParam = state.userLat != null ? `&lat=${state.userLat}&lng=${state.userLng}` : '';
  try {
    const response = await fetch(`/api/stops/destinations?q=${encodeURIComponent(query)}${locationParam}`);
    state.destResults = mergeDestResults(await response.json());
    renderStopsList();
  } catch { /* silent fail */ }
}

export function mergeDestResults(items) {
  const resultMap = {};
  for (const item of items) {
    const key = `${item.stop_name}::${item.destination_name}`;
    if (!resultMap[key]) {
      resultMap[key] = { ...item, routes: [...item.routes], direction_ids: [item.direction_id] };
    } else {
      if (item.distance_m != null && (resultMap[key].distance_m == null || item.distance_m < resultMap[key].distance_m)) {
        resultMap[key].stop_id = item.stop_id;
        resultMap[key].distance_m = item.distance_m;
      }
      for (const route of item.routes) {
        if (!resultMap[key].routes.find(existing => existing.route_short_name === route.route_short_name)) {
          resultMap[key].routes.push(route);
        }
      }
      if (!resultMap[key].direction_ids.includes(item.direction_id)) {
        resultMap[key].direction_ids.push(item.direction_id);
      }
    }
  }
  return Object.values(resultMap);
}

export async function searchDirections(query) {
  const stopId = state.selectedStop?.stop_id;
  if (!stopId) return;

  const headsignMatches = state.directions.filter(direction =>
    direction.headsign.toLowerCase().includes(query.toLowerCase())
  );

  const allGroups = state.allGroups.length ? state.allGroups : state.groups;
  const matchedStopNames = allGroups
    .filter(group => group.stop_name.toLowerCase().includes(query.toLowerCase()))
    .map(group => group.stop_name)
    .slice(0, 6);

  const allStopIds = state.selectedStop.stop_ids || [stopId];

  const responses = await Promise.all(
    matchedStopNames.flatMap(stopName =>
      allStopIds.map(sid =>
        fetch(`/api/stops/${sid}/directions?via=${encodeURIComponent(stopName)}`)
          .then(response => response.json())
          .then(directions => ({ stopName, sid, directions }))
          .catch(() => ({ stopName, sid, directions: [] }))
      )
    )
  );

  if ($('search').value.trim() !== query) return;

  const viaGroups = {};
  for (const { stopName, sid, directions } of responses) {
    if (!directions.length) continue;
    if (!viaGroups[stopName]) viaGroups[stopName] = { name: stopName, routes: [], directionIds: [], boardingStopIds: [] };
    for (const direction of directions) {
      for (const route of direction.routes) {
        if (!viaGroups[stopName].routes.find(existing => existing.route_short_name === route.route_short_name)) {
          viaGroups[stopName].routes.push(route);
        }
      }
      if (!viaGroups[stopName].directionIds.includes(direction.direction_id)) {
        viaGroups[stopName].directionIds.push(direction.direction_id);
      }
    }
    if (!viaGroups[stopName].boardingStopIds.includes(sid)) {
      viaGroups[stopName].boardingStopIds.push(sid);
    }
  }
  const viaItems = Object.values(viaGroups);

  const list = $('directions-list');
  let html = '';

  if (viaItems.length) {
    html += `<div class="section-label">Going to…</div>`;
    html += viaItems.map((item, index) => `
      <div class="direction-item via-item" data-via-idx="${index}">
        <div>
          <div class="direction-headsign"><span class="direction-arrow">→</span>${escapeHtml(item.name)}</div>
          <div class="direction-routes">${item.routes.map(route => routeChipHtml(route)).join('')}</div>
        </div>
      </div>`).join('');
  }

  html += headsignMatches.map((direction, index) => `
    <div class="direction-item" data-idx="${index}">
      <div>
        <div class="direction-headsign"><span class="direction-arrow">→</span>${escapeHtml(direction.headsign)}</div>
        <div class="direction-routes">${direction.routes.map(route => routeChipHtml(route)).join('')}</div>
      </div>
    </div>`).join('');

  if (!html) {
    list.innerHTML = `<p class="empty">No routes found for "${escapeHtml(query)}".</p>`;
    return;
  }
  list.innerHTML = html;

  list.querySelectorAll('.via-item').forEach(element => {
    const item = viaItems[parseInt(element.dataset.viaIdx)];
    element.addEventListener('click', () =>
      selectDirection({
        direction_id: item.directionIds[0],
        direction_ids: item.directionIds,
        headsign: item.name,
        routes: item.routes,
        boardingStopIds: item.boardingStopIds,
      })
    );
  });
  list.querySelectorAll('.direction-item:not(.via-item)').forEach(element =>
    element.addEventListener('click', () => selectDirection(headsignMatches[parseInt(element.dataset.idx)]))
  );
}

export function renderDirections(directions) {
  const list = $('directions-list');
  if (!directions.length) {
    list.innerHTML = '<p class="empty">No departures found today.</p>';
    return;
  }
  list.innerHTML = directions.map((direction, index) => `
    <div class="direction-item" data-idx="${index}">
      <div>
        <div class="direction-headsign"><span class="direction-arrow">→</span>${escapeHtml(direction.headsign)}</div>
        <div class="direction-routes">${direction.routes.map(route => routeChipHtml(route)).join('')}</div>
      </div>
    </div>`).join('');
  list.querySelectorAll('.direction-item').forEach(element => {
    element.addEventListener('click', () => selectDirection(directions[parseInt(element.dataset.idx)]));
  });
}

let destSearchTimer = null;

export function handleSearchInput() {
  if (state.screen === 'stops') {
    const query = $('search').value.trim();
    if (!query) {
      state.destResults = [];
      renderStopsList();
      return;
    }
    renderStopsList();
    clearTimeout(destSearchTimer);
    if (query.length >= 2) {
      destSearchTimer = setTimeout(() => loadDestinations(query), 300);
    }
  } else if (state.screen === 'directions') {
    const query = $('search').value.trim();
    clearTimeout(directionSearchTimer);
    if (!query) { renderDirections(state.directions); return; }
    $('directions-list').innerHTML = '<p class="empty">Searching…</p>';
    directionSearchTimer = setTimeout(() => searchDirections(query), 300);
  }
}
