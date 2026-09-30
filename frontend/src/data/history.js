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

// Column index per field, or -1. Exact alias matches win over prefix matches (≥ 5 chars).
// Ratios never match; nor, by prefix, do dates, temperatures, durations, rates or costs
// ('Steaming start date', 'Steam temperature', 'Cycle days', 'Energy cost').
const NOT_A_PREFIX_MATCH = /date|start|end|temp|time|day|hour|rate|cost|price|pressure/;
export function matchColumns(headers) {
  const h = headers.map(norm), used = new Set();
  const out = Object.fromEntries(FIELDS.map((f) => [f.key, -1]));
  for (const exact of [true, false]) {
    for (const f of FIELDS) {
      if (out[f.key] >= 0) continue;
      const i = h.findIndex((x, j) => !used.has(j) && x && !x.includes('ratio') && (exact || !NOT_A_PREFIX_MATCH.test(x))
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

const hits = (l) => Object.values(matchColumns(l)).filter((i) => i >= 0).length;

// Header = first line where ≥ 2 fields match, else the first line with ≥ 2 cells. Title rows above it are dropped.
function headerIndex(lines) {
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

// Reads the first visible sheet with a recognisable table (so hidden lookup sheets and cover
// sheets are passed over), else the first visible sheet with data.
export function rowsFromSheet(data, XLSX) {
  const wb = XLSX.read(data, { type: 'array' });
  const sheets = wb.SheetNames.map((name, i) => ({ ws: wb.Sheets[name], hidden: wb.Workbook?.Sheets?.[i]?.Hidden }))
    .filter((s) => !s.hidden && s.ws?.['!ref'])
    .map(({ ws }) => ({ ws, lines: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: true }) }));
  if (!sheets.length) throw new Error('The workbook has no visible sheet with data');
  const { ws, lines } = sheets.find((s) => s.lines.some((l) => hits(l) >= 2)) ?? sheets[0];
  return table(lines, XLSX.utils.decode_range(ws['!ref']).s.r + 1); // row numbers match the spreadsheet
}

export async function pdfItems(data, pdfjs) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise, out = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const { items } = await (await doc.getPage(p)).getTextContent();
      for (const i of items) if (i.str?.trim()) out.push({ str: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height, page: p });
    }
  } finally { await task.destroy(); }
  if (!out.length) throw new Error('No text found: scanned PDFs are not supported; export the table as CSV or XLSX');
  return out;
}

// Text items → lines (same page, y within 3 pt) → cells. Header words closer than a word gap
// merge into one header. Each item goes to the header it overlaps most; an item under no header
// (right-aligned numbers below left-aligned headers, as Excel exports) goes to the column whose
// header starts last before its right edge.
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
  const head = [];
  for (const i of lines[h].items) {
    const p = head.at(-1);
    if (p && i.x - (p.x + p.w) < 0.5 * (i.h || 9)) { p.str += ` ${i.str}`; p.w = i.x + i.w - p.x; } else head.push({ ...i });
  }
  const cols = head.map((i) => [i.x, i.x + i.w]);
  const cellsOf = (l) => {
    const cells = cols.map(() => []);
    for (const i of l.items) {
      const a = i.x, b = i.x + i.w;
      const overlap = cols.map(([x0, x1]) => Math.min(b, x1) - Math.max(a, x0));
      let k = overlap.indexOf(Math.max(...overlap));
      if (overlap[k] <= 0) k = Math.max(0, cols.findLastIndex(([x0]) => x0 <= b - 0.5));
      cells[k].push(i.str);
    }
    return cells.map((c) => c.join(' '));
  };
  const grid = lines.slice(h).map((l, i) => (i === 0 ? head.map((x) => x.str) : cellsOf(l)))
    .filter((c, i) => i === 0 || c.filter(Boolean).length >= 2); // drops page footers and stray one-cell lines
  return table(grid, 0); // PDF rows are numbered from 1 under the header
}

// Legacy build: the modern one calls 2025-era APIs (Uint8Array#toHex, Map#getOrInsertComputed) and
// fails on any browser a year old. It is lazy-loaded, so its extra size costs nothing up front.
export const pdfLib = () => import('pdfjs-dist/legacy/build/pdf.mjs');

export async function readFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (!EXTS.includes(ext)) throw new Error(`.${ext} files are not supported: use CSV, XLSX, XLS or PDF`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB`);
  const data = await file.arrayBuffer();
  if (ext !== 'pdf') return rowsFromSheet(data, await import('xlsx'));
  const [pdfjs, { default: worker }] = await Promise.all([pdfLib(), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return rowsFromPdfItems(await pdfItems(data, pdfjs));
}

export const markClass = (h) => (h?.sample ? 'mark-sample' : 'mark-uploaded'); // chart watermark (index.css)

// Dates shown as dd-mm-yyyy.
export const dmy = (d) => new Date(d).toLocaleDateString('en-GB').replaceAll('/', '-');
export const toHistory = (file, records) => ({ file, at: new Date().toISOString(), sample: /^sample-cycle-history/.test(file), wells: byWell(records) });

// Every stored record must be renderable, or nothing loads: a bad value must not blank the app.
const okRecord = (r) => r && typeof r === 'object' && typeof r.well === 'string' && ['cycle', 'steam', 'oil', 'sor'].every((k) => Number.isFinite(r[k]));
export function parseStored(text) {
  try {
    const h = JSON.parse(text);
    const ok = h && typeof h.file === 'string' && h.wells && typeof h.wells === 'object' && !Array.isArray(h.wells)
      && Object.values(h.wells).every((rs) => Array.isArray(rs) && rs.every(okRecord));
    return ok ? h : null;
  } catch { return null; }
}
