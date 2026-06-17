import https from 'https';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';

const GTFS_URL = 'https://www.stops.lt/vilnius/vilnius/gtfs.zip';
const ZIP_PATH = '/tmp/vilnius-gtfs.zip';
const DB_PATH = './vilnius.db';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let downloaded = 0;
      res.on('data', chunk => {
        downloaded += chunk.length;
        process.stdout.write(`\rDownloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(''); resolve(); });
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  // Remove BOM if present
  const firstLine = lines[0].replace(/^﻿/, '');
  const headers = parseCSVLine(firstLine);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function setupSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS stop_times;
    DROP TABLE IF EXISTS trips;
    DROP TABLE IF EXISTS routes;
    DROP TABLE IF EXISTS stops;
    DROP TABLE IF EXISTS calendar;
    DROP TABLE IF EXISTS calendar_dates;

    CREATE TABLE stops (
      stop_id INTEGER PRIMARY KEY,
      stop_name TEXT,
      stop_desc TEXT,
      stop_lat REAL,
      stop_lon REAL
    );

    CREATE TABLE routes (
      route_id TEXT PRIMARY KEY,
      route_short_name TEXT,
      route_color TEXT,
      route_text_color TEXT
    );

    CREATE TABLE trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT,
      service_id TEXT,
      trip_headsign TEXT,
      direction_id INTEGER,
      trip_start_time TEXT,
      shape_id TEXT
    );

    DROP TABLE IF EXISTS shapes;
    CREATE TABLE shapes (
      shape_id TEXT,
      shape_pt_lat REAL,
      shape_pt_lon REAL,
      shape_pt_sequence INTEGER
    );

    CREATE TABLE stop_times (
      trip_id TEXT,
      stop_id INTEGER,
      departure_time TEXT,
      stop_sequence INTEGER
    );

    CREATE TABLE calendar (
      service_id TEXT PRIMARY KEY,
      monday INTEGER, tuesday INTEGER, wednesday INTEGER,
      thursday INTEGER, friday INTEGER, saturday INTEGER, sunday INTEGER,
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE calendar_dates (
      service_id TEXT,
      date TEXT,
      exception_type INTEGER
    );

    CREATE INDEX idx_stop_times_stop ON stop_times(stop_id, departure_time);
    CREATE INDEX idx_stop_times_trip ON stop_times(trip_id);
    CREATE INDEX idx_trips_route ON trips(route_id);
    CREATE INDEX idx_trips_service ON trips(service_id);
    CREATE INDEX idx_trips_direction ON trips(direction_id);
    CREATE INDEX idx_calendar_dates_date ON calendar_dates(date, service_id);
    CREATE INDEX idx_shapes ON shapes(shape_id, shape_pt_sequence);
  `);
}

function insertStops(db, rows) {
  console.log(`Inserting ${rows.length} stops...`);
  const stmt = db.prepare('INSERT OR REPLACE INTO stops VALUES (?,?,?,?,?)');
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(parseInt(r.stop_id), r.stop_name, r.stop_desc, parseFloat(r.stop_lat), parseFloat(r.stop_lon));
    }
  });
  run(rows);
}

function insertRoutes(db, rows) {
  console.log(`Inserting ${rows.length} routes...`);
  const stmt = db.prepare('INSERT OR REPLACE INTO routes VALUES (?,?,?,?)');
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(r.route_id, r.route_short_name, r.route_color, r.route_text_color);
    }
  });
  run(rows);
}

function insertTrips(db, rows) {
  console.log(`Inserting ${rows.length} trips...`);
  const stmt = db.prepare('INSERT OR REPLACE INTO trips VALUES (?,?,?,?,?,NULL,?)');
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(r.trip_id, r.route_id, r.service_id, r.trip_headsign, parseInt(r.direction_id), r.shape_id || null);
    }
  });
  run(rows);
}

function computeTripStartTimes(db) {
  console.log('Computing trip start times...');
  db.exec(`
    UPDATE trips SET trip_start_time = (
      SELECT MIN(departure_time) FROM stop_times WHERE stop_times.trip_id = trips.trip_id
    )
  `);
  console.log('Trip start times done.');
}

function insertShapes(db, text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0].replace(/^﻿/, '').trim());
  const idIdx = headers.indexOf('shape_id');
  const latIdx = headers.indexOf('shape_pt_lat');
  const lonIdx = headers.indexOf('shape_pt_lon');
  const seqIdx = headers.indexOf('shape_pt_sequence');
  console.log(`Inserting shapes (${lines.length} lines)...`);
  const stmt = db.prepare('INSERT INTO shapes VALUES (?,?,?,?)');
  const BATCH = 10000;
  let batch = [], total = 0;
  const flush = db.transaction(items => { for (const item of items) stmt.run(...item); });
  for (let i = 1; i < lines.length; i++) {
    const f = parseCSVLine(lines[i].trim());
    if (f.length < 4) continue;
    batch.push([f[idIdx], parseFloat(f[latIdx]), parseFloat(f[lonIdx]), parseInt(f[seqIdx])]);
    if (batch.length >= BATCH) { flush(batch); total += batch.length; batch = []; process.stdout.write(`\r  ${total}...`); }
  }
  if (batch.length) { flush(batch); total += batch.length; }
  console.log(`\r  ${total} shape points inserted.`);
}

function insertStopTimes(db, text) {
  const lines = text.split('\n');
  const firstLine = lines[0].replace(/^﻿/, '').trim();
  const headers = parseCSVLine(firstLine);
  const tripIdx = headers.indexOf('trip_id');
  const stopIdx = headers.indexOf('stop_id');
  const depIdx = headers.indexOf('departure_time');
  const seqIdx = headers.indexOf('stop_sequence');

  console.log(`Inserting stop_times (${lines.length} lines)...`);
  const stmt = db.prepare('INSERT INTO stop_times VALUES (?,?,?,?)');
  const BATCH = 10000;
  let batch = [];
  let total = 0;

  const flush = db.transaction(items => {
    for (const item of items) stmt.run(...item);
  });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const v = parseCSVLine(line);
    if (v.length < 4) continue;
    batch.push([v[tripIdx], parseInt(v[stopIdx]), v[depIdx], parseInt(v[seqIdx])]);
    if (batch.length >= BATCH) {
      flush(batch);
      total += batch.length;
      batch = [];
      process.stdout.write(`\r  ${total} rows...`);
    }
  }
  if (batch.length) { flush(batch); total += batch.length; }
  console.log(`\r  ${total} rows inserted.`);
}

function insertCalendar(db, rows) {
  console.log(`Inserting ${rows.length} calendar entries...`);
  const stmt = db.prepare('INSERT OR REPLACE INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?)');
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(r.service_id,
        parseInt(r.monday), parseInt(r.tuesday), parseInt(r.wednesday),
        parseInt(r.thursday), parseInt(r.friday), parseInt(r.saturday), parseInt(r.sunday),
        r.start_date, r.end_date);
    }
  });
  run(rows);
}

function insertCalendarDates(db, rows) {
  console.log(`Inserting ${rows.length} calendar_dates...`);
  const stmt = db.prepare('INSERT INTO calendar_dates VALUES (?,?,?)');
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(r.service_id, r.date, parseInt(r.exception_type));
    }
  });
  run(rows);
}

async function main() {
  console.log('Downloading GTFS from stops.lt...');
  await download(GTFS_URL, ZIP_PATH);

  console.log('Extracting zip...');
  const zip = new AdmZip(ZIP_PATH);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  setupSchema(db);

  const getFile = name => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`${name} not found in zip`);
    return entry.getData().toString('utf8');
  };

  insertShapes(db, getFile('shapes.txt'));
  insertStops(db, parseCSV(getFile('stops.txt')));
  insertRoutes(db, parseCSV(getFile('routes.txt')));
  insertTrips(db, parseCSV(getFile('trips.txt')));
  insertCalendar(db, parseCSV(getFile('calendar.txt')));
  insertCalendarDates(db, parseCSV(getFile('calendar_dates.txt')));
  insertStopTimes(db, getFile('stop_times.txt'));
  computeTripStartTimes(db);

  db.close();
  fs.unlinkSync(ZIP_PATH);
  console.log(`Done! Database saved to ${DB_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
