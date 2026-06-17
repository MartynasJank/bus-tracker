import db from '../db.js';
import { respond } from '../utils.js';

export function handleTripShape(req, res, tripId) {
  const trip = db.prepare('SELECT shape_id FROM trips WHERE trip_id = ?').get(tripId);

  if (trip?.shape_id) {
    const points = db.prepare(`
      SELECT shape_pt_lat AS lat, shape_pt_lon AS lon
      FROM shapes
      WHERE shape_id = ?
      ORDER BY shape_pt_sequence
    `).all(trip.shape_id);
    return respond(res, 200, points);
  }

  // Fall back to stop coordinates when no shape is available
  const points = db.prepare(`
    SELECT s.stop_lat AS lat, s.stop_lon AS lon
    FROM stop_times st
    JOIN stops s ON st.stop_id = s.stop_id
    WHERE st.trip_id = ?
    ORDER BY st.stop_sequence
  `).all(tripId);
  respond(res, 200, points);
}

export function handleTripStops(req, res, tripId) {
  const stops = db.prepare(`
    SELECT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, st.departure_time
    FROM stop_times st
    JOIN stops s ON st.stop_id = s.stop_id
    WHERE st.trip_id = ?
    ORDER BY st.stop_sequence
  `).all(tripId);
  respond(res, 200, stops);
}
