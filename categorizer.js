// categorizer.js — default categories, starter rules, and rule-based / summary helpers.

export const DEFAULT_CATEGORIES = [
  { id: 'income',        name: 'Income',        color: '#22c55e' },
  { id: 'groceries',     name: 'Groceries',     color: '#f59e0b' },
  { id: 'eating-out',    name: 'Eating out',    color: '#f97316' },
  { id: 'transport',     name: 'Transport',     color: '#3b82f6' },
  { id: 'utilities',     name: 'Utilities',     color: '#8b5cf6' },
  { id: 'subscriptions', name: 'Subscriptions', color: '#ec4899' },
  { id: 'health',        name: 'Health',        color: '#14b8a6' },
  { id: 'shopping',      name: 'Shopping',      color: '#a855f7' },
  { id: 'entertainment', name: 'Entertainment', color: '#6366f1' },
  { id: 'holidays',      name: 'Holidays',      color: '#0ea5e9' },
  { id: 'home',          name: 'Home',          color: '#84cc16' },
  { id: 'personal-care', name: 'Personal care', color: '#f43f5e' },
  { id: 'savings',       name: 'Savings',       color: '#10b981' },
  { id: 'other',         name: 'Other',         color: '#6b7280' },
];

export const STARTER_RULES = [
  { match: 'tesco',        category: 'groceries' },
  { match: 'sainsbury',    category: 'groceries' },
  { match: 'asda',         category: 'groceries' },
  { match: 'lidl',         category: 'groceries' },
  { match: 'aldi',         category: 'groceries' },
  { match: 'waitrose',     category: 'groceries' },
  { match: 'morrisons',    category: 'groceries' },
  { match: 'co-op',        category: 'groceries' },
  { match: 'marks & spencer food', category: 'groceries' },
  { match: 'deliveroo',    category: 'eating-out' },
  { match: 'uber eats',    category: 'eating-out' },
  { match: 'just eat',     category: 'eating-out' },
  { match: 'mcdonald',     category: 'eating-out' },
  { match: 'costa',        category: 'eating-out' },
  { match: 'starbucks',    category: 'eating-out' },
  { match: 'greggs',       category: 'eating-out' },
  { match: 'tfl',          category: 'transport' },
  { match: 'trainline',    category: 'transport' },
  { match: 'national rail', category: 'transport' },
  { match: 'uber',         category: 'transport' },
  { match: 'bp',           category: 'transport' },
  { match: 'shell',        category: 'transport' },
  { match: 'netflix',      category: 'subscriptions' },
  { match: 'spotify',      category: 'subscriptions' },
  { match: 'amazon prime', category: 'subscriptions' },
  { match: 'disney+',      category: 'subscriptions' },
  { match: 'apple',        category: 'subscriptions' },
  { match: 'sky',          category: 'subscriptions' },
  { match: 'bt group',     category: 'utilities' },
  { match: 'british gas',  category: 'utilities' },
  { match: 'octopus energy', category: 'utilities' },
  { match: 'bulb',         category: 'utilities' },
  { match: 'thames water', category: 'utilities' },
  { match: 'salary',       category: 'income' },
  { match: 'payroll',      category: 'income' },
  { match: 'hmrc',         category: 'income' },
  { match: 'amazon',       category: 'shopping' },
];

/**
 * Apply rules to transactions in-place.
 * Returns { matchedCount }.
 */
export function applyRules(transactions, rules) {
  let matchedCount = 0;
  for (const txn of transactions) {
    for (const rule of rules) {
      if (txn.description.toLowerCase().includes(rule.match.toLowerCase())) {
        txn.category = rule.category;
        matchedCount++;
        break;
      }
    }
  }
  return { matchedCount };
}

/** Returns transactions with no category set. */
export function uncategorised(transactions) {
  return transactions.filter(t => !t.category);
}

/**
 * Returns an array of { id, name, color, total (negative = spend), count }
 * for each category that has at least one transaction, sorted by absolute total descending.
 */
export function summariseByCategory(transactions, categories) {
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const totals = {};
  for (const t of transactions) {
    const key = t.category || 'other';
    if (!totals[key]) totals[key] = { total: 0, count: 0 };
    totals[key].total += t.amount;
    totals[key].count++;
  }
  return Object.entries(totals)
    .map(([id, { total, count }]) => ({
      id,
      name: catById[id]?.name ?? id,
      color: catById[id]?.color ?? '#6b7280',
      total,
      count,
    }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/**
 * Given a transaction description, suggest a short fragment suitable for a new rule.
 * Returns up to the first 3 meaningful words, lower-cased.
 */
export function suggestMatchFragment(description) {
  return (description || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}
