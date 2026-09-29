# Historical Records Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload historical CSS cycle records (CSV / XLSX / PDF) on the Edge telemetry page, show each well's records in a pop-up on well switch, and drive the counterfactual backtest from them.

**Architecture:** One pure module (`frontend/src/data/history.js`) reads files and validates rows; SheetJS and pdf.js are passed in (node check) or lazy-imported (browser). Records live in `App` state, persisted to `localStorage`. One UI file (`frontend/src/components/Records.jsx`) holds the upload card, the records table and the well pop-up; `Telemetry.jsx`, `Shell.jsx`, `CssDesign.jsx`, `Traceability.jsx` get small edits.

**Tech Stack:** React 18, Vite 5, Tailwind, Recharts, SheetJS 0.20.3 (CDN tarball), pdfjs-dist 6.3.289, Node 24 for `npm run check`.

**Spec:** `docs/superpowers/specs/2026-09-29-historical-records-design.md`

## Global Constraints

- All commands run from `frontend/` unless stated.
- New runtime deps exactly: `xlsx` from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` and `pdfjs-dist@6.3.289`. pdf.js 5.6–6.2 carries GHSA-hq66-cqwq-w95j (JS execution from a malicious PDF); do not downgrade. No other new dependencies.
- SheetJS and pdf.js are only ever loaded by dynamic `import()`. The main chunk (baseline `index-*.js` 1,041.25 kB) may grow by at most 15 kB.
- Every `localStorage` access is inside `try/catch`; the app works with storage blocked.
- File limit 10 MB; accepted extensions `.csv .xlsx .xls .pdf`.
- `sor = steam · 6.29 / oil` (same as `twin.js`).
- Sample files are named `sample-cycle-history.*` and labelled synthetic wherever shown; charts of them carry the "synthetic sample" watermark.
- Match surrounding code: 2-space indent, single quotes, Tailwind classes from `index.css` (`card`, `btn-primary`, `btn-ghost`, `th`, `td`, `num`), terse comments.

## Review Focus

1. Right-aligned numbers in a PDF table sit under the right end of their header → must land in that column (Task 1 check, synthetic items).
2. Real spreadsheets have a title row and a blank row above the header → header found, row numbers stay Excel's (Task 1 check, XLSX sample has both).
3. Headers like "Steam-Oil Ratio", "Cum. Oil (bbl)", "Cycle #" → SOR never taken as steam; the others map (Task 1 check).
4. Numbers written "2,600" / "2 500", optional cells "n/a" or blank → parsed / left empty, not skipped (Task 1 check).
5. Corrupt or foreign JSON under `ushna.history` → app starts with no records instead of crashing (Task 1 `parseStored` check; Task 2 wires it).

---

### Task 1: Parsing core, sample files, checks

**Files:**
- Create: `frontend/src/data/history.js`
- Create: `frontend/scripts/pdf.mjs`
- Create: `frontend/scripts/make-samples.mjs`
- Create: `frontend/public/samples/sample-cycle-history.{csv,xlsx,pdf}` (generated)
- Create: `frontend/src/data/history.check.mjs`
- Modify: `frontend/package.json` (deps, `check`, `samples` scripts)

**Interfaces:**
- Produces (from `history.js`):
  - `FIELDS: { key, label, required, aliases }[]` — keys `well cycle steam oil energy failures`
  - `MAX_BYTES = 10485760`
  - `matchColumns(headers: string[]) → { [key]: number }` (column index or `-1`)
  - `missingFields(mapping) → string[]` (labels of unmatched required fields)
  - `toCycles(rows: { n, cells }[], mapping) → { records: Record[], skipped: { row, reason }[] }`
    where `Record = { well, cycle, steam, oil, sor, energy: number|null, failures: number|null }`
  - `byWell(records) → { [wellId]: Record[] }` sorted by cycle
  - `rowsFromSheet(data: ArrayBuffer, XLSX) → { headers, rows }`
  - `pdfItems(data: ArrayBuffer, pdfjs) → Promise<{ str, x, y, w, page }[]>`
  - `rowsFromPdfItems(items) → { headers, rows }`
  - `readFile(file: File) → Promise<{ headers, rows }>`
  - `toHistory(file: string, records) → { file, at, sample: boolean, wells }`
  - `parseStored(text: string|null) → history | null`
  - `markClass(history) → 'mark-sample' | 'mark-uploaded'` (chart watermark class)
- Produces (from `scripts/pdf.mjs`): `makePdf(cells: { x, y, text }[]) → Buffer`

- [ ] **Step 1: Install the two libraries**

```bash
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz pdfjs-dist@6.3.289
```

Expected: `package.json` dependencies gain `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` and `"pdfjs-dist": "^6.3.289"`. Then pin pdf.js exactly by editing it to `"pdfjs-dist": "6.3.289"`, and add scripts:

```json
"check": "node src/data/twin.check.mjs && node src/data/history.check.mjs",
"samples": "node scripts/make-samples.mjs"
```

- [ ] **Step 2: Write the PDF writer `frontend/scripts/pdf.mjs`**

```js
// Minimal one-page PDF writer: Helvetica text at given positions, with a real text layer.
// Enough for the sample file and the checks; not a general PDF library.
export function makePdf(cells, size = 9) {
  const esc = (s) => String(s).replace(/[\\()]/g, '\\$&');
  const ops = `BT /F1 ${size} Tf\n${cells.map(({ x, y, text }) => `1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj`).join('\n')}\nET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
```

- [ ] **Step 3: Write the sample generator `frontend/scripts/make-samples.mjs`**

```js
// Writes the synthetic sample cycle history as CSV, XLSX and PDF with identical content.
// Run: npm run samples   (outputs are committed; rerun only if WELLS change)
import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { WELLS } from '../src/data/twin.js';
import { makePdf } from './pdf.mjs';

const TITLE = 'Baghewala CSS cycle history (synthetic sample)';
const HEAD = ['Well ID', 'Cycle No.', 'Steam injected (t)', 'Oil produced (bbl)', 'Energy (kWh/bbl)', 'Rod failures'];
const rows = [];
for (const w of WELLS) {
  for (let c = 1; c < w.cycle; c++) { // completed cycles only; the current one is still producing
    const steam = w.steam - 150 + 50 * c + [0, 40, -30, 20, -10][c % 5];
    const sor = 7 + 0.45 * c + 0.3 * Math.sin(c * 1.7 + w.kh * 5) + (w.skin - 3) * 0.4;
    rows.push([w.id, c, steam, Math.round((steam * 6.29) / sor), +(20 + 0.6 * c + Math.cos(c + w.skin)).toFixed(1), [1, 2, 0, 3, 1][(c + Math.round(w.skin)) % 5]]);
  }
}

const dir = new URL('../public/samples/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('sample-cycle-history.csv', dir), [HEAD, ...rows].map((r) => r.join(',')).join('\n') + '\n');

const wb = XLSX.utils.book_new(); // title and blank row above the header, like a real report
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[TITLE], [], HEAD, ...rows]), 'Cycles');
writeFileSync(new URL('sample-cycle-history.xlsx', dir), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const X = [40, 110, 180, 290, 400, 490];
const cells = [{ x: 40, y: 800, text: TITLE }];
[HEAD, ...rows].forEach((r, i) => r.forEach((v, j) => cells.push({ x: X[j], y: 770 - i * 16, text: v })));
cells.push({ x: 270, y: 40, text: 'Page 1 of 1' });
writeFileSync(new URL('sample-cycle-history.pdf', dir), makePdf(cells));
console.log(`wrote ${rows.length} rows to public/samples/`);
```

Run: `npm run samples`
Expected: `wrote 18 rows to public/samples/` and three files in `frontend/public/samples/`.

- [ ] **Step 4: Write the failing check `frontend/src/data/history.check.mjs`**

```js
// Run: npm run check — historical records: the three sample formats agree, messy headers map,
// bad rows are reported rather than dropped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { matchColumns, missingFields, toCycles, byWell, rowsFromSheet, pdfItems, rowsFromPdfItems, readFile, toHistory, parseStored, markClass } from './history.js';
import { makePdf } from '../../scripts/pdf.mjs';

const bytes = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sample = (ext) => bytes(readFileSync(new URL(`../../public/samples/sample-cycle-history.${ext}`, import.meta.url)));
const R = (lines) => lines.map((cells, i) => ({ n: i + 2, cells }));

// The three sample files parse to identical records, none skipped
const parsed = {
  csv: rowsFromSheet(sample('csv'), XLSX),
  xlsx: rowsFromSheet(sample('xlsx'), XLSX),
  pdf: rowsFromPdfItems(await pdfItems(sample('pdf'), pdfjs)),
};
const out = {};
for (const [k, p] of Object.entries(parsed)) {
  assert.deepEqual(missingFields(matchColumns(p.headers)), [], `${k}: required columns matched`);
  out[k] = toCycles(p.rows, matchColumns(p.headers));
  assert.deepEqual(out[k].skipped, [], `${k}: nothing skipped`);
}
assert.equal(out.csv.records.length, 18, '18 completed cycles across six wells');
assert.deepEqual(out.xlsx.records, out.csv.records, 'xlsx == csv');
assert.deepEqual(out.pdf.records, out.csv.records, 'pdf == csv');
assert.equal(parsed.xlsx.rows[0].n, 4, 'xlsx: title + blank row skipped, row numbers stay Excel rows');
assert.deepEqual(Object.keys(byWell(out.csv.records)).sort(), ['BGW-02', 'BGW-04', 'BGW-07', 'BGW-09', 'BGW-11', 'BGW-15']);
const r0 = out.csv.records[0];
assert.ok(Math.abs(r0.sor - (r0.steam * 6.29) / r0.oil) < 1e-12, 'SOR uses the twin definition');

// Messy headers: exact aliases, prefixes, and ratio columns never taken as steam
assert.deepEqual(
  matchColumns(['  WELL ', 'Cycle #', 'Steam-Oil Ratio', 'Steam Injected (tonnes)', 'Cum. Oil (bbl)', 'Remarks']),
  { well: 0, cycle: 1, steam: 3, oil: 4, energy: -1, failures: -1 },
);
assert.equal(matchColumns(['Well', 'Cycle', 'Steam-Oil Ratio']).steam, -1, 'SOR is not steam');
assert.deepEqual(missingFields(matchColumns(['Well', 'Cycle'])), ['Steam (t)', 'Oil (bbl)']);

// Row validation: every rejection names its row and reason; separators and n/a are handled
const M = { well: 0, cycle: 1, steam: 2, oil: 3, energy: 4, failures: -1 };
const v = toCycles(R([
  ['BGW-07', 1, 2500, 2000, 21], //          row 2: superseded by row 8
  ['BGW-07', 2, '2,600', '', ''], //         row 3: oil blank
  ['BGW-99', 1, 2500, 2000, ''], //          row 4: unknown well
  ['BGW-04', 1.5, 2500, 2000, ''], //        row 5: cycle not whole
  ['BGW-04', 1, 2500, 0, ''], //             row 6: oil 0
  ['bgw 04', 2, '3,000', '2 500', 'n/a'], // row 7: ok (id normalised, separators, energy → null)
  ['BGW-07', 1, 2550, 2100, 22], //          row 8: ok, replaces row 2
  ['BGW-04', 3, 'abc', 2000, ''], //         row 9: steam not a number
]), M);
assert.deepEqual(v.records.map((r) => [r.well, r.cycle, r.steam, r.oil, r.energy, r.failures]), [
  ['BGW-04', 2, 3000, 2500, null, null],
  ['BGW-07', 1, 2550, 2100, 22, null],
]);
assert.deepEqual(v.skipped.map((s) => s.row), [2, 3, 4, 5, 6, 9]);
const why = Object.fromEntries(v.skipped.map((s) => [s.row, s.reason]));
assert.match(why[2], /duplicate of row 8/);
assert.match(why[3], /oil is blank/);
assert.match(why[4], /'BGW-99' is not a modelled well/);
assert.match(why[5], /whole number/);
assert.match(why[6], /greater than 0/);
assert.match(why[9], /steam is not a number \(abc\)/);

// PDF: right-aligned numbers, a title, a footer, and a header repeated on page 2
const it = (str, x, y, w, page = 1) => ({ str, x, y, w, page });
const head = (p) => [it('Well', 40, 780, 20, p), it('Cycle', 120, 780, 25, p), it('Steam (t)', 200, 780.5, 40, p), it('Oil', 320, 780, 15, p)];
const pdf = rowsFromPdfItems([
  it('Cycle history', 40, 800, 60), ...head(1),
  it('BGW-07', 40, 764, 35), it('1', 140, 764, 5), it('2500', 220, 763.2, 20), it('12,081', 305, 764, 30),
  it('Page 1', 280, 40, 30),
  ...head(2), it('BGW-07', 40, 764, 35, 2), it('2', 140, 764, 5, 2), it('2600', 220, 764, 20, 2), it('2,300', 310, 764, 25, 2),
]);
assert.deepEqual(pdf.headers, ['Well', 'Cycle', 'Steam (t)', 'Oil']);
assert.deepEqual(pdf.rows.map((r) => r.cells), [['BGW-07', '1', '2500', '12,081'], ['BGW-07', '2', '2600', '2,300']]);

// Scanned PDF (no text layer), wrong type, too big
await assert.rejects(pdfItems(bytes(makePdf([])), pdfjs), /scanned PDFs are not supported/);
await assert.rejects(readFile({ name: 'notes.docx', size: 100 }), /not supported/);
await assert.rejects(readFile({ name: 'BIG.XLSX', size: 11 * 1024 * 1024 }), /limit is 10 MB/);

// Stored state: anything malformed is ignored
for (const bad of [null, 'not json', '{"x":1}', '[]']) assert.equal(parseStored(bad), null, String(bad));
const h = toHistory('sample-cycle-history.xlsx', out.csv.records);
assert.equal(h.sample, true);
assert.equal(toHistory('field.xlsx', []).sample, false);
assert.deepEqual(parseStored(JSON.stringify(h)), h);
assert.equal(markClass(h), 'mark-sample');
assert.equal(markClass(toHistory('field.xlsx', [])), 'mark-uploaded');

console.log('history checks passed');
```

Run: `node src/data/history.check.mjs`
Expected: FAIL — `Cannot find module ... history.js`.

- [ ] **Step 5: Write `frontend/src/data/history.js`**

```js
// Historical CSS cycle records (Observation layer): read CSV / XLSX / PDF in the browser,
// match columns, validate rows. The parsing libraries are passed in (node check) or loaded
// on first use, so neither sits in the main bundle.
import { WELLS } from './twin.js';

export const FIELDS = [
  { key: 'well', label: 'Well', required: true, aliases: ['well', 'wellid', 'wellno', 'wellname'] },
  { key: 'cycle', label: 'Cycle', required: true, aliases: ['cycle', 'cycleno', 'csscycle', 'cyclenumber'] },
  { key: 'steam', label: 'Steam (t)', required: true, aliases: ['steam', 'steamt', 'steaminjected', 'steaminjectedt', 'steamvolume', 'steamvolumet', 'steamtonnes'] },
  { key: 'oil', label: 'Oil (bbl)', required: true, aliases: ['oil', 'oilbbl', 'oilproduced', 'oilproducedbbl', 'oilbarrels', 'cumoil', 'cumulativeoil'] },
  { key: 'energy', label: 'Energy (kWh/bbl)', required: false, aliases: ['energy', 'kwhbbl', 'energykwhbbl', 'energyperbbl', 'specificenergy'] },
  { key: 'failures', label: 'Rod failures', required: false, aliases: ['rodfailures', 'failures', 'rodbreaks'] },
];
export const MAX_BYTES = 10 * 1024 * 1024;
const EXTS = ['csv', 'xlsx', 'xls', 'pdf'];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const blank = (v) => v == null || String(v).trim() === '';
const num = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, '')));
const WELL_BY_NORM = new Map(WELLS.map((w) => [norm(w.id), w.id]));

// Column index per field, or -1. Exact alias matches win over prefix matches (≥ 5 chars);
// ratio columns (steam–oil ratio) never match steam or oil.
export function matchColumns(headers) {
  const h = headers.map(norm), used = new Set();
  const out = Object.fromEntries(FIELDS.map((f) => [f.key, -1]));
  for (const exact of [true, false]) {
    for (const f of FIELDS) {
      if (out[f.key] >= 0) continue;
      const i = h.findIndex((x, j) => !used.has(j) && x && !x.includes('ratio')
        && f.aliases.some((a) => (exact ? x === a : a.length >= 5 && x.startsWith(a))));
      if (i >= 0) { out[f.key] = i; used.add(i); }
    }
  }
  return out;
}

export const missingFields = (mapping) => FIELDS.filter((f) => f.required && mapping[f.key] < 0).map((f) => f.label);

// rows: [{ n: row number shown to the user, cells }]. A later row for the same well and cycle wins.
export function toCycles(rows, mapping) {
  const skipped = [], kept = new Map();
  for (const { n, cells } of rows) {
    const cell = (k) => (mapping[k] >= 0 ? cells[mapping[k]] : '');
    const bad = (reason) => skipped.push({ row: n, reason });
    if (blank(cell('well'))) { bad('well is blank'); continue; }
    const id = WELL_BY_NORM.get(norm(cell('well')));
    if (!id) { bad(`well '${String(cell('well')).trim()}' is not a modelled well (${WELLS.map((w) => w.id).join(', ')})`); continue; }
    const v = {};
    let ok = true;
    for (const k of ['cycle', 'steam', 'oil']) {
      if (blank(cell(k))) { bad(`${k} is blank`); ok = false; break; }
      v[k] = num(cell(k));
      if (!Number.isFinite(v[k])) { bad(`${k} is not a number (${String(cell(k)).trim()})`); ok = false; break; }
    }
    if (!ok) continue;
    if (!Number.isInteger(v.cycle) || v.cycle < 1) { bad('cycle must be a whole number ≥ 1'); continue; }
    if (v.steam < 0) { bad('steam cannot be negative'); continue; }
    if (v.oil <= 0) { bad('oil must be greater than 0'); continue; }
    const opt = (k) => { const x = num(cell(k)); return blank(cell(k)) || !Number.isFinite(x) || x < 0 ? null : x; };
    const key = `${id}|${v.cycle}`, prev = kept.get(key);
    if (prev) { kept.delete(key); skipped.push({ row: prev.n, reason: `duplicate of row ${n} (${id} cycle ${v.cycle}); row ${n} kept` }); }
    kept.set(key, { n, rec: { well: id, cycle: v.cycle, steam: v.steam, oil: v.oil, sor: (v.steam * 6.29) / v.oil, energy: opt('energy'), failures: opt('failures') } });
  }
  return { records: [...kept.values()].map((k) => k.rec), skipped: skipped.sort((a, b) => a.row - b.row) };
}

export function byWell(records) {
  const out = {};
  for (const r of records) (out[r.well] ??= []).push(r);
  for (const k in out) out[k].sort((a, b) => a.cycle - b.cycle);
  return out;
}

// Header = first line where ≥ 2 fields match, else the first line with ≥ 2 cells. Title rows above it are dropped.
function headerIndex(lines) {
  const hits = (l) => Object.values(matchColumns(l)).filter((i) => i >= 0).length;
  const i = lines.findIndex((l) => hits(l) >= 2);
  return i >= 0 ? i : lines.findIndex((l) => l.filter((c) => !blank(c)).length >= 2);
}

// rowBase: the number shown for lines[0]. Blank lines and repeated header lines are dropped.
function table(lines, rowBase) {
  const h = headerIndex(lines);
  if (h < 0) throw new Error('No table found: the file needs a header row with at least two columns');
  const headers = lines[h].map((c) => String(c).trim()), key = headers.join('|');
  const rows = lines.map((cells, i) => ({ n: rowBase + i, cells })).slice(h + 1)
    .filter((r) => r.cells.some((c) => !blank(c)) && r.cells.map((c) => String(c).trim()).join('|') !== key);
  return { headers, rows };
}

export function rowsFromSheet(data, XLSX) {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws?.['!ref']) throw new Error('The first sheet is empty');
  const lines = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: true });
  return table(lines, XLSX.utils.decode_range(ws['!ref']).s.r + 1); // row numbers match the spreadsheet
}

export async function pdfItems(data, pdfjs) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    for (const i of items) if (i.str?.trim()) out.push({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, page: p });
  }
  await doc.destroy();
  if (!out.length) throw new Error('No text found: scanned PDFs are not supported; export the table as CSV or XLSX');
  return out;
}

// Text items → lines (same page, y within 3 pt) → cells, each item going to the header column
// it overlaps most (nearest centre if none), so left- and right-aligned columns both work.
export function rowsFromPdfItems(items) {
  const lines = [];
  for (const i of [...items].sort((a, b) => a.page - b.page || b.y - a.y)) {
    const l = lines.at(-1);
    if (l && l.page === i.page && Math.abs(l.y - i.y) <= 3) l.items.push(i);
    else lines.push({ page: i.page, y: i.y, items: [i] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  const h = headerIndex(lines.map((l) => l.items.map((i) => i.str)));
  if (h < 0) throw new Error('No table found in the PDF: it needs a header row with at least two columns');
  const cols = lines[h].items.map((i) => [i.x, i.x + i.w]);
  const cellsOf = (l) => {
    const cells = cols.map(() => []);
    for (const i of l.items) {
      const a = i.x, b = i.x + i.w;
      const overlap = cols.map(([x0, x1]) => Math.min(b, x1) - Math.max(a, x0));
      let k = overlap.indexOf(Math.max(...overlap));
      if (overlap[k] <= 0) {
        const d = cols.map(([x0, x1]) => Math.abs((x0 + x1) / 2 - (a + b) / 2));
        k = d.indexOf(Math.min(...d));
      }
      cells[k].push(i.str);
    }
    return cells.map((c) => c.join(' '));
  };
  const grid = lines.slice(h).map((l, i) => (i === 0 ? l.items.map((x) => x.str) : cellsOf(l)))
    .filter((c, i) => i === 0 || c.filter(Boolean).length >= 2); // drops titles' stragglers and page footers
  return table(grid, 0); // PDF rows are numbered from 1 under the header
}

export async function readFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (!EXTS.includes(ext)) throw new Error(`.${ext} files are not supported: use CSV, XLSX, XLS or PDF`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB`);
  const data = await file.arrayBuffer();
  if (ext !== 'pdf') return rowsFromSheet(data, await import('xlsx'));
  const [pdfjs, { default: worker }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return rowsFromPdfItems(await pdfItems(data, pdfjs));
}

export const markClass = (h) => (h?.sample ? 'mark-sample' : 'mark-uploaded'); // chart watermark (index.css)

export const toHistory = (file, records) => ({ file, at: new Date().toISOString(), sample: /^sample-cycle-history/.test(file), wells: byWell(records) });

export function parseStored(text) {
  try {
    const h = JSON.parse(text);
    return h && typeof h.file === 'string' && h.wells && typeof h.wells === 'object' && !Array.isArray(h.wells) ? h : null;
  } catch { return null; }
}
```

- [ ] **Step 6: Run the checks**

Run: `npm run check`
Expected: twin checks pass silently, then `history checks passed`. If an assertion fails, fix `history.js` (not the check) unless the check contradicts the spec.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts src/data/history.js src/data/history.check.mjs public/samples
git commit -m "Historical records: CSV/XLSX/PDF parsing, validation, sample files, checks"
```

---

### Task 2: Records in app state + upload card on Edge telemetry

**Files:**
- Create: `frontend/src/components/Records.jsx`
- Modify: `frontend/src/App.jsx` (state, ctx)
- Modify: `frontend/src/pages/Telemetry.jsx` (left column wrapper + card)
- Modify: `frontend/src/index.css` (watermark variants)
- Modify: `frontend/src/components/Shell.jsx:33-34` (tour step 1 text)
- Modify: `frontend/src/pages/Traceability.jsx:44` (observation box)

**Interfaces:**
- Consumes: `readFile, matchColumns, missingFields, toCycles, toHistory, FIELDS, parseStored, markClass` from Task 1.
- Produces:
  - `ctx.history: { file, at, sample, wells } | null`, `ctx.setHistory(h | null)`
  - `Records.jsx` exports `sampleFile() → Promise<File>`, `RecordsTable({ records, showWell = true })`, `RecordsUpload({ ctx })`

- [ ] **Step 1: App state** — in `App.jsx` add `import { parseStored } from './data/history';`, then after the `calib` state:

```js
  // Historical cycle records (Edge telemetry upload), kept per browser.
  const [history, setHistoryState] = useState(() => { try { return parseStored(localStorage.getItem(HISTORY_KEY)); } catch { return null; } });
  const setHistory = (h) => {
    setHistoryState(h);
    try { if (h) localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); else localStorage.removeItem(HISTORY_KEY); } catch { /* storage blocked: records last this visit */ }
  };
```

with `const HISTORY_KEY = 'ushna.history';` next to `clock`, and add `history, setHistory,` to `ctx`.

- [ ] **Step 2: Watermark variants** — in `index.css` after the `.no-mark` rule:

```css
.mark-uploaded .recharts-responsive-container::after { content: 'uploaded records'; color: #047857; }
.mark-sample .recharts-responsive-container::after { content: 'synthetic sample · uploaded'; }
```

- [ ] **Step 3: Write `frontend/src/components/Records.jsx`** (upload card + table; the pop-up is added in Task 3)

```jsx
import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, Trash2 } from 'lucide-react';
import { Card } from './ui';
import { FIELDS, readFile, matchColumns, missingFields, toCycles, toHistory, markClass } from '../data/history';

// Historical CSS cycle records: upload card (Edge telemetry), records table, well pop-up.
const SAMPLE = 'sample-cycle-history';

export async function sampleFile() {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${SAMPLE}.xlsx`);
  if (!res.ok) throw new Error(`Sample not found (${res.status})`);
  return new File([await res.blob()], `${SAMPLE}.xlsx`);
}

const count = (h) => (h ? Object.values(h.wells).reduce((a, r) => a + r.length, 0) : 0);
const f = (x, d = 0) => (x == null ? '—' : x.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function RecordsTable({ records, showWell = true }) {
  const cols = [showWell && 'Well', 'Cycle', 'Steam (t)', 'Oil (bbl)', 'SOR', 'Energy (kWh/bbl)', 'Rod failures'].filter(Boolean);
  return (
    <div className="max-h-64 overflow-auto rounded-xl border border-line">
      <table className="w-full">
        <thead className="sticky top-0 bg-canvas"><tr>{cols.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.well}|${r.cycle}`} className="border-t border-line">
              {showWell && <td className="td font-medium">{r.well}</td>}
              <td className="td">C{r.cycle}</td><td className="td">{f(r.steam)}</td><td className="td">{f(r.oil)}</td>
              <td className="td">{f(r.sor, 2)}</td><td className="td">{f(r.energy, 1)}</td><td className="td">{f(r.failures)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordsUpload({ ctx }) {
  const [pending, setPending] = useState(null); // { file, headers, rows, mapping } awaiting Import
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = async (getFile) => {
    setBusy(true); setError(null);
    try {
      const file = await getFile(), t = await readFile(file);
      setPending({ file: file.name, ...t, mapping: matchColumns(t.headers) });
    } catch (e) { setError(e.message); setPending(null); } finally { setBusy(false); }
  };
  const result = useMemo(() => pending && toCycles(pending.rows, pending.mapping), [pending]);
  const missing = pending ? missingFields(pending.mapping) : [];
  const h = ctx.history;
  const link = (ext) => <a href={`${import.meta.env.BASE_URL}samples/${SAMPLE}.${ext}`} download className="font-medium text-brand-600 hover:underline">{ext.toUpperCase()}</a>;

  return (
    <Card
      title="Historical records" icon={FileSpreadsheet}
      right={
        <div className="flex flex-wrap gap-2">
          <button onClick={() => open(sampleFile)} disabled={busy} className="btn-ghost disabled:opacity-40">Try a sample</button>
          <label className="btn-primary cursor-pointer">
            <Upload size={15} /> Upload records
            <input type="file" accept=".csv,.xlsx,.xls,.pdf" className="sr-only" disabled={busy}
              onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) open(async () => file); }} />
          </label>
        </div>
      }
    >
      <p className="text-sm text-ink-2">
        Past CSS cycles from the pad's spreadsheets and reports: one row per well per cycle, with steam injected and oil produced.
        CSV, XLSX or a digital PDF, up to 10 MB. Download the sample: {link('csv')} · {link('xlsx')} · {link('pdf')}.
      </p>
      {busy && <p className="mt-3 text-sm text-ink-3">Reading the file…</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {pending && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">{pending.file}: match the columns</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FIELDS.map((fd) => (
              <label key={fd.key} className="text-xs text-ink-2">
                {fd.label}{fd.required && ' *'}
                <select
                  value={pending.mapping[fd.key]}
                  onChange={(e) => setPending((p) => ({ ...p, mapping: { ...p.mapping, [fd.key]: +e.target.value } }))}
                  className="mt-1 block w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink"
                >
                  <option value={-1}>— not in file —</option>
                  {pending.headers.map((hd, i) => <option key={i} value={i}>{hd || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0
            ? <p className="text-sm text-amber-800">Pick a column for {missing.join(', ')} to import.</p>
            : <RecordsTable records={result.records} />}
          {missing.length === 0 && result.skipped.length > 0 && (
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer">{result.skipped.length} row{result.skipped.length > 1 ? 's' : ''} skipped</summary>
              <ul className="mt-1 space-y-0.5">{result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { ctx.setHistory(toHistory(pending.file, result.records)); setPending(null); }}
              disabled={missing.length > 0 || !result.records.length} className="btn-primary disabled:opacity-40"
            >Import {missing.length ? '' : `${result.records.length} cycles`}</button>
            <button onClick={() => setPending(null)} className="btn-ghost">Cancel</button>
          </div>
          {h && <p className="text-xs text-ink-3">Importing replaces the {count(h)} cycles loaded from {h.file}.</p>}
        </div>
      )}

      {!pending && h && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span><b>{count(h)} cycles</b> for {Object.keys(h.wells).length} wells from {h.file}{h.sample && ' (synthetic sample)'}, imported {new Date(h.at).toLocaleDateString('en-IN')}.</span>
            <button onClick={() => ctx.setHistory(null)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-red-700"><Trash2 size={13} /> Clear</button>
          </div>
          <p className="text-xs text-ink-3">Switch wells in the header to see each well's history; the CSS backtest now charts it.</p>
          <RecordsTable records={Object.values(h.wells).flat()} />
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Telemetry page** — in `Telemetry.jsx` import `import { RecordsUpload } from '../components/Records';`. Replace the opening of the chart card

```jsx
        <Card tour="telemetry" title="Z-acceleration (g) and jerk" icon={Radio} className="lg:col-span-8" right={<Legend items={[['z accel', VIZ.purple], ['jerk', VIZ.pink]]} />}>
```

with

```jsx
        <div data-tour="telemetry" className="space-y-4 lg:col-span-8">
        <Card title="Z-acceleration (g) and jerk" icon={Radio} right={<Legend items={[['z accel', VIZ.purple], ['jerk', VIZ.pink]]} />}>
```

and the chart card's closing `</Card>` (the one right before `<div className="space-y-4 lg:col-span-4">`) with

```jsx
        </Card>
        <RecordsUpload ctx={ctx} />
        </div>
```

- [ ] **Step 5: Tour step 1 and architecture box**

`Shell.jsx` TOUR[0] `text`:

```js
    text: () => 'The twin runs on what the pad already records: SCADA, VFD, surface dynamometer, wellhead pressures and steam flow. This is a simulated polished-rod vibration stream; spikes flag rod impact. It also ingests the pad\'s historical cycle records: upload a spreadsheet or PDF below, or try the sample.' },
```

`Traceability.jsx:44` box content: `SCADA · VFD · surface dynamometer · THP/CHP · steam mass flow · echometer · flowline T · cycle records (CSV · XLSX · PDF)`.

- [ ] **Step 6: Build and drive it**

Run: `npm run check && npm run build`
Expected: checks pass; build succeeds; `dist/assets/index-*.js` ≤ 1,056 kB; separate `xlsx-*.js`, `pdf-*.js`, `pdf.worker.min-*.mjs` chunks exist.

Then with the API server serving `dist` (repo root: `venv/Scripts/python.exe -m uvicorn api.main:app --port 8000`), in Chrome at `http://localhost:8000/#Telemetry`:
1. Try a sample → mapping dropdowns all pre-filled, 18-row preview, no skipped rows → Import 18 cycles → loaded summary says "(synthetic sample)".
2. Reload the page → records still loaded.
3. Upload `public/samples/sample-cycle-history.pdf` and `.csv` → same 18 rows each.
4. Upload a CSV with header `Steam-Oil Ratio` instead of steam (write one to the scratchpad) → steam dropdown empty, "Pick a column for Steam (t)" shown, Import disabled; pick a column → preview appears.
5. Upload a `.docx` → red error "not supported".
6. Clear → summary gone.
Screenshot steps 1, 4 and 6.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/index.css src/components/Records.jsx src/pages/Telemetry.jsx src/components/Shell.jsx src/pages/Traceability.jsx
git commit -m "Historical records upload on Edge telemetry; tour step 1 and architecture mention it"
```

---

### Task 3: Well pop-up on well switch

**Files:**
- Modify: `frontend/src/components/Records.jsx` (add `WellRecords`)
- Modify: `frontend/src/App.jsx` (lift CSS tab so the pop-up can open the backtest)
- Modify: `frontend/src/pages/CssDesign.jsx:7-19` (tab from ctx)
- Modify: `frontend/src/components/Shell.jsx` (open on pick)

**Interfaces:**
- Consumes: `ctx.history`, `ctx.setHistory`, `sampleFile`, `RecordsTable` (Task 2); `readFile, matchColumns, toCycles, toHistory, markClass` (Task 1).
- Produces: `CSS_TABS` exported from `CssDesign.jsx`; `ctx.cssTab`, `ctx.setCssTab`; `WellRecords({ ctx, go, onClose })`.

- [ ] **Step 1: Lift the CSS tab** — `CssDesign.jsx`: rename `TABS` to `export const CSS_TABS` (update the three uses), and replace `const [tab, setTab] = useState(TABS[0]);` with `const { cssTab: tab, setCssTab: setTab } = ctx;`. Remove `useState` from its import if unused (it is still used by `Design`; keep it). In `App.jsx`: `import CssDesign, { CSS_TABS } from './pages/CssDesign';`, add `const [cssTab, setCssTab] = useState(CSS_TABS[0]);` beside `learnTab`, and `cssTab, setCssTab,` to `ctx`.

- [ ] **Step 2: Add `WellRecords` to `Records.jsx`** — extend imports:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { FileSpreadsheet, Upload, Trash2, X } from 'lucide-react';
import { Card, Avatar, sub, fmt, VIZ, AXIS, GRID } from './ui';
import { CSS_TABS } from '../pages/CssDesign';
```

and append:

```jsx
// Opens when the viewer picks a well: that well's live status and its historical cycles.
export function WellRecords({ ctx, go, onClose }) {
  const { s, well } = ctx;
  const recs = ctx.history?.wells[well.id] ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const trySample = async () => {
    setBusy(true); setError(null);
    try {
      const file = await sampleFile(), t = await readFile(file);
      ctx.setHistory(toHistory(file.name, toCycles(t.rows, matchColumns(t.headers)).records));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const leave = (page) => { onClose(); go(page); };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="well-title" className="card relative max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-ink-3 hover:text-ink" aria-label="Close"><X size={18} /></button>
        <div className="flex items-center gap-3">
          <Avatar text={well.id.slice(-2)} color={well.hue} size={36} />
          <div>
            <h2 id="well-title" className="text-xl font-bold tracking-tight">{well.id}</h2>
            <p className="text-sm text-ink-2 num">Cycle {well.cycle} · day {s.day}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2 num">
          {sub('T_pump')} {Math.round(s.now.Tpump)} °C · μ {fmt.n0(s.now.mu)} cP · FMI {s.fmiMin.fmi.toFixed(2)} · cut-off day {s.cut.day}
        </p>

        <h3 className="mt-5 text-sm font-semibold">Historical CSS cycles</h3>
        {recs.length ? (
          <>
            <p className="mt-1 text-xs text-ink-3">
              {recs.length} completed cycle{recs.length > 1 ? 's' : ''} from {ctx.history.file}{ctx.history.sample && ' (synthetic sample)'}, imported {new Date(ctx.history.at).toLocaleDateString('en-IN')}.
            </p>
            <p className="mt-3 text-xs font-medium text-ink-2">Steam–oil ratio per cycle</p>
            <div className={`h-32 ${markClass(ctx.history)}`}>
              <ResponsiveContainer>
                <BarChart data={recs.map((r) => ({ c: `C${r.cycle}`, sor: r.sor }))} margin={{ top: 14, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="c" {...AXIS} />
                  <YAxis {...AXIS} width={44} />
                  <Tooltip formatter={(v) => v.toFixed(2)} />
                  <RBar dataKey="sor" name="SOR" fill={VIZ.grey} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3"><RecordsTable records={recs} showWell={false} /></div>
            <button onClick={() => { ctx.setCssTab(CSS_TABS[2]); leave('CssDesign'); }} className="mt-4 text-sm font-medium text-brand-600 hover:underline">
              See the counterfactual backtest →
            </button>
          </>
        ) : (
          <div className="mt-2 rounded-xl bg-canvas p-4 text-sm text-ink-2">
            <p>No historical records for {well.id} yet. Upload the pad's cycle spreadsheet or report, or load the sample to see how the twin uses it.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button autoFocus onClick={trySample} disabled={busy} className="btn-primary disabled:opacity-40">{busy ? 'Reading…' : 'Try a sample'}</button>
              <button onClick={() => leave('Telemetry')} className="btn-ghost">Upload records</button>
            </div>
            {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Open it on a user's pick** — in `Shell.jsx` import `import { WellRecords } from './Records';`, add after `const [tips, setTips] = useState(false);`:

```js
  const [wellInfo, setWellInfo] = useState(false);
  const pickWell = (id) => { ctx.selectWell(id); if (tourStep == null) setWellInfo(true); }; // the tour picks wells itself; no pop-up over it
```

Replace `ctx.selectWell(st.well.id); close();` (well picker) and `ctx.selectWell(a.well); close();` (alerts) with `pickWell(st.well.id); close();` and `pickWell(a.well); close();`. Render next to the `AboutData` block:

```jsx
      {wellInfo && <WellRecords ctx={ctx} go={go} onClose={() => setWellInfo(false)} />}
```

- [ ] **Step 4: Build and drive it**

Run: `npm run check && npm run build`. In Chrome at `http://localhost:8000/` with no records loaded (Clear first):
1. Pick BGW-04 in the header → pop-up: BGW-04, cycle 6, status line, empty state. Press Try a sample → table with 5 cycles and SOR chart watermarked "synthetic sample · uploaded".
2. Esc closes; pick BGW-15 → 1 cycle; click the backdrop → closes.
3. Pick BGW-07 → "See the counterfactual backtest →" lands on CSS design with the backtest tab active.
4. Click an alert in the bell menu → pop-up for that well.
5. Start the tour → no pop-up at any step; welcome-modal "Guided tour" (clear `ushna.aboutSeen` in localStorage to see it) → no pop-up.
Screenshot 1, 3.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/pages/CssDesign.jsx src/components/Records.jsx src/components/Shell.jsx
git commit -m "Well pop-up with historical cycles on well switch"
```

---

### Task 4: Backtest from uploaded records

**Files:**
- Modify: `frontend/src/pages/CssDesign.jsx` (`Backtest` + new `UploadedBacktest`)

**Interfaces:**
- Consumes: `ctx.history` (Task 2), `markClass` from `../data/history` (Task 1), `design.best.{sor,steam,soak}` from `twin.js designSpace`.

- [ ] **Step 1: Route to the uploaded view** — pass history: `{tab === CSS_TABS[2] && <Backtest well={ctx.well} design={ctx.design} history={ctx.history} />}`; in `Backtest` add first line:

```jsx
function Backtest({ well, design, history }) {
  const recs = history?.wells[well.id];
  if (recs?.length) return <UploadedBacktest well={well} design={design} history={history} recs={recs} />;
```

(the rest of `Backtest` is unchanged: wells without records keep the synthetic view).

- [ ] **Step 2: Write `UploadedBacktest`** below `Backtest`, and add `import { markClass } from '../data/history';` (`fmt` already imported):

```jsx
// Historical bars are the uploaded cycles. USHNA's SOR is the twin's NPV-optimal design for this
// well; energy and rod failures have no per-cycle counterfactual yet, so only history is drawn.
function UploadedBacktest({ well, design, history, recs }) {
  const data = recs.map((r) => ({ cycle: `C${r.cycle}`, hSor: r.sor, uSor: design.best.sor, hE: r.energy, hF: r.failures }));
  const avg = recs.reduce((a, r) => a + r.sor, 0) / recs.length;
  const charts = [
    ['Steam–oil ratio', 'hSor', 'uSor', (v) => v.toFixed(2)],
    ['Energy per barrel (kWh/bbl)', 'hE', null, (v) => v.toFixed(1)],
    ['Rod failures', 'hF', null, (v) => v],
  ];
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        {well.id}'s uploaded history: {recs.length} cycle{recs.length > 1 ? 's' : ''} at an average SOR of {avg.toFixed(2)}.
        The twin's NPV-optimal design for this well ({fmt.n0(design.best.steam)} t steam, {design.best.soak} d soak) runs at SOR {design.best.sor.toFixed(2)}
        {design.best.sor < avg ? `, ${Math.round((1 - design.best.sor / avg) * 100)}% lower.` : '.'}
      </p>
      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-3 ${markClass(history)}`}>
        {charts.map(([title, h, u, f]) => (
          <Card key={title} title={title} icon={History} right={<Legend items={u ? [['historical', VIZ.grey], ['USHNA', VIZ.pink]] : [['historical', VIZ.grey]]} />}>
            {data.some((d) => d[h] != null) ? (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={2}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="cycle" {...AXIS} />
                    <YAxis {...AXIS} width={44} allowDecimals={h !== 'hF'} />
                    <Tooltip formatter={(v) => f(v)} />
                    <RBar dataKey={h} name="Historical" fill={VIZ.grey} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    {u && <RBar dataKey={u} name="USHNA" fill={VIZ.pink} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="grid h-56 place-items-center text-sm text-ink-3">Not in the uploaded file</p>}
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-3">
        Historical: {history.file}{history.sample && ' (synthetic sample)'}, imported {new Date(history.at).toLocaleDateString('en-IN')}.
        USHNA: SOR of the twin's NPV-optimal cycle design; it maximises NPV, so its SOR can sit above history.
        Energy and rod failures: the twin's per-cycle counterfactual is not modelled yet, so only history is shown.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Build and drive it**

Run: `npm run check && npm run build`. In Chrome, CSS design → Counterfactual backtest:
1. With the sample loaded, BGW-07 → 3 cycles, SOR chart has grey + pink bars, energy and failures grey only, caption names the sample; watermark "synthetic sample · uploaded".
2. Switch to a well, Clear records on Edge telemetry, return → synthetic view with "Illustrative backtest" caption.
3. Upload a CSV with only well, cycle, steam, oil columns → energy and failures cards say "Not in the uploaded file".
Screenshot 1 and 3.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CssDesign.jsx
git commit -m "Counterfactual backtest charts uploaded cycle records"
```

---

### Task 5: Full verification pass

**Files:** none unless a defect is found (fix in the owning file, re-run, commit `Fix: …`).

- [ ] **Step 1:** `npm run check` → both suites pass. `npm run build` → main chunk ≤ 1,056 kB, lazy chunks present.
- [ ] **Step 2:** Repo root: `venv/Scripts/python.exe -m pytest -q` → no regressions (the API serves `dist`, nothing else changed).
- [ ] **Step 3:** Chrome, fresh profile state (clear `ushna.history`, `ushna.aboutSeen`): welcome → Guided tour → step 1 lands on Edge telemetry with the upload card inside the spotlight and the new sentence in the panel → Next through all steps, no pop-up → end tour → pick a well → pop-up → Try a sample → backtest link → uploaded backtest. Record as `historical_records_tour.gif`.
- [ ] **Step 4:** Phone width (390 px): Edge telemetry card and pop-up have no horizontal page scroll; table scrolls inside its box.
- [ ] **Step 5:** Storage blocked: in DevTools console `localStorage.setItem('ushna.history', '{broken')` then reload → app loads, no records, no error.
- [ ] **Step 6:** Report to the user with screenshots and anything that did not pass.
