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
