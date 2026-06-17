import db from '../db.js';
import { respond } from '../utils.js';

export function handleStats(req, res, params) {
  const days  = Math.min(30, Math.max(1, parseInt(params.get('days') || '7')));
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      ROUND(AVG(CASE WHEN delay_sec > 60 THEN delay_sec END)) AS avg_late_sec,
      ROUND(AVG(CASE WHEN delay_sec < -60 THEN delay_sec END)) AS avg_early_sec,
      ROUND(SUM(CASE WHEN delay_sec > 60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS late_pct,
      ROUND(SUM(CASE WHEN delay_sec < -60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS early_pct,
      ROUND(SUM(CASE WHEN delay_sec BETWEEN -60 AND 60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS punctual_pct,
      MIN(observed_at) AS first_obs
    FROM delay_log
    WHERE observed_at > ?
  `).get(since);

  const routeBase = `
    SELECT
      route_short_name,
      COUNT(*) AS count,
      ROUND(AVG(delay_sec)) AS avg_delay,
      ROUND(SUM(CASE WHEN delay_sec > 60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS late_pct,
      ROUND(SUM(CASE WHEN delay_sec < -60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS early_pct
    FROM delay_log
    WHERE observed_at > ?
    GROUP BY route_short_name
  `;
  const byRouteLate      = db.prepare(routeBase + ' HAVING count >= 20 AND avg_delay > 60 ORDER BY avg_delay DESC').all(since);
  const byRouteEarly     = db.prepare(routeBase + ' HAVING count >= 20 AND avg_delay < -60 ORDER BY avg_delay ASC').all(since);
  const byRoutePunctual  = db.prepare(routeBase + ' HAVING count >= 20 AND ABS(avg_delay) <= 60 ORDER BY ABS(avg_delay) ASC').all(since);

  const byHour = db.prepare(`
    SELECT hour, ROUND(AVG(delay_sec)) AS avg_delay, COUNT(*) AS count
    FROM delay_log
    WHERE observed_at > ?
    GROUP BY hour
    ORDER BY hour
  `).all(since);

  const byDow = db.prepare(`
    SELECT day_of_week, ROUND(AVG(delay_sec)) AS avg_delay, COUNT(*) AS count
    FROM delay_log
    WHERE observed_at > ?
    GROUP BY day_of_week
    ORDER BY day_of_week
  `).all(since);

  respond(res, 200, {
    summary,
    by_route_late: byRouteLate,
    by_route_early: byRouteEarly,
    by_route_punctual: byRoutePunctual,
    by_hour: byHour,
    by_dow: byDow,
  });
}
