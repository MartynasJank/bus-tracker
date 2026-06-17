import Database from 'better-sqlite3';

const db = new Database('./vilnius.db');
db.pragma('journal_mode = WAL');

const tripColumns = db.pragma('table_info(trips)').map(column => column.name);
if (!tripColumns.includes('trip_start_time')) {
  console.log('Migrating: adding trip_start_time...');
  db.exec('ALTER TABLE trips ADD COLUMN trip_start_time TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id)');
  db.exec(`UPDATE trips SET trip_start_time = (
    SELECT MIN(departure_time) FROM stop_times WHERE stop_times.trip_id = trips.trip_id
  )`);
  console.log('Migration done.');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS delay_log (
    id               INTEGER PRIMARY KEY,
    route_short_name TEXT NOT NULL,
    trip_start_sec   INTEGER NOT NULL,
    observed_at      INTEGER NOT NULL,
    delay_sec        INTEGER NOT NULL,
    speed            INTEGER,
    day_of_week      INTEGER,
    hour             INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_dl_route ON delay_log(route_short_name);
  CREATE INDEX IF NOT EXISTS idx_dl_time  ON delay_log(observed_at);
  CREATE INDEX IF NOT EXISTS idx_dl_hour  ON delay_log(hour);
`);

export default db;
