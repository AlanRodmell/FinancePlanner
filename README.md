# Ledger — personal budgeting app

A static, single-page budgeting app: import bank statements (CSV or PDF),
categorise spending with rules or an LLM, and browse the results. No backend —
everything is stored in your browser's IndexedDB, so it works entirely as a
GitHub Pages site.

## Deploying to GitHub Pages

1. Create a new GitHub repo and push this folder's contents to it (`index.html`
   must be at the repo root, or in `/docs` if you configure Pages that way).
2. In the repo, go to **Settings → Pages**, set the source branch (e.g. `main`)
   and folder (`/root` or `/docs`), and save.
3. GitHub will give you a URL like `https://<username>.github.io/<repo>/`.
   That's your app.

No build step, no npm install — it's plain HTML/CSS/JS loading a few
libraries from a CDN (PapaParse for CSV, pdf.js for PDF text extraction,
Chart.js for the charts).

## Using it

- **Import** — drop a Barclays CSV export or PDF statement. The app previews
  what it found (with warnings if anything looks off) before you commit it.
  Duplicate rows (matched by date + amount + description) are skipped
  automatically on re-import.
- **Transactions** — search, filter by category or month, manually set a
  category per row, add a note, delete a row, or add a one-off transaction
  by hand (handy for cash spending that won't show up in a statement).
  "Export CSV" downloads whatever's currently shown.
- **Budget** — set a monthly £ target per category and see spend-to-date,
  remaining, and a progress bar for whichever month you pick. The "Avg/month"
  column shows your historical average for that category as a reference
  when setting the number. Budgets are flat per category (not locked to one
  month), so they carry forward automatically.
- **Dashboard** — totals, a category breakdown, a month-by-month trend, a
  "Recurring payments" card (auto-detected from charges that repeat at a
  similar amount across two or more months), and an AI insights button.
- **Categories & Rules** — rules are simple "if description contains X" matches,
  checked top to bottom. Starter categories and rules are seeded on first run;
  edit freely.
- **Settings → Google API key** — click the status pill at the bottom of the
  sidebar any time to paste/update/remove a Google AI Studio key. It enables
  two AI features:
  - *Categorise with AI* (Transactions tab) — sends uncategorised transaction
    descriptions + your category list to Gemini and applies its suggestions.
  - *Get AI insights* (Dashboard) — sends only a category-level spending
    summary (no individual transactions) and asks for a short written
    analysis.

  The key is stored only in your browser's local database. It is **not**
  included in backup exports unless you explicitly tick "Include API key in
  export" — worth leaving unticked if you'll ever share a backup file.

## Backups

Since everything lives in one browser's storage, use **Settings → Backup** to
export a JSON snapshot regularly, especially before clearing browser data or
switching devices. Restoring can either replace everything or merge with what's
already there.

## A note on the PDF importer

Barclays statement PDF layouts vary by account type, and pdf.js extraction is
heuristic here — it looks for lines starting with a date and ending in one or
two money figures. It works well for most current-account statements, but if
a statement doesn't parse cleanly, the CSV export from online banking is more
reliable.

## Project structure

```
index.html
styles.css
js/
  app.js          — UI controller, event wiring
  db.js           — IndexedDB wrapper
  csvParser.js    — CSV → transaction rows
  pdfParser.js    — PDF → transaction rows
  categorizer.js  — rule engine + default categories/rules
  budget.js       — month helpers, budget-vs-actual calculations
  recurring.js    — recurring-payment detection
  llm.js          — Gemini API calls (categorisation + insights)
  charts.js       — Chart.js rendering
  backup.js       — export/import full app state as JSON
```
