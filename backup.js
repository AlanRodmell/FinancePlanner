// backup.js — full data export/import so nothing lives only in one browser.
// The Google API key is excluded by default since backup files are easy to
// share by accident; it can be included explicitly if the user wants that.

import { DB, getSetting } from './db.js';

const BACKUP_VERSION = 1;

export async function buildBackup({ includeApiKey = false } = {}) {
  const [transactions, categories, rules, settingsRows, budgets] = await Promise.all([
    DB.getAll('transactions'),
    DB.getAll('categories'),
    DB.getAll('rules'),
    DB.getAll('settings'),
    DB.getAll('budgets'),
  ]);

  const settings = {};
  for (const row of settingsRows) {
    if (row.key === 'googleApiKey' && !includeApiKey) continue;
    settings[row.key] = row.value;
  }

  return {
    app: 'ledger',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { transactions, categories, rules, budgets, settings },
  };
}

export function downloadBackup(backupObj) {
  const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `ledger-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function restoreBackup(json, { merge = false } = {}) {
  if (!json || json.app !== 'ledger' || !json.data) {
    throw new Error('This file does not look like a ledger backup.');
  }
  const { transactions = [], categories = [], rules = [], budgets = [], settings = {} } = json.data;

  if (!merge) {
    await DB.clear('transactions');
    await DB.clear('categories');
    await DB.clear('rules');
    await DB.clear('budgets');
  }

  if (transactions.length) await DB.putMany('transactions', transactions);
  if (categories.length) await DB.putMany('categories', categories);
  if (rules.length) await DB.putMany('rules', rules);
  if (budgets.length) await DB.putMany('budgets', budgets);
  for (const [key, value] of Object.entries(settings)) {
    await DB.put('settings', { key, value });
  }

  return {
    transactions: transactions.length,
    categories: categories.length,
    rules: rules.length,
    settings: Object.keys(settings).length,
  };
}

export function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(new Error('Could not parse that file as JSON.'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
