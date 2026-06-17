import { $, escapeHtml } from './utils.js';
import { state } from './state.js';
import { showScreen } from './navigation.js';

const DAY_OF_WEEK_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PREVIEW_COUNT = 5;

function delayColor(delaySeconds) {
  if (delaySeconds == null || Math.abs(delaySeconds) <= 30) return 'var(--green)';
  if (Math.abs(delaySeconds) <= 120) return 'var(--amber)';
  return 'var(--red)';
}

function formatDelay(delaySeconds) {
  if (delaySeconds == null) return '—';
  const rounded = Math.round(delaySeconds);
  if (rounded === 0) return '0s';
  const abs = Math.abs(rounded);
  const sign = rounded < 0 ? '−' : '+';
  const m = Math.floor(abs / 60), s = abs % 60;
  return m ? `${sign}${m}m ${s}s` : `${sign}${s}s`;
}

function formatCollectionDate(unixSeconds) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function barChartRowHtml(value, maxValue, label, sublabel) {
  const percentage = maxValue > 0 ? Math.min(100, Math.round((Math.abs(value) / maxValue) * 100)) : 0;
  const color = delayColor(value);
  return `
    <div class="stat-bar-row">
      <div class="stat-bar-label">${escapeHtml(label)}</div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill" style="width:${percentage}%;background:${color}"></div>
      </div>
      <div class="stat-bar-value" style="color:${color}">${escapeHtml(sublabel)}</div>
    </div>`;
}

function routeBarRowHtml(route, maxDelay, sublabel) {
  const routeInfo = state.routeColors[route.route_short_name];
  const bg = routeInfo?.color ? `#${routeInfo.color}` : '#444';
  const fg = routeInfo?.text ? `#${routeInfo.text}` : '#fff';
  const fillPct = maxDelay > 0
    ? Math.min(100, Math.round(Math.abs(route.avg_delay) / maxDelay * 100)) : 0;
  return `
    <div class="stat-bar-row">
      <div class="stat-bar-label stat-bar-label-route">
        <span class="stat-route-chip" style="background:${bg};color:${fg}">${escapeHtml(route.route_short_name)}</span>
      </div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill" style="width:${fillPct}%;background:${delayColor(route.avg_delay)}"></div>
      </div>
      <div class="stat-bar-value stat-bar-value-route" style="color:${delayColor(route.avg_delay)}">
        <span>${formatDelay(route.avg_delay)}</span>
        ${sublabel ? `<span class="stat-bar-late">${escapeHtml(sublabel)}</span>` : ''}
      </div>
    </div>`;
}

function routeSublabel(seeAllKey, route) {
  if (seeAllKey === 'late') return `${route.late_pct}% late`;
  if (seeAllKey === 'early') return `${route.early_pct}% early`;
  return null;
}

function routeSectionHtml(title, routes, seeAllKey) {
  if (!routes.length) return '';
  const preview = routes.slice(0, PREVIEW_COUNT);
  const maxDelay = Math.max(...routes.map(r => Math.abs(r.avg_delay)));
  let html = `<div class="stat-section"><div class="stat-section-title">${escapeHtml(title)}</div>`;
  html += preview.map(r => routeBarRowHtml(r, maxDelay, routeSublabel(seeAllKey, r))).join('');
  if (routes.length > PREVIEW_COUNT) {
    html += `<button class="stat-see-all" data-key="${seeAllKey}">See all ${routes.length} routes</button>`;
  }
  html += `</div>`;
  return html;
}

function renderFullRouteList(list, title, routes, activeDays, seeAllKey) {
  state.statsFullList = true;
  const maxDelay = Math.max(...routes.map(r => Math.abs(r.avg_delay)));
  let html = `
    <button class="stat-back-btn">← Back to stats</button>
    <div class="stat-section">
      <div class="stat-section-title">${escapeHtml(title)}</div>
      ${routes.map(r => routeBarRowHtml(r, maxDelay, routeSublabel(seeAllKey, r))).join('')}
    </div>`;
  list.innerHTML = html;
  list.querySelector('.stat-back-btn').addEventListener('click', () => openStats(activeDays));
}

function renderStats(data, activeDays) {
  const list = $('stats-list');
  const { summary, by_route_late, by_route_early, by_route_punctual, by_hour, by_dow, no_gps } = data;

  let html = `
    <div class="stat-range-row">
      ${[1, 7, 30].map(days =>
        `<button class="stat-range-chip${days === activeDays ? ' active' : ''}" data-days="${days}">${days === 1 ? '1d' : days === 7 ? '7d' : '30d'}</button>`
      ).join('')}
    </div>`;

  html += `<div class="stat-cards">
    <div class="stat-card">
      <div class="stat-card-value" style="color:${delayColor(summary.avg_late_sec)}">${formatDelay(summary.avg_late_sec)}</div>
      <div class="stat-card-label">avg late</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${delayColor(summary.avg_early_sec)}">${formatDelay(summary.avg_early_sec)}</div>
      <div class="stat-card-label">avg early</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${(summary.late_pct ?? 0) > 30 ? 'var(--red)' : (summary.late_pct ?? 0) > 15 ? 'var(--amber)' : 'var(--green)'}">${summary.late_pct ?? 0}%</div>
      <div class="stat-card-label">late &gt;1 min</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${(summary.early_pct ?? 0) > 10 ? 'var(--red)' : (summary.early_pct ?? 0) > 3 ? 'var(--amber)' : 'var(--green)'}">${summary.early_pct ?? 0}%</div>
      <div class="stat-card-label">early &gt;1 min</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${(summary.punctual_pct ?? 0) >= 60 ? 'var(--green)' : (summary.punctual_pct ?? 0) >= 40 ? 'var(--amber)' : 'var(--red)'}">${summary.punctual_pct ?? 0}%</div>
      <div class="stat-card-label">punctual ±1 min</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${summary.total?.toLocaleString() ?? '0'}</div>
      <div class="stat-card-label">observations</div>
    </div>
  </div>`;

  html += `<div class="stat-threshold-note"><span>Late &gt;1m · Punctual ±1m · Early &gt;1m</span></div>`;

  if (!summary.total) {
    html += `<p class="empty">No data yet — check back after a few minutes.</p>`;
    list.innerHTML = html;
    list.querySelectorAll('.stat-range-chip').forEach(button =>
      button.addEventListener('click', () => openStats(parseInt(button.dataset.days)))
    );
    return;
  }

  html += routeSectionHtml('Most Late', by_route_late, 'late');
  html += routeSectionHtml('Most Early', by_route_early, 'early');
  html += routeSectionHtml('Most Punctual', by_route_punctual, 'punctual');

  if (by_dow.length) {
    const maxDowDelay = Math.max(...by_dow.map(d => Math.abs(d.avg_delay)));
    html += `<div class="stat-section"><div class="stat-section-title">By Day</div>`;
    for (const day of by_dow) {
      html += barChartRowHtml(day.avg_delay, maxDowDelay || 1, DAY_OF_WEEK_LABELS[day.day_of_week] ?? day.day_of_week, formatDelay(day.avg_delay));
    }
    html += `</div>`;
  }

  if (no_gps?.length) {
    html += `<div class="stat-section"><div class="stat-section-title">No GPS Signal (${no_gps.length})</div>`;
    html += `<div class="stat-no-gps-grid">`;
    for (const r of no_gps) {
      const bg = r.route_color ? `#${r.route_color}` : '#444';
      const fg = r.route_text_color ? `#${r.route_text_color}` : '#fff';
      html += `<span class="stat-route-chip" style="background:${bg};color:${fg};opacity:0.5">${escapeHtml(r.route_short_name)}</span>`;
    }
    html += `</div></div>`;
  }

  if (by_hour.length) {
    const maxHourDelay = Math.max(...by_hour.map(h => Math.abs(h.avg_delay)));
    html += `<div class="stat-section"><div class="stat-section-title">By Hour</div>`;
    for (let hour = 0; hour < 24; hour++) {
      const row = by_hour.find(h => h.hour === hour);
      if (!row) continue;
      html += barChartRowHtml(row.avg_delay, maxHourDelay || 1, `${String(hour).padStart(2, '0')}:00`, formatDelay(row.avg_delay));
    }
    html += `</div>`;
  }

  list.innerHTML = html;

  list.querySelectorAll('.stat-range-chip').forEach(button =>
    button.addEventListener('click', () => openStats(parseInt(button.dataset.days)))
  );

  list.querySelectorAll('.stat-see-all').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      const routes = key === 'late' ? by_route_late : key === 'early' ? by_route_early : by_route_punctual;
      const title = key === 'late' ? 'Most Late' : key === 'early' ? 'Most Early' : 'Most Punctual';
      renderFullRouteList(list, title, routes, activeDays, key);
    });
  });
}

export async function openStats(days = 7) {
  state.prevScreen = state.screen;
  state.statsFullList = false;
  state.statsActiveDays = days;
  showScreen('stats', 'Delay Stats');
  history.replaceState(null, '', '/stats');
  $('stats-list').innerHTML = '<p class="empty">Loading…</p>';
  try {
    const data = await fetch(`/api/stats?days=${days}`).then(response => response.json());
    renderStats(data, days);
  } catch (err) {
    $('stats-list').innerHTML = `<p class="empty">Error: ${err?.message || err}</p>`;
  }
}
