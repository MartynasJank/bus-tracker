import https from 'https';
import db from './db.js';
import gpsCache from './gps-cache.js';
import { vilniusSecondsSinceMidnight, vilniusDayOfWeek } from './utils.js';

const GPS_SOURCE_URL = 'https://www.stops.lt/vilnius/gps_full.txt';
const COLLECTION_INTERVAL_MS = 60000;
const DEDUP_WINDOW_SEC = 120;
const RETENTION_DAYS = 30;

const busLastSeen = new Map();

function parseGpsText(text) {
  return text.split('\n')
    .filter(line => line.startsWith('Autobusai,'))
    .map(line => {
      const fields = line.split(',');
      if (fields.length < 11) return null;
      return {
        route:        fields[1].trim(),
        tripStartSec: (parseInt(fields[8]) || 0) * 60,
        delay:        parseInt(fields[9]) || 0,
        speed:        parseInt(fields[6]) || 0,
      };
    })
    .filter(Boolean);
}

async function fetchGpsText() {
  return new Promise((resolve, reject) =>
    https.get(GPS_SOURCE_URL, response => {
      let rawData = '';
      response.on('data', chunk => { rawData += chunk; });
      response.on('end', () => resolve(rawData));
    }).on('error', reject)
  );
}

async function collectDelaySnapshot() {
  try {
    const text = await fetchGpsText();

    // Update shared cache so the GPS proxy handler can serve it without a second fetch
    gpsCache.data = text;
    gpsCache.ts   = Date.now();

    const nowUnix    = Math.floor(Date.now() / 1000);
    const dayOfWeek  = vilniusDayOfWeek();
    const hourOfDay  = Math.floor(vilniusSecondsSinceMidnight() / 3600);

    const vehiclesToInsert = parseGpsText(text).filter(vehicle => {
      const key = `${vehicle.route}:${vehicle.tripStartSec}`;
      if (nowUnix - (busLastSeen.get(key) || 0) < DEDUP_WINDOW_SEC) return false;
      busLastSeen.set(key, nowUnix);
      return true;
    });

    if (vehiclesToInsert.length) {
      const insert = db.prepare(
        `INSERT INTO delay_log
          (route_short_name, trip_start_sec, observed_at, delay_sec, speed, day_of_week, hour)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      db.transaction(vehicles =>
        vehicles.forEach(vehicle =>
          insert.run(
            vehicle.route, vehicle.tripStartSec, nowUnix,
            vehicle.delay, vehicle.speed, dayOfWeek, hourOfDay
          )
        )
      )(vehiclesToInsert);
    }

    // Prune stale dedup entries
    if (busLastSeen.size > 2000) {
      for (const [key, lastSeen] of busLastSeen) {
        if (nowUnix - lastSeen > 600) busLastSeen.delete(key);
      }
    }

    // Rolling 30-day retention
    db.prepare('DELETE FROM delay_log WHERE observed_at < ?').run(nowUnix - RETENTION_DAYS * 86400);

  } catch (error) {
    console.error('Delay collect error:', error.message);
  }
}

export function startCollector() {
  collectDelaySnapshot();
  setInterval(collectDelaySnapshot, COLLECTION_INTERVAL_MS);
}
