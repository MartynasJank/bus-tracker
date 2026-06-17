export const $ = id => document.getElementById(id);

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LITHUANIAN_WORDS = { stoties: 'Station', centro: 'Centre', troleibusai: 'trolleybuses' };

export function localiseStopDesc(str) {
  if (!str) return str;
  return str
    .replace(/^link\s+/i, '')
    .replace(/\b(\w+)\b/g, word => LITHUANIAN_WORDS[word.toLowerCase()] || word);
}

export function haversine(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_M = 6371000;
  const toRad = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * toRad;
  const deltaLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatCountdown(totalSeconds) {
  if (totalSeconds <= 0) return 'Now';
  if (totalSeconds >= 3600) {
    const hours   = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatPlanCountdown(totalSeconds) {
  if (totalSeconds <= 0) return 'Now';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function countdownUrgencyClass(totalSeconds) {
  if (totalSeconds < 60)  return 'imminent';
  if (totalSeconds < 300) return 'soon';
  return '';
}

export function formatGtfsTime(timeString) {
  if (!timeString) return null;
  const [hours, minutes] = timeString.split(':').map(Number);
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function gtfsTimeToSeconds(timeString) {
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return hours * 3600 + minutes * 60 + (seconds || 0);
}

export function clientSecondsSinceMidnight() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

export function parseGpsText(text) {
  return text.split('\n')
    .filter(line => line.startsWith('Autobusai,'))
    .map(line => {
      const fields = line.split(',');
      if (fields.length < 11) return null;
      return {
        route:        fields[1].trim(),
        tripStartSec: (parseInt(fields[8]) || 0) * 60,
        delay:        parseInt(fields[9]) || 0,
        lat:          parseInt(fields[5]) / 1e6,
        lon:          parseInt(fields[4]) / 1e6,
        speed:        parseInt(fields[6]) || 0,
        azimuth:      parseInt(fields[7]) || 0,
      };
    })
    .filter(Boolean);
}

export function makeBusIcon(azimuth, route, speed) {
  const isStopped = speed === 0;
  const color     = isStopped ? '#fbbf24' : '#34d399';
  const label     = isStopped ? `${route} · stopped` : `${route} · ${speed}`;
  const svg = `<svg viewBox="0 0 20 30" width="20" height="30" xmlns="http://www.w3.org/2000/svg">
    <polygon points="10,1 17,8 3,8" fill="${color}" stroke="#fff" stroke-width="1"/>
    <rect x="2" y="7" width="16" height="20" rx="3" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <rect x="4" y="10" width="5" height="4" rx="1" fill="rgba(255,255,255,0.85)"/>
    <rect x="11" y="10" width="5" height="4" rx="1" fill="rgba(255,255,255,0.85)"/>
    <rect x="4" y="16" width="5" height="3" rx="1" fill="rgba(255,255,255,0.5)"/>
    <rect x="11" y="16" width="5" height="3" rx="1" fill="rgba(255,255,255,0.5)"/>
    <rect x="7" y="21" width="6" height="5" rx="1" fill="rgba(0,0,0,0.25)"/>
  </svg>`;
  const html = `<div class="bus-marker-outer${isStopped ? ' bus-stopped' : ''}">
    <div class="bus-icon" style="transform:rotate(${azimuth}deg)">${svg}</div>
    <div class="bus-label">${label}</div>
  </div>`;
  return L.divIcon({ className: '', html, iconSize: [20, 30], iconAnchor: [10, 15] });
}

export function makeSecondaryBusIcon(azimuth, route) {
  const svg = `<svg viewBox="0 0 20 30" width="13" height="20" xmlns="http://www.w3.org/2000/svg">
    <polygon points="10,1 17,8 3,8" fill="#8b7cf8"/>
    <rect x="2" y="7" width="16" height="20" rx="3" fill="#8b7cf8"/>
    <rect x="4" y="10" width="5" height="4" rx="1" fill="rgba(255,255,255,0.55)"/>
    <rect x="11" y="10" width="5" height="4" rx="1" fill="rgba(255,255,255,0.55)"/>
  </svg>`;
  const html = `<div class="bus-marker-secondary-wrap">
    <div style="transform:rotate(${azimuth}deg);display:flex">${svg}</div>
    <div class="bus-marker-secondary-label">${escapeHtml(route)}</div>
  </div>`;
  return L.divIcon({ className: '', html, iconSize: [30, 28], iconAnchor: [15, 12] });
}

export function routeChipHtml(route, inactive = false) {
  const bg = route.route_color      ? `#${route.route_color}`      : '#444';
  const fg = route.route_text_color ? `#${route.route_text_color}` : '#fff';
  return `<span class="chip${inactive ? ' inactive' : ''}" style="background:${bg};color:${fg}" data-route="${escapeHtml(route.route_short_name)}">${escapeHtml(route.route_short_name)}</span>`;
}
