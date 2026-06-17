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
  if (delaySeconds <= 0) return `${Math.abs(Math.round(delaySeconds))}s early`;
  const minutes = Math.floor(delaySeconds / 60);
  const seconds = delaySeconds % 60;
  return minutes ? `+${minutes}m ${seconds}s` : `+${seconds}s`;
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

function routeBarRowHtml(route, maxDelay) {
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
        <span class="stat-bar-late">${route.late_pct}% late · ${route.early_pct}% early</span>
      </div>
    </div>`;
}

function routeSectionHtml(title, routes, seeAllKey) {
  if (!routes.length) return '';
  const preview = routes.slice(0, PREVIEW_COUNT);
  const maxDelay = Math.max(...routes.map(r => Math.abs(r.avg_delay)));
  let html = `<div class="stat-section"><div class="stat-section-title">${escapeHtml(title)}</div>`;
  html += preview.map(r => routeBarRowHtml(r, maxDelay)).join('');
  if (routes.length > PREVIEW_COUNT) {
    html += `<button class="stat-see-all" data-key="${seeAllKey}">See all ${routes.length} routes</button>`;
  }
  html += `</div>`;
  return html;
}

function renderFullRouteList(list, title, routes, activeDays) {
  const maxDelay = Math.max(...routes.map(r => Math.abs(r.avg_delay)));
  let html = `
    <button class="stat-back-btn">← Back to stats</button>
    <div class="stat-section">
      <div class="stat-section-title">${escapeHtml(title)}</div>
      ${routes.map(r => routeBarRowHtml(r, maxDelay)).join('')}
    </div>`;
  list.innerHTML = html;
  list.querySelector('.stat-back-btn').addEventListener('click', () => openStats(activeDays));
}

function renderStats(data, activeDays) {
  const list = $('stats-list');
  const { summary, by_route_late, by_route_early, by_route_punctual, by_hour, by_dow } = data;

  let html = `
    <div class="stat-range-row">
      ${[1, 7, 30].map(days =>
        `<button class="stat-range-chip${days === activeDays ? ' active' : ''}" data-days="${days}">${days === 1 ? '1d' : days === 7 ? '7d' : '30d'}</button>`
      ).join('')}
    </div>`;

  html += `<div class="stat-cards">
    <div class="stat-card">
      <div class="stat-card-value">${summary.total?.toLocaleString() ?? '0'}</div>
      <div class="stat-card-label">observations</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${delayColor(summary.avg_delay)}">${formatDelay(summary.avg_delay)}</div>
      <div class="stat-card-label">avg delay</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${summary.late_pct > 30 ? 'var(--red)' : summary.late_pct > 15 ? 'var(--amber)' : 'var(--green)'}">${summary.late_pct ?? 0}%</div>
      <div class="stat-card-label">running late</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value" style="color:${(summary.early_pct ?? 0) > 10 ? 'var(--red)' : (summary.early_pct ?? 0) > 3 ? 'var(--amber)' : 'var(--green)'}">${summary.early_pct ?? 0}%</div>
      <div class="stat-card-label">running early</div>
    </div>
  </div>`;

  if (!summary.total) {
    html += `<p class="empty">No data yet — check back after a few minutes.</p>`;
    list.innerHTML = html;
    list.querySelectorAll('.stat-range-chip').forEach(button =>
      button.addEventListener('click', () => openStats(parseInt(button.dataset.days)))
    );
    return;
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

  list.innerHTML = html;

  list.querySelectorAll('.stat-range-chip').forEach(button =>
    button.addEventListener('click', () => openStats(parseInt(button.dataset.days)))
  );

  list.querySelectorAll('.stat-see-all').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      const routes = key === 'late' ? by_route_late : key === 'early' ? by_route_early : by_route_punctual;
      const title = key === 'late' ? 'Most Late' : key === 'early' ? 'Most Early' : 'Most Punctual';
      renderFullRouteList(list, title, routes, activeDays);
    });
  });
}

export async function openStats(days = 7) {
  state.prevScreen = state.screen;
  showScreen('stats', 'Delay Stats');
  history.replaceState(null, '', '#stats');
  $('stats-list').innerHTML = '<p class="empty">Loading…</p>';
  try {
    const data = await fetch(`/api/stats?days=${days}`).then(response => response.json());
    renderStats(data, days);
  } catch (err) {
    $('stats-list').innerHTML = `<p class="empty">Error: ${err?.message || err}</p>`;
  }
}
