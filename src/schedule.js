import db from './db.js';

const DAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function getServiceIds(dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);

  const dateString = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' })
    .format(date).replace(/-/g, '');
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vilnius', weekday: 'short' })
    .format(date);
  const dayIndex  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);
  const dayColumn = DAY_COLUMNS[dayIndex];

  const baseIds = db.prepare(`
    SELECT service_id FROM calendar
    WHERE ${dayColumn} = 1 AND start_date <= ? AND end_date >= ?
  `).all(dateString, dateString).map(row => row.service_id);

  const exceptions = db.prepare(
    'SELECT service_id, exception_type FROM calendar_dates WHERE date = ?'
  ).all(dateString);

  const removedIds = new Set(
    exceptions.filter(e => e.exception_type === 2).map(e => e.service_id)
  );
  const addedIds = exceptions
    .filter(e => e.exception_type === 1)
    .map(e => e.service_id);

  const result = baseIds.filter(id => !removedIds.has(id));
  for (const id of addedIds) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

export function getActiveServiceIds() {
  return getServiceIds(0);
}
