// pdfParser.js — extracts transactions from bank statement PDFs using pdf.js.
// Focuses on Barclays-style statements but includes a generic line-scanner fallback.
//
// Returns: { transactions: [...], warnings: [...] }
// Each transaction: { id, hash, date, description, amount, balance, category: null, notes: '', source }

/** Canonical YYYY-MM-DD from common UK date strings: DD/MM/YYYY, DD Mon YYYY, DD Mon YY */
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // DD Mon YYYY  or  DD Mon YY
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  m = s.match(/^(\d{1,2})\s+([a-zA-Z]{3,9})\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const year = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${year}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return null;
}

function parseAmount(raw) {
  if (!raw) return null;
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

/** Extract all text lines from a pdf.js document object. */
async function extractLines(pdfDoc) {
  const lines = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    // Group items by approximate Y position to form lines
    const byY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    }
    // Sort Y descending (top to bottom), then X ascending within each line
    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const sorted = byY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const text = sorted.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

/**
 * Attempt to parse transactions from raw text lines.
 * Looks for lines matching patterns like:
 *   "14 Jan 2024  TESCO STORES  -23.45  1234.56"
 *   "14/01/2024  TESCO STORES  -23.45"
 */
function parseLines(lines, fileName) {
  const transactions = [];
  const warnings = [];
  const seenHashes = new Map();

  // Regex to find a date anywhere in a line
  const dateRe = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/;
  // Regex to find a money value: optional minus, optional £, digits, dot, two digits
  const moneyRe = /-?£?\d{1,7}\.\d{2}/g;

  for (const line of lines) {
    const dateMatch = line.match(dateRe);
    if (!dateMatch) continue;

    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    // Extract all money values from the line
    const moneyMatches = [...line.matchAll(moneyRe)].map(m => parseAmount(m[0]));
    if (!moneyMatches.length) continue;

    // The description is everything between the date and the first money value
    const afterDate = line.slice(dateMatch.index + dateMatch[0].length);
    const firstMoneyIdx = afterDate.search(/-?£?\d{1,7}\.\d{2}/);
    const description = (firstMoneyIdx > 0 ? afterDate.slice(0, firstMoneyIdx) : afterDate)
      .replace(/\s+/g, ' ').trim();

    if (!description) continue;

    // Amount is the first monetary value; if there are two, the second is likely balance
    const amount = moneyMatches[0];
    const balance = moneyMatches.length >= 2 ? moneyMatches[moneyMatches.length - 1] : null;

    const baseHash = txnHash(date, description, amount);
    const seen = seenHashes.get(baseHash) || 0;
    seenHashes.set(baseHash, seen + 1);
    const hash = seen > 0 ? `${baseHash}-${seen}` : baseHash;

    transactions.push({
      id: `pdf-${hash}`,
      hash,
      date,
      description,
      amount,
      balance,
      category: null,
      notes: '',
      source: fileName,
    });
  }

  if (!transactions.length) {
    warnings.push('No transactions could be extracted from the PDF. The format may not be supported.');
  }

  return { transactions, warnings };
}

export async function parsePDF(arrayBuffer, fileName) {
  if (typeof pdfjsLib === 'undefined') {
    return { transactions: [], warnings: ['pdf.js is not loaded — cannot parse PDF.'] };
  }
  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const lines = await extractLines(pdfDoc);
    return parseLines(lines, fileName);
  } catch (err) {
    return { transactions: [], warnings: [`Failed to read PDF: ${err.message}`] };
  }
}
