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
