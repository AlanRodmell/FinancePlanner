// recurring.js — spots likely recurring payments (subscriptions, bills)
// by grouping spend transactions with a similar description that show up
// in more than one calendar month at a similar amount.

function normaliseDesc(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/\b\d{4,}\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Returns a list of { key, sampleDescription, categoryId, monthlyCost, occurrences, months }
 * sorted by monthlyCost descending, for spend-only transactions that recur
 * across at least two distinct months at a similar amount (within 15%).
 */
export function detectRecurring(transactions, { minMonths = 2, tolerance = 0.15 } = {}) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.amount >= 0) continue; // spend only
    const key = normaliseDesc(t.description);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const results = [];
  for (const [key, txns] of groups) {
    const monthsSeen = new Set(txns.map(t => t.date.slice(0, 7)));
    if (monthsSeen.size < minMonths) continue;

    const amounts = txns.map(t => Math.abs(t.amount));
    const med = median(amounts);
    if (med === 0) continue;
    const consistent = amounts.filter(a => Math.abs(a - med) / med <= tolerance);
    if (consistent.length < minMonths) continue;

    const categoryCounts = {};
    for (const t of txns) {
      const c = t.category || 'other';
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    }
    const categoryId = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0];

    results.push({
      key,
      sampleDescription: txns[0].description,
      categoryId,
      monthlyCost: med,
      occurrences: txns.length,
      months: [...monthsSeen].sort(),
    });
  }

  return results.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
