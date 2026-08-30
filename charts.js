// charts.js — Chart.js wrappers for the dashboard charts.
// Requires Chart.js to be loaded globally (loaded via CDN in index.html).

import { monthKey, monthLabel } from './budget.js';

// Keep references so we can destroy and recreate charts without warnings.
const _charts = {};

function destroyIfExists(id) {
  if (_charts[id]) {
    _charts[id].destroy();
    delete _charts[id];
  }
}

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: '#9ca3af',
        font: { family: "'IBM Plex Mono', monospace", size: 11 },
        boxWidth: 12,
      },
    },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: '#334155',
      borderWidth: 1,
    },
  },
};

/**
 * Render a doughnut chart of spend by category.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} summary  — output of summariseByCategory; each item: { id, name, color, total }
 */
export function renderCategoryChart(canvas, summary) {
  destroyIfExists('category');

  // Only show spend categories (negative totals), sorted by absolute amount
  const spendItems = summary
    .filter(c => c.id !== 'income' && c.total < 0)
    .slice(0, 12);

  if (!spendItems.length) return;

  _charts['category'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: spendItems.map(c => c.name),
      datasets: [{
        data: spendItems.map(c => Math.abs(c.total)),
        backgroundColor: spendItems.map(c => c.color),
        borderColor: '#0f172a',
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      cutout: '60%',
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ` £${ctx.parsed.toFixed(2)}`,
          },
        },
      },
    },
  });
}

/**
 * Compute monthly income and spend totals from transactions.
 *
 * @param {Array} transactions
 * @returns {Array} [{ month, income, spend }] sorted oldest → newest
 */
export function monthlyTotals(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const m = monthKey(t.date);
    if (!map.has(m)) map.set(m, { month: m, income: 0, spend: 0 });
    const entry = map.get(m);
    if (t.amount >= 0) entry.income += t.amount;
    else entry.spend += Math.abs(t.amount);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Render a bar chart of monthly income vs. spend.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} totals — output of monthlyTotals
 */
export function renderTrendChart(canvas, totals) {
  destroyIfExists('trend');

  if (!totals.length) return;

  // Show last 12 months at most
  const data = totals.slice(-12);
  const labels = data.map(d => monthLabel(d.month));

  _charts['trend'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: data.map(d => d.income),
          backgroundColor: '#22c55e99',
          borderColor: '#22c55e',
          borderWidth: 1,
        },
        {
          label: 'Spend',
          data: data.map(d => d.spend),
          backgroundColor: '#ef444499',
          borderColor: '#ef4444',
          borderWidth: 1,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: {
          ticks: { color: '#9ca3af', font: { size: 10 } },
          grid: { color: '#1e293b' },
        },
        y: {
          ticks: {
            color: '#9ca3af',
            font: { size: 10 },
            callback: v => `£${v.toLocaleString()}`,
          },
          grid: { color: '#1e293b' },
        },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: £${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
    },
  });
}
