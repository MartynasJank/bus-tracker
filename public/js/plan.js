import { $, escapeHtml, formatPlanCountdown } from './utils.js';
import { state } from './state.js';

const RECENTS_STORAGE_KEY = 'recentPlaces';
const MAX_RECENT_PLACES   = 5;

let planDebounceTimer = null;

export function loadRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_STORAGE_KEY) || '[]'); } catch { return []; }
}

export function saveRecent(place) {
  const recents = loadRecents().filter(recent => recent.name !== place.name);
  recents.unshift({ name: place.name, lat: place.lat, lon: place.lon });
  localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents.slice(0, MAX_RECENT_PLACES)));
}

export function renderPlanRecents() {
  const recents = loadRecents();
  const container = $('plan-recents');
  if (!recents.length) { container.classList.add('hidden'); return; }
  container.innerHTML =
    '<div class="recents-label">Recent</div>' +
    recents.map((recent, index) =>
      `<button class="plan-recent-chip" data-idx="${index}">${escapeHtml(recent.name)}</button>`
    ).join('');
  container.__recents = recents;
  container.classList.remove('hidden');
}

export function renderPlanSuggestions(suggestions) {
  const box = $('plan-suggestions');
  if (!suggestions.length) { box.classList.add('hidden'); return; }
  box.innerHTML = suggestions.map((suggestion, index) =>
    `<div class="plan-suggestion-item" data-idx="${index}">
      <div>${escapeHtml(suggestion.name)}</div>
      <div class="plan-suggestion-sub">${escapeHtml(suggestion.full)}</div>
    </div>`
  ).join('');
  box.classList.remove('hidden');
  box.__suggestions = suggestions;
}

export function renderPlanResults(journeys) {
  const container = $('plan-results');
  if (!journeys.length) {
    container.innerHTML = '<div class="plan-empty">No direct routes found nearby.<br>Try a different destination.</div>';
    return;
  }
  state.planFetchedAt = Date.now();
  container.innerHTML = journeys.map((journey, index) => {
    const bg          = journey.route_color      ? `#${journey.route_color}`      : 'var(--accent)';
    const fg          = journey.route_text_color ? `#${journey.route_text_color}` : '#000';
    const delay        = journey.live_delay_sec ?? 0;
    const actualCdown  = journey.countdown_seconds + delay;
    const leftEarly    = delay < -30 && actualCdown < 0;
    const earlyAbs     = Math.abs(delay);
    const earlyMin     = Math.floor(earlyAbs / 60), earlySec = earlyAbs % 60;
    const earlyLabel   = earlyMin ? `${earlyMin}m ${earlySec}s early` : `${earlySec}s early`;
    const countdown    = leftEarly ? `Left ${earlyLabel}` : formatPlanCountdown(journey.countdown_seconds);
    const arrivalSecs  = journey.countdown_seconds + (journey.travel_min + journey.alight_walk_min) * 60;
    const boardTime    = journey.board_time.slice(0, 5);
    let delayBadge = '';
    if (!leftEarly && delay >= 60) {
      const m = Math.floor(delay / 60), s = delay % 60;
      delayBadge = `<span class="plan-delay-badge plan-delay-late">${m}m${s ? ` ${s}s` : ''} late</span>`;
    } else if (!leftEarly && delay <= -30) {
      const abs = Math.abs(delay);
      const m = Math.floor(abs / 60), s = abs % 60;
      delayBadge = `<span class="plan-delay-badge plan-delay-early">${m ? `${m}m${s ? ` ${s}s` : ''}` : `${s}s`} early</span>`;
    }
    return `<div class="plan-card${leftEarly ? ' plan-card-left-early' : ''}" data-idx="${index}" data-base-countdown="${journey.countdown_seconds}" data-arrival-offset="${journey.travel_min * 60 + journey.alight_walk_min * 60}">
      <div class="plan-card-top">
        <span class="plan-route-badge" style="background:${bg};color:${fg}">${escapeHtml(journey.route_short_name)}</span>
        <span class="plan-headsign">${escapeHtml(journey.headsign)}</span>
        <div class="plan-countdown-wrap">
          <span class="plan-countdown${leftEarly ? ' plan-countdown-early' : ''}">${countdown}</span>
          <span class="plan-board-time">${boardTime}</span>
          ${delayBadge}
          ${leftEarly ? '' : `<span class="plan-arrives">arr. ${formatPlanCountdown(arrivalSecs)}</span>`}
        </div>
      </div>
      <div class="plan-legs">
        <span class="plan-leg-walk">🚶 ${journey.board_walk_min} min</span>
        <span class="plan-leg-sep">›</span>
        <span class="plan-leg-bus">🚌 ${journey.travel_min} min</span>
        <span class="plan-leg-sep">›</span>
        <span class="plan-leg-walk">🚶 ${journey.alight_walk_min} min</span>
      </div>
      <div class="plan-total">
        <span>${escapeHtml(journey.board_stop.name)} → ${escapeHtml(journey.alight_stop.name)}</span>
        <span style="flex-shrink:0">${journey.total_min} min total</span>
      </div>
    </div>`;
  }).join('');
  container.__journeys = journeys;
}

export async function runPlan(lat, lon, name) {
  if (!state.userLat) {
    $('plan-results').innerHTML = '<div class="plan-empty">Location unavailable.</div>';
    return;
  }
  state.planDest = { name, lat, lon };
  $('plan-results').innerHTML = '<div class="plan-empty">Finding routes…</div>';
  clearInterval(state.planTickTimer);
  state.planTickTimer = null;
  try {
    const url      = `/api/plan?fromLat=${state.userLat}&fromLon=${state.userLng}&toLat=${lat}&toLon=${lon}`;
    const journeys = await fetch(url).then(response => response.json());
    renderPlanResults(journeys);
    if (journeys.length) {
      state.planTickTimer = setInterval(tickPlanCountdowns, 1000);
    }
  } catch {
    $('plan-results').innerHTML = '<div class="plan-empty">Could not load routes.</div>';
  }
}

export async function geocodeNominatim(query) {
  const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=lt&viewbox=25.0,54.5,25.5,54.9&bounded=1`;
  const data = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(response => response.json());
  return data.map(result => ({
    name: result.display_name.split(',').slice(0, 2).join(',').trim(),
    full: result.display_name,
    lat:  parseFloat(result.lat),
    lon:  parseFloat(result.lon),
  }));
}

export function tickPlanCountdowns() {
  if (state.screen !== 'plan') return;
  const elapsed = Math.floor((Date.now() - state.planFetchedAt) / 1000);
  $('plan-results').querySelectorAll('.plan-card').forEach(card => {
    const baseCountdown    = parseInt(card.dataset.baseCountdown) || 0;
    const arrivalOffset    = parseInt(card.dataset.arrivalOffset) || 0;
    const departureSecs    = Math.max(0, baseCountdown - elapsed);
    const arrivalSecs      = Math.max(0, baseCountdown + arrivalOffset - elapsed);
    const countdownEl      = card.querySelector('.plan-countdown');
    const arrivalEl        = card.querySelector('.plan-arrives');
    if (countdownEl) countdownEl.textContent = formatPlanCountdown(departureSecs);
    if (arrivalEl)   arrivalEl.textContent   = `arr. ${formatPlanCountdown(arrivalSecs)}`;
  });
}

export function setupPlanInputHandlers(onJourneySelect) {
  $('plan-input').addEventListener('focus', () => {
    if (!$('plan-input').value.trim()) renderPlanRecents();
  });

  $('plan-input').addEventListener('input', () => {
    clearTimeout(planDebounceTimer);
    const query = $('plan-input').value.trim();
    if (query.length < 2) {
      $('plan-suggestions').classList.add('hidden');
      if (!query) renderPlanRecents();
      else $('plan-recents').classList.add('hidden');
      return;
    }
    $('plan-recents').classList.add('hidden');
    planDebounceTimer = setTimeout(async () => {
      try {
        const suggestions = await geocodeNominatim(query);
        renderPlanSuggestions(suggestions);
      } catch { /* geocoding failed silently */ }
    }, 350);
  });

  $('plan-recents').addEventListener('click', event => {
    const chip = event.target.closest('.plan-recent-chip');
    if (!chip) return;
    const recent = $('plan-recents').__recents?.[parseInt(chip.dataset.idx)];
    if (!recent) return;
    $('plan-input').value = recent.name;
    $('plan-recents').classList.add('hidden');
    runPlan(recent.lat, recent.lon, recent.name);
  });

  $('plan-suggestions').addEventListener('click', event => {
    const item = event.target.closest('.plan-suggestion-item');
    if (!item) return;
    const suggestion = $('plan-suggestions').__suggestions[parseInt(item.dataset.idx)];
    $('plan-input').value = suggestion.name;
    $('plan-suggestions').classList.add('hidden');
    saveRecent(suggestion);
    runPlan(suggestion.lat, suggestion.lon, suggestion.name);
  });

  $('plan-results').addEventListener('click', event => {
    const card = event.target.closest('.plan-card');
    if (!card) return;
    const allJourneys = $('plan-results').__journeys || [];
    const journey     = allJourneys[parseInt(card.dataset.idx)];
    if (journey) onJourneySelect(journey, allJourneys);
  });
}
