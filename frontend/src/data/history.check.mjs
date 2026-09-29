// Run: npm run check — historical records: the three sample formats agree, messy headers map,
// bad rows are reported rather than dropped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { matchColumns, missingFields, toCycles, byWell, rowsFromSheet, pdfItems, rowsFromPdfItems, readFile, toHistory, parseStored, markClass, pdfLib } from './history.js';
import { makePdf } from '../../scripts/pdf.mjs';

const pdfjs = await pdfLib(); // the build the browser loads; must run on engines older than 2025

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
// Prefix matches skip dates, temperatures, durations and costs that happen to start with a field name
assert.equal(matchColumns(['Well', 'Cycle', 'Steaming start date', 'Steam qty (MT)', 'Oil (bbl)']).steam, 3, 'a date column is not steam');
assert.equal(matchColumns(['Well', 'Cycle', 'Steam temperature (°C)', 'Steam qty (MT)', 'Oil (bbl)']).steam, 3, 'a temperature column is not steam');
assert.equal(matchColumns(['Well', 'Cycle days', 'Cycle no. (CSS)', 'Steam', 'Oil']).cycle, 2, 'cycle length is not cycle number');
assert.equal(matchColumns(['Well', 'Cycle', 'Steam', 'Oil', 'Energy cost (Rs)', 'Specific energy (kWh/bbl)']).energy, 5, 'a cost is not energy');

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

// PDF as Excel exports it: left-aligned headers over right-aligned numbers, and a header split into words
const left = rowsFromPdfItems([
  it('Well', 40, 780, 20), it('Cycle', 140, 780, 25), it('Steam', 240, 780, 22), it('injected', 264.5, 780, 30), it('(t)', 297, 780, 10),
  it('Oil (bbl)', 340, 780, 35), it('Energy', 440, 780, 30),
  it('BGW-07', 40, 764, 35), it('1', 227, 764, 5), it('2,600', 309, 764, 23), it('12,081', 403, 764, 29), it('21.5', 514, 764, 18),
]);
assert.deepEqual(left.headers, ['Well', 'Cycle', 'Steam injected (t)', 'Oil (bbl)', 'Energy']);
assert.deepEqual(left.rows.map((r) => r.cells), [['BGW-07', '1', '2,600', '12,081', '21.5']]);

// Workbook: a hidden first sheet and a cover sheet are passed over for the first visible sheet with a table
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Well', 'Cycle', 'Steam (t)', 'Oil (bbl)'], ['BGW-04', 9, 1, 1]]), 'Old');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Prepared by', 'Field office'], ['Date', '2026-01-05']]), 'Cover');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Well', 'Cycle', 'Steam (t)', 'Oil (bbl)'], ['BGW-07', 1, 2500, 2000]]), 'Data');
wb.Workbook = { Sheets: [{ Hidden: 1 }, { Hidden: 0 }, { Hidden: 0 }] };
const multi = rowsFromSheet(bytes(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), XLSX);
assert.deepEqual(multi.rows.map((r) => r.cells), [['BGW-07', 1, 2500, 2000]], 'reads the Data sheet');

// Scanned PDF (no text layer), wrong type, too big
await assert.rejects(pdfItems(bytes(makePdf([])), pdfjs), /scanned PDFs are not supported/);
await assert.rejects(readFile({ name: 'notes.docx', size: 100 }), /not supported/);
await assert.rejects(readFile({ name: 'BIG.XLSX', size: 11 * 1024 * 1024 }), /limit is 10 MB/);

// Stored state: anything malformed is ignored
for (const bad of [null, 'not json', '{"x":1}', '[]']) assert.equal(parseStored(bad), null, String(bad));
for (const wells of ['[null]', 'null', '"x"', '[{"well":"BGW-07","cycle":1,"steam":1,"oil":1}]', '[{"cycle":1,"steam":1,"oil":1,"sor":6.29}]']) {
  const text = `{"file":"a","wells":{"BGW-07":${wells}}}`;
  assert.equal(parseStored(text), null, text); // a record the UI cannot render never reaches it
}
const h = toHistory('sample-cycle-history.xlsx', out.csv.records);
assert.equal(h.sample, true);
assert.equal(toHistory('field.xlsx', []).sample, false);
assert.deepEqual(parseStored(JSON.stringify(h)), h);
assert.equal(markClass(h), 'mark-sample');
assert.equal(markClass(toHistory('field.xlsx', [])), 'mark-uploaded');

console.log('history checks passed');
