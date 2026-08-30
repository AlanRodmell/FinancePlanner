// csvParser.js — parses CSV bank statements exported by UK banks.
// Handles Barclays-style exports and a generic fallback that auto-detects
// date / description / amount columns.
//
// Returns: { transactions: [...], warnings: [...] }
// Each transaction: { id, hash, date, description, amount, balance, category: null, notes: '', source }

/** Canonical YYYY-MM-DD from common UK date strings: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD */
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).replace(/[£,\s]/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function txnHash(date, description, amount) {
  return simpleHash(`${date}|${description}|${amount}`);
}

/** Match a header name against a list of candidates (case-insensitive, partial). */
function colIndex(headers, candidates) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  for (const c of candidates) {
    const i = lower.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

export async function parseCSV(text, fileName) {
  const warnings = [];

  // Use PapaParse if available (loaded globally in index.html)
  let rows;
  if (typeof Papa !== 'undefined') {
    const result = Papa.parse(text.trim(), { skipEmptyLines: true });
    rows = result.data;
    if (result.errors.length) {
      warnings.push(`CSV parse warning: ${result.errors[0].message}`);
    }
  } else {
    // Minimal fallback: split on newlines, comma-split each line
    rows = text.trim().split(/\r?\n/).map(line =>
      line.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'))
    );
  }

  if (rows.length < 2) {
    return { transactions: [], warnings: ['No data rows found in CSV.'] };
  }

  const headers = rows[0];

  // Try to locate columns
  const dateCol   = colIndex(headers, ['date']);
  const descCol   = colIndex(headers, ['description', 'memo', 'narrative', 'details', 'payee', 'reference']);
  const amountCol = colIndex(headers, ['amount', 'value', 'debit/credit', 'transaction']);
  const creditCol = colIndex(headers, ['credit', 'money in', 'in']);
  const debitCol  = colIndex(headers, ['debit', 'money out', 'out', 'withdrawal']);
  const balanceCol = colIndex(headers, ['balance', 'running balance']);

  if (dateCol === -1) {
    warnings.push('Could not identify a Date column; check the CSV format.');
    return { transactions: [], warnings };
  }
  if (descCol === -1) {
    warnings.push('Could not identify a Description column; check the CSV format.');
    return { transactions: [], warnings };
  }
  if (amountCol === -1 && (creditCol === -1 || debitCol === -1)) {
    warnings.push('Could not identify Amount columns; check the CSV format.');
    return { transactions: [], warnings };
  }

  const transactions = [];
  const seenHashes = new Map(); // hash → count (for deduplication of identical rows)

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;

    const date = parseDate(row[dateCol]);
    if (!date) {
      warnings.push(`Row ${i + 1}: unrecognised date "${row[dateCol]}", skipped.`);
      continue;
    }

    const description = (descCol !== -1 ? row[descCol] : '').trim();

    let amount;
    if (amountCol !== -1) {
      amount = parseAmount(row[amountCol]);
    } else {
      // Separate debit / credit columns
      const credit = parseAmount(row[creditCol]) ?? 0;
      const debit  = parseAmount(row[debitCol])  ?? 0;
      amount = credit > 0 ? credit : -Math.abs(debit);
    }

    if (amount === null) {
      warnings.push(`Row ${i + 1}: could not parse amount, skipped.`);
      continue;
    }

    const balance = balanceCol !== -1 ? parseAmount(row[balanceCol]) : null;

    // Build a hash; append a suffix if the same hash appears multiple times (identical rows)
    const baseHash = txnHash(date, description, amount);
    const seen = seenHashes.get(baseHash) || 0;
    seenHashes.set(baseHash, seen + 1);
    const hash = seen > 0 ? `${baseHash}-${seen}` : baseHash;
    const id = `csv-${hash}`;

    transactions.push({ id, hash, date, description, amount, balance, category: null, notes: '', source: fileName });
  }

  return { transactions, warnings };
}
