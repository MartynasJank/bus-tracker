import db from '../db.js';
import { haversine, bearing, respond, vilniusSecondsSinceMidnight, gtfsTimeToSeconds } from '../utils.js';
import { getServiceIds } from '../schedule.js';
import { stopsNear } from './stops.js';
import gpsCache from '../gps-cache.js';
import { parseGpsText } from '../collector.js';

const WALK_SPEED_MPS = 80; // metres per minute (~4.8 km/h)

async function osrmWalkMinutes(fromLat, fromLon, toLat, toLon) {
  const fallbackMinutes = Math.max(1, Math.round(haversine(fromLat, fromLon, toLat, toLon) / WALK_SPEED_MPS));
  try {
    const url = `https://router.project-osrm.org/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
    const data = await fetch(url).then(response => response.json());
    const routeDistance = data.routes?.[0]?.distance;
    return routeDistance ? Math.max(1, Math.round(routeDistance / WALK_SPEED_MPS)) : fallbackMinutes;
  } catch {
    return fallbackMinutes;
  }
}

export async function handlePlan(req, res, params) {
  const fromLat = parseFloat(params.get('fromLat'));
  const fromLon = parseFloat(params.get('fromLon'));
  const toLat   = parseFloat(params.get('toLat'));
  const toLon   = parseFloat(params.get('toLon'));

  if ([fromLat, fromLon, toLat, toLon].some(isNaN)) {
    return respond(res, 400, { error: 'Invalid coordinates' });
  }

  const originStops = stopsNear(fromLat, fromLon, 700);
  const destStops   = stopsNear(toLat, toLon, 700);
  if (!originStops.length || !destStops.length) return respond(res, 200, []);

  let serviceIds       = getServiceIds(0);
  let countdownOffset  = 0;
  if (!serviceIds.length) { serviceIds = getServiceIds(1); countdownOffset = 86400; }
  if (!serviceIds.length) return respond(res, 200, []);

  const nowSec     = vilniusSecondsSinceMidnight();
  const nowTimeStr = [
    String(Math.floor(nowSec / 3600)).padStart(2, '0'),
    String(Math.floor((nowSec % 3600) / 60)).padStart(2, '0'),
    String(nowSec % 60).padStart(2, '0'),
  ].join(':');

  // Build live delay and position maps from GPS cache
  const liveDelay    = {};
  const livePosition = {};
  if (gpsCache.data) {
    for (const v of parseGpsText(gpsCache.data)) {
      const key = `${v.route}:${v.tripStartSec}`;
      liveDelay[key]    = v.delay;
      livePosition[key] = { lat: v.lat, lon: v.lon, azimuth: v.azimuth, speed: v.speed };
    }
  }

  // Look back up to 10 min so late buses still appear in the query
  const lookbackSec = Math.max(0, nowSec - 600);
  const lookbackTimeStr = [
    String(Math.floor(lookbackSec / 3600)).padStart(2, '0'),
    String(Math.floor((lookbackSec % 3600) / 60)).padStart(2, '0'),
    String(lookbackSec % 60).padStart(2, '0'),
  ].join(':');

  const originPlaceholders  = originStops.map(() => '?').join(',');
  const destPlaceholders    = destStops.map(() => '?').join(',');
  const servicePlaceholders = serviceIds.map(() => '?').join(',');

  // Find all trips that pass through an origin stop before a dest stop
  const rows = db.prepare(`
    SELECT
      r.route_short_name, r.route_color, r.route_text_color,
      st1.stop_id AS board_id, s1.stop_name AS board_name, s1.stop_lat AS board_lat, s1.stop_lon AS board_lon,
      st2.stop_id AS alight_id, s2.stop_name AS alight_name, s2.stop_lat AS alight_lat, s2.stop_lon AS alight_lon,
      st1.departure_time AS board_time, st2.departure_time AS alight_time,
      t.trip_id, t.trip_headsign, t.trip_start_time
    FROM stop_times st1
    JOIN trips t ON t.trip_id = st1.trip_id
    JOIN routes r ON r.route_id = t.route_id
    JOIN stops s1 ON s1.stop_id = st1.stop_id
    JOIN stop_times st2
      ON st2.trip_id = st1.trip_id
      AND st2.stop_id IN (${destPlaceholders})
      AND st2.stop_sequence > st1.stop_sequence
    JOIN stops s2 ON s2.stop_id = st2.stop_id
    WHERE st1.stop_id IN (${originPlaceholders})
      AND t.service_id IN (${servicePlaceholders})
      AND st1.departure_time >= ?
    ORDER BY st1.departure_time
    LIMIT 300
  `).all(...destStops.map(stop => stop.stop_id), ...originStops.map(stop => stop.stop_id), ...serviceIds, lookbackTimeStr);

  // Keep up to 3 departures per route
  const routeDepartureCount = {};
  const candidates = [];
  for (const row of rows) {
    const routeKey = row.route_short_name;
    if ((routeDepartureCount[routeKey] || 0) >= 3) continue;
    routeDepartureCount[routeKey] = (routeDepartureCount[routeKey] || 0) + 1;

    const travelMinutes  = Math.round((gtfsTimeToSeconds(row.alight_time) - gtfsTimeToSeconds(row.board_time)) / 60);
    const countdownSecs  = gtfsTimeToSeconds(row.board_time) + countdownOffset - nowSec;
    const tripKey = `${row.route_short_name}:${gtfsTimeToSeconds(row.trip_start_time)}`;
    const liveDelaySec = liveDelay[tripKey] ?? 0;
    const actualCountdown = countdownSecs + liveDelaySec;
    if (countdownSecs < 0 && liveDelaySec <= 0) continue; // departed on schedule, not in GPS feed
    if (actualCountdown < -60) continue; // departed more than 1 min ago in actual time

    // If past scheduled time, check GPS position — skip if bus has already passed the board stop
    if (countdownSecs < 0) {
      const pos = livePosition[tripKey];
      if (pos && pos.speed > 0) {
        const distToStop = haversine(pos.lat, pos.lon, row.board_lat, row.board_lon);
        if (distToStop > 200) {
          const bearingToStop = bearing(pos.lat, pos.lon, row.board_lat, row.board_lon);
          const angleDiff = Math.abs(((bearingToStop - pos.azimuth + 540) % 360) - 180);
          if (angleDiff > 90) continue; // board stop is behind the bus
        }
      }
    }

    candidates.push({
      route_short_name: row.route_short_name,
      route_color:      row.route_color,
      route_text_color: row.route_text_color,
      headsign:         row.trip_headsign,
      trip_id:          row.trip_id,
      board_stop:       { id: row.board_id, name: row.board_name, lat: row.board_lat, lon: row.board_lon },
      alight_stop:      { id: row.alight_id, name: row.alight_name, lat: row.alight_lat, lon: row.alight_lon },
      trip_start_time:  row.trip_start_time,
      board_time:       row.board_time,
      alight_time:      row.alight_time,
      travel_min:       travelMinutes,
      countdown_seconds: countdownSecs,
      live_delay_sec:    liveDelaySec,
      _boardKey:    `${row.board_lat},${row.board_lon}`,
      _alightKey:   `${row.alight_lat},${row.alight_lon}`,
      _boardCoords: [fromLat, fromLon, row.board_lat, row.board_lon],
      _alightCoords: [toLat, toLon, row.alight_lat, row.alight_lon],
    });
  }

  const upcoming = candidates.slice(0, 12);

  // Fetch real walking times from OSRM, deduplicating calls by stop coordinates
  const walkTimeCache = new Map();
  const cachedWalkTime = (cacheKey, coords) => {
    if (!walkTimeCache.has(cacheKey)) {
      walkTimeCache.set(cacheKey, osrmWalkMinutes(...coords));
    }
    return walkTimeCache.get(cacheKey);
  };

  await Promise.all(upcoming.map(async candidate => {
    const [boardWalkMin, alightWalkMin] = await Promise.all([
      cachedWalkTime(candidate._boardKey,  candidate._boardCoords),
      cachedWalkTime(candidate._alightKey, candidate._alightCoords),
    ]);
    candidate.board_walk_min  = boardWalkMin;
    candidate.alight_walk_min = alightWalkMin;
    candidate.total_min       = boardWalkMin + candidate.travel_min + alightWalkMin;
    delete candidate._boardCoords;
    delete candidate._alightCoords;
    delete candidate._boardKey;
    delete candidate._alightKey;
  }));

  // Sort by total time to arrival at destination
  upcoming.sort((a, b) => {
    const arrivalA = a.countdown_seconds + (a.travel_min + a.alight_walk_min) * 60;
    const arrivalB = b.countdown_seconds + (b.travel_min + b.alight_walk_min) * 60;
    return arrivalA - arrivalB;
  });

  respond(res, 200, upcoming);
}
