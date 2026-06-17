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

export function respond(res, status, body) {
  const isJson = typeof body === 'object';
  res.setHeader('Content-Type', isJson ? 'application/json' : 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(status);
  res.end(isJson ? JSON.stringify(body) : String(body));
}

export function vilniusSecondsSinceMidnight() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vilnius',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const hours   = parseInt(parts.find(p => p.type === 'hour').value);
  const minutes = parseInt(parts.find(p => p.type === 'minute').value);
  const seconds = parseInt(parts.find(p => p.type === 'second').value);
  return hours * 3600 + minutes * 60 + seconds;
}

export function vilniusDayOfWeek() {
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Vilnius', weekday: 'short',
  }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
}

export function gtfsTimeToSeconds(timeString) {
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return hours * 3600 + minutes * 60 + (seconds || 0);
}
