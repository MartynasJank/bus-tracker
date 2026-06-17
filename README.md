# bus-tracker

Vilnius bus arrivals, live GPS tracking, journey planner and delay stats.

## Features

- Nearby stops with real-time arrival countdowns
- Live GPS bus positions on a map
- Journey planner from your location to any destination
- Delay statistics by route, hour and day of week

## Tech stack

- Node.js with no framework, plain HTTP server
- SQLite via better-sqlite3 for GTFS schedule data
- Live GPS feed from stops.lt, polled every 30 seconds
- Vanilla ES modules on the client, no build step
- Leaflet for maps

## Setup

**Requirements:** Node.js 18+, a populated `vilnius.db` SQLite database from a GTFS import.

```bash
npm install
node server.js
```

The app runs on port 3000 by default.

## Project structure

```
server.js          Entry point, HTTP routing
src/
  db.js            Database connection and schema setup
  collector.js     Background GPS poller and delay logger
  schedule.js      GTFS service calendar helpers
  utils.js         Shared server utilities
  handlers/        One file per API route group
public/
  index.html
  style.css
  sw.js            Service worker
  js/              Client ES modules
    main.js        Entry point, event wiring
    state.js       Shared app state
    arrivals.js    Arrivals list and GPS enrichment
    stops.js       Stop and direction search
    plan.js        Journey planner
    map-journey.js Bus tracking map
    map-live.js    Live all-buses map
    stats.js       Delay dashboard
    tracking.js    User geolocation
    utils.js       Client utilities and icon builders
```

## API

| Method | Path | Description |
|---|---|---|
| GET | /api/stops/nearby | Stops near a lat/lng |
| GET | /api/stops/all | All stop groups |
| GET | /api/stops/destinations | Destination search |
| GET | /api/stops/:id/directions | Directions from a stop |
| GET | /api/stops/:id/arrivals | Upcoming arrivals |
| GET | /api/gps | Raw GPS feed text |
| GET | /api/plan | Journey planner |
| GET | /api/trips/:id/shape | Trip polyline |
| GET | /api/trips/:id/stops | Trip stop sequence |
| GET | /api/routes/colors | Route color map |
| GET | /api/stats | Delay statistics |

## Linting

```bash
npx eslint server.js src/ public/js/
```
