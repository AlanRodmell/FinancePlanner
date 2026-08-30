// budget.js — turns transactions + budget targets into month-by-month
// budget-vs-actual figures. Budgets are one flat monthly amount per
// category (not per specific month) — simple to reason about, like a
// recurring line in a spreadsheet.

export function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function availableMonths(transactions) {
  const set = new Set(transactions.map(t => monthKey(t.date)));
  return [...set].sort().reverse();
}

export function currentMonthKey() {
  return monthKey(new Date().toISOString());
}

/** Total spend (positive number) per category for a given month. Income (positive amounts) is excluded. */
export function spendByCategoryForMonth(transactions, month) {
  const totals = {};
  for (const t of transactions) {
    if (monthKey(t.date) !== month) continue;
    if (t.amount >= 0) continue;
    const key = t.category || 'other';
    totals[key] = (totals[key] || 0) + Math.abs(t.amount);
  }
  return totals;
}

/** Average monthly spend for a category across all months present in the data, for reference when setting a budget. */
export function averageMonthlySpend(transactions, categoryId) {
  const months = availableMonths(transactions);
  if (!months.length) return 0;
  let total = 0;
  for (const month of months) {
    const totals = spendByCategoryForMonth(transactions, month);
    total += totals[categoryId] || 0;
  }
  return total / months.length;
}

export function budgetStatus(spent, budget) {
  if (!budget || budget <= 0) return 'none';
  const ratio = spent / budget;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
