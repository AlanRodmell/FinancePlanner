// llm.js — Google Gemini (Generative Language API) integration.
// Three entry points used by the app:
//   categorizeWithLLM  — batch-categorise uncategorised transactions
//   getSpendingInsights — ask Gemini for narrative spending insights
//   testApiKey          — quick ping to verify a key is valid

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function callGemini(apiKey, prompt) {
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || res.statusText;
    throw new Error(`Gemini API error ${res.status}: ${msg}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Categorise up to `transactions` in batches of 50.
 * Returns a map of { [transactionId]: categoryId }.
 *
 * @param {string} apiKey
 * @param {Array}  transactions  — uncategorised transactions
 * @param {Array}  categories    — available categories [{ id, name }]
 * @param {{ onProgress?: (done, total) => void }} opts
 */
export async function categorizeWithLLM(apiKey, transactions, categories, { onProgress } = {}) {
  const catList = categories.map(c => `${c.id}: ${c.name}`).join('\n');
  const results = {};
  const BATCH = 50;
  let done = 0;

  for (let i = 0; i < transactions.length; i += BATCH) {
    const batch = transactions.slice(i, i + BATCH);
    const items = batch.map((t, idx) => `${idx}: ${t.description} (${t.amount >= 0 ? '+' : ''}${t.amount.toFixed(2)})`).join('\n');

    const prompt = `You are a personal finance assistant. Categorise each bank transaction below into exactly one of the provided category IDs.

Available categories:
${catList}

Transactions (index: description (amount)):
${items}

Reply with ONLY a JSON object mapping each index (as a string) to a category ID, e.g. {"0":"groceries","1":"transport"}.
Do not include any explanation or markdown.`;

    const raw = await callGemini(apiKey, prompt);
    let parsed = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      // Ignore parse failures — transactions in this batch stay uncategorised
    }

    for (const [idx, catId] of Object.entries(parsed)) {
      const txn = batch[Number(idx)];
      if (txn && categories.some(c => c.id === catId)) {
        results[txn.id] = catId;
      }
    }

    done += batch.length;
    onProgress?.(done, transactions.length);
  }

  return results;
}

/**
 * Request a narrative spending insights summary from Gemini.
 *
 * @param {string} apiKey
 * @param {{ period, categorySummary, transactionCount }} context
 * @returns {Promise<string>} Markdown-flavoured insights text
 */
export async function getSpendingInsights(apiKey, context) {
  const catSummary = context.categorySummary
    .filter(c => c.id !== 'income')
    .slice(0, 15)
    .map(c => `  ${c.name}: £${Math.abs(c.total).toFixed(2)} (${c.count} transactions)`)
    .join('\n');

  const prompt = `You are a friendly, concise personal finance coach. A user has shared a summary of their spending for the period ${context.period} (${context.transactionCount} total transactions). Give 3–5 specific, actionable insights about their spending patterns, potential savings, or areas to watch. Be warm but direct. Use plain text (no markdown headers), keep each insight to 1–2 sentences.

Spending by category:
${catSummary}`;

  return callGemini(apiKey, prompt);
}

/**
 * Test whether an API key is valid by sending a minimal prompt.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function testApiKey(apiKey) {
  try {
    await callGemini(apiKey, 'Reply with the single word: ok');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
