import db from '../db.js';
import { respond } from '../utils.js';

export function handleRouteColors(req, res) {
  const rows = db.prepare(
    'SELECT DISTINCT route_short_name, route_color, route_text_color FROM routes'
  ).all();

  const colorMap = {};
  for (const row of rows) {
    colorMap[row.route_short_name] = {
      color: row.route_color || null,
      text:  row.route_text_color || null,
    };
  }
  respond(res, 200, colorMap);
}
