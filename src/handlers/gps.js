import https from 'https';
import gpsCache from '../gps-cache.js';
import { respond } from '../utils.js';

const GPS_SOURCE_URL = 'https://www.stops.lt/vilnius/gps_full.txt';
const CACHE_MAX_AGE_MS = 2000;

export function handleGps(req, res) {
  if (gpsCache.data && Date.now() - gpsCache.ts < CACHE_MAX_AGE_MS) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    return res.end(gpsCache.data);
  }

  https.get(GPS_SOURCE_URL, gpsRes => {
    let rawData = '';
    gpsRes.on('data', chunk => { rawData += chunk; });
    gpsRes.on('end', () => {
      gpsCache.data = rawData;
      gpsCache.ts   = Date.now();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      res.end(rawData);
    });
  }).on('error', () => respond(res, 502, { error: 'GPS fetch failed' }));
}
