import db from '../db.js';
import { haversine, respond, vilniusSecondsSinceMidnight, gtfsTimeToSeconds } from '../utils.js';
import { getActiveServiceIds, getServiceIds } from '../schedule.js';

export function stopsNear(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  return db.prepare(`
    SELECT stop_id, stop_name, stop_lat, stop_lon
    FROM stops
    WHERE stop_lat BETWEEN ? AND ?
      AND stop_lon BETWEEN ? AND ?
  `).all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta)
    .map(stop => ({ ...stop, dist: haversine(lat, lon, stop.stop_lat, stop.stop_lon) }))
    .filter(stop => stop.dist <= radiusMeters)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);
}

export function handleNearbyStops(req, res, params) {
  const lat = parseFloat(params.get('lat'));
  const lng = parseFloat(params.get('lng'));
  if (isNaN(lat) || isNaN(lng)) return respond(res, 400, { error: 'Invalid coordinates' });

  const stops = db.prepare(
    'SELECT stop_id, stop_name, stop_desc, stop_lat, stop_lon FROM stops'
  ).all();

  const groups = {};
  for (const stop of stops) {
    const distance = Math.round(haversine(lat, lng, stop.stop_lat, stop.stop_lon));
    if (!groups[stop.stop_name]) {
      groups[stop.stop_name] = { stop_name: stop.stop_name, distance_m: distance, stops: [] };
    }
    groups[stop.stop_name].stops.push({
      stop_id:  stop.stop_id,
      stop_desc: stop.stop_desc,
      stop_lat:  stop.stop_lat,
      stop_lon:  stop.stop_lon,
      distance_m: distance,
    });
    if (distance < groups[stop.stop_name].distance_m) {
      groups[stop.stop_name].distance_m = distance;
    }
  }

  const result = Object.values(groups);
  result.sort((a, b) => a.distance_m - b.distance_m);
  respond(res, 200, result.slice(0, 20));
}

export function handleAllStops(req, res) {
  const stops = db.prepare(
    'SELECT stop_id, stop_name, stop_desc, stop_lat, stop_lon FROM stops ORDER BY stop_name'
  ).all();
  const groups = {};
  for (const stop of stops) {
    if (!groups[stop.stop_name]) {
      groups[stop.stop_name] = { stop_name: stop.stop_name, stops: [] };
    }
    groups[stop.stop_name].stops.push({
      stop_id:   stop.stop_id,
      stop_desc: stop.stop_desc,
      stop_lat:  stop.stop_lat,
      stop_lon:  stop.stop_lon,
    });
  }
  respond(res, 200, Object.values(groups));
}

export function handleDestinationSearch(req, res, params) {
  const query  = (params.get('q') || '').trim();
  if (query.length < 2) return respond(res, 200, []);

  const lat      = parseFloat(params.get('lat'));
  const lng      = parseFloat(params.get('lng'));
  const hasCoords = !isNaN(lat) && !isNaN(lng);

  const serviceIds = getActiveServiceIds();
  if (!serviceIds.length) return respond(res, 200, []);
  const servicePlaceholders = serviceIds.map(() => '?').join(',');

  const destStops = db.prepare(
    "SELECT DISTINCT stop_id, stop_name FROM stops WHERE lower(stop_name) LIKE lower(?)"
  ).all(`%${query}%`);
  const destStopIds = destStops.map(stop => stop.stop_id);
  const destName    = destStops.length ? destStops[0].stop_name : null;

  let rows;
  if (destStopIds.length) {
    const destPlaceholders = destStopIds.map(() => '?').join(',');
    rows = db.prepare(`
      WITH dest_seq(trip_id, dest_seq) AS (
        SELECT st.trip_id, MIN(st.stop_sequence)
        FROM stop_times st
        JOIN trips t ON st.trip_id = t.trip_id
        WHERE st.stop_id IN (${destPlaceholders}) AND t.service_id IN (${servicePlaceholders})
        GROUP BY st.trip_id
      )
      SELECT DISTINCT
        st.stop_id, s.stop_name, s.stop_desc, s.stop_lat, s.stop_lon,
        t.direction_id, t.trip_headsign,
        r.route_short_name, r.route_color, r.route_text_color
      FROM dest_seq ds
      JOIN stop_times st ON st.trip_id = ds.trip_id AND st.stop_sequence < ds.dest_seq
      JOIN trips t ON t.trip_id = ds.trip_id AND t.service_id IN (${servicePlaceholders})
      JOIN stops s ON st.stop_id = s.stop_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE st.stop_id NOT IN (${destPlaceholders})
      ORDER BY s.stop_name
      LIMIT 800
    `).all(...destStopIds, ...serviceIds, ...serviceIds, ...destStopIds);
  } else {
    rows = db.prepare(`
      SELECT DISTINCT
        st.stop_id, s.stop_name, s.stop_desc, s.stop_lat, s.stop_lon,
        t.direction_id, t.trip_headsign,
        r.route_short_name, r.route_color, r.route_text_color
      FROM trips t
      JOIN stop_times st ON st.trip_id = t.trip_id
      JOIN stops s ON st.stop_id = s.stop_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE lower(t.trip_headsign) LIKE lower(?) AND t.service_id IN (${servicePlaceholders})
      ORDER BY s.stop_name
      LIMIT 800
    `).all(`%${query}%`, ...serviceIds);
  }

  const grouped = {};
  for (const row of rows) {
    const distance = hasCoords ? Math.round(haversine(lat, lng, row.stop_lat, row.stop_lon)) : null;
    const key = `${row.stop_name}::${row.direction_id}`;
    if (!grouped[key]) {
      grouped[key] = {
        stop_id:          row.stop_id,
        stop_name:        row.stop_name,
        stop_desc:        row.stop_desc,
        stop_lat:         row.stop_lat,
        stop_lon:         row.stop_lon,
        direction_id:     row.direction_id,
        headsign:         row.trip_headsign,
        destination_name: destName || row.trip_headsign,
        routes:           [],
        distance_m:       distance,
      };
    } else if (distance != null && distance < grouped[key].distance_m) {
      grouped[key].stop_id    = row.stop_id;
      grouped[key].distance_m = distance;
    }
    const entry = grouped[key];
    if (!entry.routes.find(route => route.route_short_name === row.route_short_name)) {
      entry.routes.push({
        route_short_name: row.route_short_name,
        route_color:      row.route_color,
        route_text_color: row.route_text_color,
      });
    }
  }

  let results = Object.values(grouped);
  if (hasCoords) {
    results = results.filter(result => result.distance_m != null && result.distance_m <= 2000);
    results.sort((a, b) => a.distance_m - b.distance_m);
  }
  respond(res, 200, results.slice(0, 40));
}

export function handleDirections(req, res, stopId, params) {
  const viaQuery   = ((params && params.get('via')) || '').trim();
  const serviceIds = getActiveServiceIds();
  if (!serviceIds.length) return respond(res, 200, []);

  const servicePlaceholders = serviceIds.map(() => '?').join(',');
  let rows;

  if (viaQuery) {
    rows = db.prepare(`
      SELECT DISTINCT t.direction_id, t.trip_headsign, r.route_short_name, r.route_color, r.route_text_color
      FROM stop_times st
      JOIN trips t ON st.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE st.stop_id = ? AND t.service_id IN (${servicePlaceholders})
        AND EXISTS (
          SELECT 1 FROM stop_times st2
          JOIN stops s2 ON st2.stop_id = s2.stop_id
          WHERE st2.trip_id = st.trip_id
            AND lower(s2.stop_name) LIKE lower(?)
            AND st2.stop_sequence > st.stop_sequence
        )
      ORDER BY t.direction_id, r.route_short_name
    `).all(stopId, ...serviceIds, `%${viaQuery}%`);
  } else {
    rows = db.prepare(`
      SELECT DISTINCT t.direction_id, t.trip_headsign, r.route_short_name, r.route_color, r.route_text_color
      FROM stop_times st
      JOIN trips t ON st.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE st.stop_id = ? AND t.service_id IN (${servicePlaceholders})
      ORDER BY t.direction_id, r.route_short_name
    `).all(stopId, ...serviceIds);
  }

  const directions = {};
  for (const row of rows) {
    const key = `${row.direction_id}::${row.trip_headsign}`;
    if (!directions[key]) {
      directions[key] = { direction_id: row.direction_id, headsign: row.trip_headsign, routes: [] };
    }
    directions[key].routes.push({
      route_short_name: row.route_short_name,
      route_color:      row.route_color,
      route_text_color: row.route_text_color,
    });
  }
  respond(res, 200, Object.values(directions));
}

function calcSegmentDistance(tripId, boardingStopId, destStopName) {
  const stops = db.prepare(`
    SELECT s.stop_lat, s.stop_lon
    FROM stop_times st
    JOIN stops s ON st.stop_id = s.stop_id
    WHERE st.trip_id = ?
      AND st.stop_sequence BETWEEN
        (SELECT stop_sequence FROM stop_times WHERE trip_id = ? AND stop_id = ? LIMIT 1)
        AND
        (SELECT MIN(st2.stop_sequence) FROM stop_times st2
         JOIN stops s2 ON st2.stop_id = s2.stop_id
         WHERE st2.trip_id = ? AND lower(s2.stop_name) = lower(?))
    ORDER BY st.stop_sequence
  `).all(tripId, tripId, boardingStopId, tripId, destStopName);

  let totalDistance = 0;
  for (let i = 1; i < stops.length; i++) {
    totalDistance += haversine(
      stops[i - 1].stop_lat, stops[i - 1].stop_lon,
      stops[i].stop_lat,     stops[i].stop_lon
    );
  }
  return Math.round(totalDistance);
}

export function handleArrivals(req, res, stopIdParam, params) {
  const stopIds     = String(stopIdParam).split(',').map(Number).filter(n => !isNaN(n));
  const dirParam    = params.get('directionId') ?? '0';
  const directionIds = dirParam.split(',').map(Number).filter(n => !isNaN(n));
  const destName    = (params.get('dest') || '').trim();
  const nowSec      = vilniusSecondsSinceMidnight();

  function queryArrivals(serviceIds, countdownOffset = 0) {
    if (!serviceIds.length) return [];
    const servicePlaceholders   = serviceIds.map(() => '?').join(',');
    const directionPlaceholders = directionIds.map(() => '?').join(',');
    const stopPlaceholders      = stopIds.map(() => '?').join(',');

    const destColumns = destName
      ? `(SELECT st2.departure_time FROM stop_times st2
           JOIN stops s2 ON st2.stop_id = s2.stop_id
           WHERE st2.trip_id = st.trip_id AND lower(s2.stop_name) = lower(?)
             AND st2.stop_sequence > st.stop_sequence
           ORDER BY st2.stop_sequence LIMIT 1) AS dest_time,
         (SELECT s2.stop_desc FROM stop_times st2
           JOIN stops s2 ON st2.stop_id = s2.stop_id
           WHERE st2.trip_id = st.trip_id AND lower(s2.stop_name) = lower(?)
             AND st2.stop_sequence > st.stop_sequence
           ORDER BY st2.stop_sequence LIMIT 1) AS dest_desc`
      : `NULL AS dest_time, NULL AS dest_desc`;

    const queryParams = destName
      ? [destName, destName, ...stopIds, ...directionIds, ...serviceIds]
      : [...stopIds, ...directionIds, ...serviceIds];

    const rows = db.prepare(`
      SELECT st.departure_time, ${destColumns},
             t.trip_id, t.trip_start_time, t.trip_headsign,
             r.route_short_name, r.route_color, r.route_text_color
      FROM stop_times st
      JOIN trips t ON st.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE st.stop_id IN (${stopPlaceholders})
        AND t.direction_id IN (${directionPlaceholders})
        AND t.service_id IN (${servicePlaceholders})
      ORDER BY st.departure_time
    `).all(...queryParams);

    const results = [];
    for (const row of rows) {
      const departureSec  = gtfsTimeToSeconds(row.departure_time);
      const countdownSecs = departureSec + countdownOffset - nowSec;
      if (countdownSecs < -60) continue;
      results.push({
        route_short_name: row.route_short_name,
        route_color:      row.route_color,
        route_text_color: row.route_text_color,
        headsign:         row.trip_headsign,
        trip_id:          row.trip_id,
        trip_start_time:  row.trip_start_time,
        departure_time:   row.departure_time,
        dest_time:        row.dest_time || null,
        dest_desc:        row.dest_desc || null,
        countdown_seconds: Math.max(0, countdownSecs),
      });
    }
    return results;
  }

  let arrivals = queryArrivals(getServiceIds(0));
  arrivals.sort((a, b) => a.countdown_seconds - b.countdown_seconds);

  if (!arrivals.length) {
    arrivals = queryArrivals(getServiceIds(1), 86400)
      .filter(arrival => arrival.countdown_seconds <= 12 * 3600);
    arrivals.sort((a, b) => a.countdown_seconds - b.countdown_seconds);
  }

  if (destName && arrivals.length) {
    const sampleWithDest = arrivals.find(arrival => arrival.dest_time);
    if (sampleWithDest) {
      const boardingStopId = stopIds.length === 1
        ? stopIds[0]
        : db.prepare(
            `SELECT stop_id FROM stop_times WHERE trip_id = ? AND stop_id IN (${stopIds.map(() => '?').join(',')}) LIMIT 1`
          ).get(sampleWithDest.trip_id, ...stopIds)?.stop_id ?? stopIds[0];

      const segmentDistanceM = calcSegmentDistance(sampleWithDest.trip_id, boardingStopId, destName);
      if (segmentDistanceM) {
        arrivals.forEach(arrival => { arrival.dist_m = segmentDistanceM; });
      }
    }
  }

  respond(res, 200, arrivals.slice(0, 30));
}
