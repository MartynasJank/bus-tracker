import { state } from './state.js';

const STORAGE_KEY = 'favGroups';

export function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

export function saveFavorites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
}

export function isFavorite(stopName) {
  return state.favorites.some(favorite => favorite.stop_name === stopName);
}

export function toggleFavorite(group) {
  if (isFavorite(group.stop_name)) {
    state.favorites = state.favorites.filter(favorite => favorite.stop_name !== group.stop_name);
  } else {
    state.favorites.push({ stop_name: group.stop_name, stops: group.stops });
  }
  saveFavorites();
}
