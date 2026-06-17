import { $ } from './utils.js';
import { state } from './state.js';

export function showScreen(name, title) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  $('header-title').textContent = title;
  state.screen = name;

  $('back-btn').classList.toggle('hidden', name === 'stops' || name === 'plan');
  $('search-bar-wrap').classList.toggle('hidden',
    name === 'arrivals' || name === 'map' || name === 'plan' || name === 'live-map' || name === 'stats'
  );
  $('header-plan-btn').classList.add('hidden');
  $('header-live-btn').classList.toggle('hidden', name !== 'plan' && name !== 'stops');
  $('header-stats-btn').classList.toggle('hidden', name !== 'plan' && name !== 'stops');

  if (name !== 'plan') {
    clearInterval(state.planTickTimer);
    state.planTickTimer = null;
  }
  if (name !== 'arrivals') {
    $('header-map-btn').classList.add('hidden');
    $('header-map-btn').removeAttribute('href');
  }
}

export function showOverlay(message) {
  $('overlay-msg').textContent = message;
  $('overlay').classList.remove('hidden');
}

export function hideOverlay() {
  $('overlay').classList.add('hidden');
}
