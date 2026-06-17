import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { respond } from './src/utils.js';
import { handleNearbyStops, handleAllStops, handleDestinationSearch, handleDirections, handleArrivals } from './src/handlers/stops.js';
import { handlePlan } from './src/handlers/plan.js';
import { handleGps } from './src/handlers/gps.js';
import { handleTripShape, handleTripStops } from './src/handlers/trips.js';
import { handleRouteColors } from './src/handlers/routes.js';
import { handleStats } from './src/handlers/stats.js';
import { startCollector } from './src/collector.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

startCollector();

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
};

function serveStatic(req, res, urlPath) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return respond(res, 403, 'Forbidden');

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
          if (err2) return respond(res, 404, 'Not found');
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-cache');
          res.writeHead(200);
          res.end(html);
        });
      }
      return respond(res, 404, 'Not found');
    }
    const extension = path.extname(filePath);
    res.setHeader('Content-Type', MIME_TYPES[extension] || 'application/octet-stream');
    if (extension === '.js' || extension === '.css') {
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.writeHead(200);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url      = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/stops/nearby')       return handleNearbyStops(req, res, url.searchParams);
  if (pathname === '/api/stops/all')          return handleAllStops(req, res);
  if (pathname === '/api/stops/destinations') return handleDestinationSearch(req, res, url.searchParams);
  if (pathname === '/api/gps')                return handleGps(req, res);
  if (pathname === '/api/routes/colors')      return handleRouteColors(req, res);
  if (pathname === '/api/stats')              return handleStats(req, res, url.searchParams);
  if (pathname === '/api/plan')               return handlePlan(req, res, url.searchParams).catch(error => respond(res, 500, { error: error.message }));

  const directionsMatch = pathname.match(/^\/api\/stops\/(\d+)\/directions$/);
  if (directionsMatch) return handleDirections(req, res, parseInt(directionsMatch[1]), url.searchParams);

  const arrivalsMatch = pathname.match(/^\/api\/stops\/([\d,]+)\/arrivals$/);
  if (arrivalsMatch) return handleArrivals(req, res, arrivalsMatch[1], url.searchParams);

  const shapeMatch = pathname.match(/^\/api\/trips\/([^/]+)\/shape$/);
  if (shapeMatch) return handleTripShape(req, res, decodeURIComponent(shapeMatch[1]));

  const stopsMatch = pathname.match(/^\/api\/trips\/([^/]+)\/stops$/);
  if (stopsMatch) return handleTripStops(req, res, decodeURIComponent(stopsMatch[1]));

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => console.log(`Bus app running at http://localhost:${PORT}`));
