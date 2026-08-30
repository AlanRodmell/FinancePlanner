import { DB, getSetting, setSetting } from './db.js';
import { parseCSV } from './csvParser.js';
import { parsePDF } from './pdfParser.js';
import {
  DEFAULT_CATEGORIES, STARTER_RULES, applyRules, uncategorised,
  summariseByCategory, suggestMatchFragment,
} from './categorizer.js';
import { categorizeWithLLM, getSpendingInsights, testApiKey } from './llm.js';
import { renderCategoryChart, renderTrendChart, monthlyTotals } from './charts.js';
import { buildBackup, downloadBackup, restoreBackup, readFileAsJSON } from './backup.js';
import { monthKey, monthLabel, availableMonths, currentMonthKey, spendByCategoryForMonth, averageMonthlySpend, budgetStatus } from './budget.js';
import { detectRecurring } from './recurring.js';

const state = {
  tab: 'dashboard',
  transactions: [],
  categories: [],
  rules: [],
  budgets: {}, // categoryId -> amount
  pendingImport: null, // { transactions, warnings, fileName }
  txnFilter: { search: '', category: 'all', month: 'all' },
  budgetMonth: null,
};

const money = (n) => (n < 0 ? '-' : '') + '£' + Math.abs(n).toFixed(2);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => [...root.querySelectorAll(sel)];

async function init() {
  await seedIfEmpty();
  await loadAll();
  wireNav();
  wireGlobalEvents();
  render();
  refreshKeyStatusUI();
}

async function seedIfEmpty() {
  const cats = await DB.getAll('categories');
  if (!cats.length) await DB.putMany('categories', DEFAULT_CATEGORIES);
  const rules = await DB.getAll('rules');
  if (!rules.length) {
    await DB.putMany('rules', STARTER_RULES.map((r, i) => ({ id: `starter-${i}`, ...r })));
  }
}

async function loadAll() {
  const [transactions, categories, rules, budgetRows] = await Promise.all([
    DB.getAll('transactions'),
    DB.getAll('categories'),
    DB.getAll('rules'),
    DB.getAll('budgets'),
  ]);
  state.transactions = transactions.sort((a, b) => b.date.localeCompare(a.date));
  state.categories = categories;
  state.rules = rules;
  state.budgets = Object.fromEntries(budgetRows.map(b => [b.categoryId, b.amount]));
}

function wireNav() {
  els('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });
}

function wireGlobalEvents() {
  const dropZone = el('#drop-zone');
  const fileInput = el('#file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  el('#confirm-import').addEventListener('click', commitImport);
  el('#cancel-import').addEventListener('click', () => { state.pendingImport = null; renderImport(); });

  el('#run-rules-btn').addEventListener('click', async () => {
    const { matchedCount } = applyRules(state.transactions, state.rules);
    await DB.putMany('transactions', state.transactions);
    toast(`Applied rules to ${matchedCount} transaction(s).`);
    render();
  });

  el('#ai-categorize-btn').addEventListener('click', runAICategorize);
  el('#ai-insight-btn').addEventListener('click', runAIInsight);

  el('#add-category-btn').addEventListener('click', addCategory);
  el('#add-rule-btn').addEventListener('click', addRule);

  el('#key-status-btn').addEventListener('click', openKeyModal);
  el('#open-key-modal-btn').addEventListener('click', openKeyModal);
  el('#key-modal-cancel').addEventListener('click', closeKeyModal);
  el('#key-modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'key-modal-backdrop') closeKeyModal(); });
  el('#key-modal-toggle-visibility').addEventListener('click', () => {
    const input = el('#key-modal-input');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  el('#key-modal-save').addEventListener('click', saveApiKey);
  el('#key-modal-test').addEventListener('click', testKey);
  el('#key-modal-remove').addEventListener('click', removeApiKey);

  el('#export-btn').addEventListener('click', doExport);
  el('#import-backup-input').addEventListener('change', doImportBackup);
  el('#clear-data-btn').addEventListener('click', clearAllData);

  el('#txn-search').addEventListener('input', (e) => { state.txnFilter.search = e.target.value; renderTransactions(); });
  el('#txn-category-filter').addEventListener('change', (e) => { state.txnFilter.category = e.target.value; renderTransactions(); });
  el('#txn-month-filter').addEventListener('change', (e) => { state.txnFilter.month = e.target.value; renderTransactions(); });
  el('#export-csv-btn').addEventListener('click', exportTransactionsCSV);

  el('#add-txn-btn').addEventListener('click', openAddTxnModal);
  el('#add-txn-cancel').addEventListener('click', closeAddTxnModal);
  el('#add-txn-backdrop').addEventListener('click', (e) => { if (e.target.id === 'add-txn-backdrop') closeAddTxnModal(); });
  el('#add-txn-save').addEventListener('click', saveNewTransaction);

  el('#budget-month-select').addEventListener('change', (e) => { state.budgetMonth = e.target.value; renderBudget(); });
  el('#save-budgets-btn').addEventListener('click', saveBudgets);
}

function toast(msg, isError = false) {
  const box = el('#toast');
  box.textContent = msg;
  box.className = isError ? 'toast toast-error show' : 'toast show';
  clearTimeout(box._timer);
  box._timer = setTimeout(() => box.classList.remove('show'), 4000);
}

function render() {
  els('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  els('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${state.tab}`));
  if (state.tab === 'dashboard') renderDashboard();
  if (state.tab === 'transactions') renderTransactions();
  if (state.tab === 'import') renderImport();
  if (state.tab === 'budget') renderBudget();
  if (state.tab === 'categories') renderCategories();
  if (state.tab === 'settings') renderSettings();
}

// ---------- Dashboard ----------
function renderDashboard() {
  const income = state.transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spend = state.transactions.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  el('#stat-income').textContent = money(income);
  el('#stat-spend').textContent = money(spend);
  el('#stat-net').textContent = money(income + spend);
  el('#stat-count').textContent = state.transactions.length;

  if (state.transactions.length) {
    const summary = summariseByCategory(state.transactions, state.categories);
    renderCategoryChart(el('#category-chart'), summary);
    renderTrendChart(el('#trend-chart'), monthlyTotals(state.transactions));
  }

  renderRecurring();
}

function renderRecurring() {
  const recurring = detectRecurring(state.transactions);
  const catById = Object.fromEntries(state.categories.map(c => [c.id, c]));
  const list = el('#recurring-list');

  if (!recurring.length) {
    list.innerHTML = '<li class="muted small">Nothing recurring spotted yet — needs at least two similar charges in different months.</li>';
    el('#recurring-total').textContent = '';
    return;
  }

  list.innerHTML = recurring.slice(0, 12).map(r => {
    const cat = catById[r.categoryId];
    return `<li class="recurring-row">
      <span class="recurring-desc">${escapeHTML(r.sampleDescription)}</span>
      ${cat ? `<span class="stamp" style="--stamp-color:${cat.color}">${cat.name}</span>` : ''}
      <span class="recurring-months">${r.months.length} months</span>
      <span class="mono negative">${money(-r.monthlyCost)}/mo</span>
    </li>`;
  }).join('');

  const total = recurring.reduce((s, r) => s + r.monthlyCost, 0);
  el('#recurring-total').textContent = `~${money(-total)}/mo committed`;
}

async function runAIInsight() {
  const apiKey = await getSetting('googleApiKey');
  if (!apiKey) return openKeyModal({ reason: 'AI insights need an API key first.' });
  if (!state.transactions.length) return toast('Import some transactions first.', true);

  const btn = el('#ai-insight-btn');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const summary = summariseByCategory(state.transactions, state.categories);
    const context = {
      period: `${state.transactions.at(-1)?.date} to ${state.transactions[0]?.date}`,
      categorySummary: summary,
      transactionCount: state.transactions.length,
    };
    const insight = await getSpendingInsights(apiKey, context);
    el('#insight-text').textContent = insight;
    el('#insight-box').classList.remove('hidden');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get AI insights';
  }
}

// ---------- Import ----------
async function handleFile(file) {
  try {
    let result;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const buf = await file.arrayBuffer();
      result = await parsePDF(buf, file.name);
    } else {
      const text = await file.text();
      result = await parseCSV(text, file.name);
    }
    const existingHashes = new Set(state.transactions.map(t => t.hash));
    const fresh = result.transactions.filter(t => !existingHashes.has(t.hash));
    const dupeCount = result.transactions.length - fresh.length;

    applyRules(fresh, state.rules);

    state.pendingImport = { transactions: fresh, warnings: result.warnings, fileName: file.name, dupeCount };
    renderImport();
  } catch (err) {
    toast(`Could not read ${file.name}: ${err.message}`, true);
  }
}

function renderImport() {
  const preview = el('#import-preview');
  const actions = el('#import-actions');
  if (!state.pendingImport) {
    preview.innerHTML = '<p class="muted">No file loaded yet. Drop a statement above to preview it here.</p>';
    actions.classList.add('hidden');
    return;
  }
  const { transactions, warnings, fileName, dupeCount } = state.pendingImport;
  const catById = Object.fromEntries(state.categories.map(c => [c.id, c]));

  let html = `<p><strong>${fileName}</strong> — ${transactions.length} new transaction(s) found`;
  if (dupeCount) html += `, ${dupeCount} already-imported row(s) skipped`;
  html += '.</p>';

  if (warnings.length) {
    html += `<ul class="warnings">${warnings.map(w => `<li>${w}</li>`).join('')}</ul>`;
  }

  if (transactions.length) {
    html += '<table class="ledger-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead><tbody>';
    for (const t of transactions.slice(0, 200)) {
      const cat = catById[t.category];
      html += `<tr>
        <td class="mono">${t.date}</td>
        <td>${escapeHTML(t.description)}</td>
        <td class="mono ${t.amount < 0 ? 'negative' : 'positive'}">${money(t.amount)}</td>
        <td>${cat ? `<span class="stamp" style="--stamp-color:${cat.color}">${cat.name}</span>` : '<span class="muted">uncategorised</span>'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    if (transactions.length > 200) html += `<p class="muted">Showing first 200 of ${transactions.length}.</p>`;
  }

  preview.innerHTML = html;
  actions.classList.toggle('hidden', transactions.length === 0);
}

async function commitImport() {
  if (!state.pendingImport?.transactions.length) return;
  await DB.putMany('transactions', state.pendingImport.transactions);
  toast(`Imported ${state.pendingImport.transactions.length} transaction(s).`);
  state.pendingImport = null;
  el('#file-input').value = '';
  await loadAll();
  render();
}

// ---------- Transactions ----------
function renderTransactions() {
  const filterSelect = el('#txn-category-filter');
  if (filterSelect.options.length <= 1) {
    filterSelect.innerHTML = '<option value="all">All categories</option>' +
      state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('') +
      '<option value="none">Uncategorised</option>';
  }

  const monthSelect = el('#txn-month-filter');
  const months = availableMonths(state.transactions);
  const wantedOptions = ['all', ...months];
  const currentOptions = [...monthSelect.options].map(o => o.value);
  if (currentOptions.join(',') !== wantedOptions.join(',')) {
    const keep = monthSelect.value;
    monthSelect.innerHTML = '<option value="all">All months</option>' +
      months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    if (wantedOptions.includes(keep)) monthSelect.value = keep;
  }

  let rows = state.transactions;
  const { search, category, month } = state.txnFilter;
  if (search) rows = rows.filter(t => t.description.toLowerCase().includes(search.toLowerCase()));
  if (category === 'none') rows = rows.filter(t => !t.category);
  else if (category !== 'all') rows = rows.filter(t => t.category === category);
  if (month !== 'all') rows = rows.filter(t => monthKey(t.date) === month);

  el('#txn-uncategorised-count').textContent = uncategorised(state.transactions).length;

  const catOptions = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const body = el('#txn-table-body');
  body.innerHTML = rows.map(t => `
    <tr data-id="${t.id}">
      <td class="mono">${t.date}</td>
      <td>${escapeHTML(t.description)}</td>
      <td class="mono ${t.amount < 0 ? 'negative' : 'positive'}">${money(t.amount)}</td>
      <td>
        <select class="txn-cat-select" data-id="${t.id}">
          <option value="">—</option>
          ${catOptions}
        </select>
      </td>
      <td><input type="text" class="notes-input" data-id="${t.id}" value="${escapeHTML(t.notes || '')}" placeholder="Add a note…"></td>
      <td><button class="icon-btn" data-action="delete-txn" data-id="${t.id}" title="Delete">✕</button></td>
    </tr>
  `).join('');

  els('.txn-cat-select', body).forEach(sel => {
    const txn = rows.find(t => t.id === sel.dataset.id);
    sel.value = txn?.category || '';
    sel.addEventListener('change', async (e) => {
      txn.category = e.target.value || null;
      await DB.put('transactions', txn);
      renderTransactions();
    });
  });

  els('.notes-input', body).forEach(input => {
    const txn = rows.find(t => t.id === input.dataset.id);
    input.addEventListener('change', async (e) => {
      txn.notes = e.target.value;
      await DB.put('transactions', txn);
    });
  });

  els('[data-action="delete-txn"]', body).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this transaction? This cannot be undone.')) return;
      await DB.delete('transactions', btn.dataset.id);
      await loadAll();
      render();
    });
  });
}

function exportTransactionsCSV() {
  if (!state.transactions.length) return toast('Nothing to export yet.', true);
  const catById = Object.fromEntries(state.categories.map(c => [c.id, c]));
  const header = ['Date', 'Description', 'Amount', 'Category', 'Notes'];
  const rows = state.transactions.map(t => [
    t.date,
    csvEscape(t.description),
    t.amount.toFixed(2),
    csvEscape(catById[t.category]?.name || ''),
    csvEscape(t.notes || ''),
  ].join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(str) {
  const s = String(str || '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Add transaction (manual entry) ----------
function openAddTxnModal() {
  el('#add-txn-date').value = new Date().toISOString().slice(0, 10);
  el('#add-txn-amount').value = '';
  el('#add-txn-desc').value = '';
  el('#add-txn-notes').value = '';
  const catSelect = el('#add-txn-category');
  catSelect.innerHTML = '<option value="">—</option>' + state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  el('#add-txn-backdrop').classList.remove('hidden');
  el('#add-txn-desc').focus();
}

function closeAddTxnModal() {
  el('#add-txn-backdrop').classList.add('hidden');
}

async function saveNewTransaction() {
  const date = el('#add-txn-date').value;
  const amount = parseFloat(el('#add-txn-amount').value);
  const description = el('#add-txn-desc').value.trim();
  const category = el('#add-txn-category').value || null;
  const notes = el('#add-txn-notes').value.trim();

  if (!date || Number.isNaN(amount) || !description) {
    return toast('Date, amount, and description are all needed.', true);
  }

  const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const txn = { id, hash: id, date, description, amount, balance: null, category, notes, source: 'Manual entry' };
  await DB.put('transactions', txn);
  closeAddTxnModal();
  toast('Transaction added.');
  await loadAll();
  render();
}

async function runAICategorize() {
  const apiKey = await getSetting('googleApiKey');
  if (!apiKey) return openKeyModal({ reason: 'AI categorisation needs an API key first.' });
  const todo = uncategorised(state.transactions);
  if (!todo.length) return toast('Nothing to categorise — everything already has a category.');

  const btn = el('#ai-categorize-btn');
  btn.disabled = true;
  try {
    btn.textContent = `Categorising 0/${todo.length}…`;
    const results = await categorizeWithLLM(apiKey, todo, state.categories, {
      onProgress: (done, total) => { btn.textContent = `Categorising ${done}/${total}…`; },
    });
    let applied = 0;
    for (const t of todo) {
      if (results[t.id]) { t.category = results[t.id]; applied++; }
    }
    await DB.putMany('transactions', todo);
    toast(`AI categorised ${applied} of ${todo.length} transaction(s).`);
    render();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Categorise with AI';
  }
}

// ---------- Budget ----------
function renderBudget() {
  const months = availableMonths(state.transactions);
  const select = el('#budget-month-select');
  const options = months.length ? months : [currentMonthKey()];
  const wanted = options.join(',');
  const current = [...select.options].map(o => o.value).join(',');
  if (current !== wanted) {
    select.innerHTML = options.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  }
  if (!state.budgetMonth || !options.includes(state.budgetMonth)) {
    state.budgetMonth = options.includes(currentMonthKey()) ? currentMonthKey() : options[0];
  }
  select.value = state.budgetMonth;

  const spend = spendByCategoryForMonth(state.transactions, state.budgetMonth);
  const body = el('#budget-table-body');
  let totalBudget = 0, totalSpent = 0;

  body.innerHTML = state.categories.filter(c => c.id !== 'income').map(c => {
    const budget = state.budgets[c.id] || 0;
    const spent = spend[c.id] || 0;
    const remaining = budget - spent;
    const status = budgetStatus(spent, budget);
    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    const avg = averageMonthlySpend(state.transactions, c.id);
    totalBudget += budget;
    totalSpent += spent;

    return `<tr data-id="${c.id}">
      <td><span class="swatch" style="background:${c.color}"></span> ${escapeHTML(c.name)}</td>
      <td><input type="number" step="1" min="0" class="budget-input" data-id="${c.id}" value="${budget || ''}" placeholder="0"></td>
      <td class="mono">${money(-spent)}</td>
      <td class="mono ${remaining < 0 ? 'negative' : ''}">${budget > 0 ? money(remaining) : '—'}</td>
      <td><div class="progress-track"><div class="progress-fill ${status === 'over' ? 'over' : status === 'warn' ? 'warn' : ''}" style="width:${pct}%"></div></div></td>
      <td class="mono muted small">${money(-avg)}</td>
    </tr>`;
  }).join('');

  el('#budget-total-budget').textContent = money(totalBudget);
  el('#budget-total-spent').textContent = money(-totalSpent);
  el('#budget-total-remaining').textContent = money(totalBudget - totalSpent);
}

async function saveBudgets() {
  const inputs = els('.budget-input', el('#budget-table-body'));
  const updates = inputs.map(input => ({
    categoryId: input.dataset.id,
    amount: parseFloat(input.value) || 0,
  }));
  await DB.putMany('budgets', updates);
  toast('Budgets saved.');
  await loadAll();
  renderBudget();
}

// ---------- Categories & Rules ----------
function renderCategories() {
  el('#category-list').innerHTML = state.categories.map(c => `
    <li class="category-row" data-id="${c.id}">
      <span class="swatch" style="background:${c.color}"></span>
      <span class="cat-name">${escapeHTML(c.name)}</span>
      <button class="link-btn danger" data-action="delete-category" data-id="${c.id}">Remove</button>
    </li>
  `).join('');

  const catOptions = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  el('#rule-list').innerHTML = state.rules.map(r => `
    <li class="rule-row" data-id="${r.id}">
      <span class="mono">"${escapeHTML(r.match)}"</span> → 
      <select class="rule-cat-select" data-id="${r.id}">${catOptions}</select>
      <button class="link-btn danger" data-action="delete-rule" data-id="${r.id}">Remove</button>
    </li>
  `).join('');

  els('.rule-cat-select').forEach(sel => {
    const rule = state.rules.find(r => r.id === sel.dataset.id);
    sel.value = rule.category;
    sel.addEventListener('change', async (e) => {
      rule.category = e.target.value;
      await DB.put('rules', rule);
    });
  });

  els('[data-action="delete-category"]').forEach(btn => btn.addEventListener('click', async () => {
    await DB.delete('categories', btn.dataset.id);
    await loadAll();
    renderCategories();
  }));
  els('[data-action="delete-rule"]').forEach(btn => btn.addEventListener('click', async () => {
    await DB.delete('rules', btn.dataset.id);
    await loadAll();
    renderCategories();
  }));
}

async function addCategory() {
  const nameInput = el('#new-category-name');
  const colorInput = el('#new-category-color');
  const name = nameInput.value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `cat-${Date.now()}`;
  await DB.put('categories', { id, name, color: colorInput.value });
  nameInput.value = '';
  await loadAll();
  renderCategories();
}

async function addRule() {
  const matchInput = el('#new-rule-match');
  const catSelect = el('#new-rule-category');
  const match = matchInput.value.trim();
  if (!match) return;
  await DB.put('rules', { id: `rule-${Date.now()}`, match, category: catSelect.value });
  matchInput.value = '';
  await loadAll();
  renderCategories();
}

// ---------- Settings ----------
async function renderSettings() {
  await refreshKeyStatusUI();
  const catOptions = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (el('#new-rule-category').options.length === 0) {
    el('#new-rule-category').innerHTML = catOptions;
  }
}

async function refreshKeyStatusUI() {
  const key = await getSetting('googleApiKey', '');
  const has = !!key;
  el('#key-status-btn').classList.toggle('connected', has);
  el('#key-status-label').textContent = has ? 'API key connected' : 'API key not set';
  const settingsLabel = el('#settings-key-status');
  if (settingsLabel) settingsLabel.textContent = has ? 'A key is saved in this browser.' : 'Not set';
}

// ---------- Key modal (bring-your-own-key) ----------
async function openKeyModal({ reason } = {}) {
  const key = await getSetting('googleApiKey', '');
  el('#key-modal-input').value = key || '';
  el('#key-modal-input').type = 'password';
  const msg = el('#key-modal-message');
  if (reason) {
    msg.textContent = reason;
    msg.className = 'small';
  } else {
    msg.className = 'small hidden';
  }
  el('#key-modal-backdrop').classList.remove('hidden');
  el('#key-modal-input').focus();
}

function closeKeyModal() {
  el('#key-modal-backdrop').classList.add('hidden');
}

function setKeyModalMessage(text, kind) {
  const msg = el('#key-modal-message');
  msg.textContent = text;
  msg.className = `small ${kind}`;
}

async function saveApiKey() {
  const key = el('#key-modal-input').value.trim();
  if (!key) return setKeyModalMessage('Enter a key, or use "Remove key" to clear it.', 'error');
  await setSetting('googleApiKey', key);
  await refreshKeyStatusUI();
  toast('API key saved locally in this browser.');
  closeKeyModal();
}

async function removeApiKey() {
  await setSetting('googleApiKey', '');
  el('#key-modal-input').value = '';
  await refreshKeyStatusUI();
  toast('API key removed.');
  closeKeyModal();
}

async function testKey() {
  const key = el('#key-modal-input').value.trim();
  if (!key) return setKeyModalMessage('Enter a key first.', 'error');
  const btn = el('#key-modal-test');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  const result = await testApiKey(key);
  btn.disabled = false;
  btn.textContent = 'Test';
  setKeyModalMessage(result.ok ? 'Key works.' : `Key test failed: ${result.error}`, result.ok ? 'ok' : 'error');
}

async function doExport() {
  const includeApiKey = el('#include-key-checkbox').checked;
  const backup = await buildBackup({ includeApiKey });
  downloadBackup(backup);
  toast('Backup downloaded.');
}

async function doImportBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const merge = el('#merge-import-checkbox').checked;
  try {
    const json = await readFileAsJSON(file);
    const result = await restoreBackup(json, { merge });
    toast(`Restored ${result.transactions} transaction(s), ${result.categories} categor${result.categories === 1 ? 'y' : 'ies'}, ${result.rules} rule(s).`);
    await loadAll();
    render();
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = '';
  }
}

async function clearAllData() {
  if (!confirm('This deletes all transactions, categories and rules stored in this browser. This cannot be undone. Continue?')) return;
  await DB.clearAll();
  await seedIfEmpty();
  await loadAll();
  render();
  toast('All data cleared.');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
