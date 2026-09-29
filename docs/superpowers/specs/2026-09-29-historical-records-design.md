# Historical records upload — design

Date: 2026-09-29 · Branch: `feat/edge-stack`

## Goal

The Observation layer claims the twin ingests what the pad already records. Today the only
upload is the Arduino vibration CSV. Add an upload for **historical CSS cycle records**
(CSV, XLSX/XLS, PDF), show each well's records to a judge when they switch wells, and feed
the records into the counterfactual backtest in place of the synthetic cycle history.

Success: a judge on the static demo (no backend) can press "Try a sample", switch wells and
see each well's real rows, open the backtest and see those rows charted, and upload their
own spreadsheet or PDF with the same result.

## Decisions (agreed)

| Question | Decision |
|---|---|
| What the data does | Shown, stored, and drives the backtest's Historical bars |
| Where it is parsed | In the browser, so it works in Local mode and on a static deploy |
| File shape | One row per well per CSS cycle |
| Where the upload lives | Edge telemetry page (tour step 1, Observation layer), not a new page |
| Well switch | Opens a pop-up with that well's records |

## Record schema

| Field | Required | Unit | Header aliases (case, spaces, punctuation ignored) |
|---|---|---|---|
| `well` | yes | id | well, well id, well no, well name |
| `cycle` | yes | int ≥ 1 | cycle, cycle no, css cycle |
| `steam` | yes | t | steam, steam t, steam injected, steam volume, steam tonnes |
| `oil` | yes | bbl | oil, oil bbl, oil produced, cum oil, cumulative oil |
| `energy` | no | kWh/bbl | energy, kwh bbl, energy per bbl, specific energy |
| `failures` | no | count ≥ 0 | rod failures, failures, rod breaks |

`sor = steam · 6.29 / oil` — the same definition as `twin.js` (`designSpace`, `buildState`).

A row is **skipped with a reason** when a required field is blank or non-numeric, `oil ≤ 0`,
`steam < 0`, `cycle` is not a positive integer, or the well id is not one of the six modelled
wells. A repeated (well, cycle) keeps the last row and reports the earlier one as a duplicate.
Row numbers are the spreadsheet's own row numbers; for a PDF they count data rows under the
header. Title rows above the header are ignored: the header is the first row where at least
two fields match. Blank or invalid optional values become empty, not skipped rows.

## Units

### `frontend/src/data/history.js` — pure, no React

- `readFile(file) → Promise<{ headers, rows }>` — dispatch on extension. `.csv .xlsx .xls`
  via SheetJS (first sheet, first non-empty row = headers). `.pdf` via pdf.js: text items
  grouped into lines by y, columns split at x-gaps aligned to the header line. Rejects files
  over 10 MB and other extensions. A PDF with no text layer fails with
  "No text found — scanned PDFs are not supported; export the table as CSV or XLSX".
- `matchColumns(headers) → { well, cycle, … }` — header index per field, or `-1`.
- `toCycles(rows, mapping) → { records, skipped: [{ row, reason }] }`.
- `byWell(records) → { [wellId]: record[] }` sorted by cycle.
- SheetJS and pdf.js are loaded with dynamic `import()` on first use, so the main bundle does
  not grow. SheetJS is installed from the official CDN tarball (`cdn.sheetjs.com`); the npm
  `xlsx` package is unmaintained and has published advisories.

### State — `App.jsx`

`history` (`{ [wellId]: record[] }`, plus `meta: { file, at }`) lives in `ctx` with
`setHistory` and `clearHistory`. Persisted to `localStorage` key `ushna.history`, every
access in `try/catch`; the app renders normally when storage is blocked.

### Upload card — `Telemetry.jsx`

A "Historical records" card beside the vibration chart:
- **Upload records** (CSV/XLSX/PDF) and **Try a sample** (loads the bundled sample through
  the same `readFile` path as an upload), plus download links for the three sample files.
- Column mapping: one dropdown per field, pre-filled by `matchColumns`; required fields left
  unmatched block the import with a message.
- Preview table (well · cycle · steam · oil · SOR · energy · failures), a line listing
  skipped rows with reasons, **Import** and **Clear**.

The Telemetry page's existing subtitle and CSV-bridge upload are unchanged.

### Well pop-up — `Shell.jsx`

Opens when the user picks a well from the header picker or from an alert. It does not open
when the tour or welcome modal select a well. Closes on ×, Esc or backdrop click.
- Header: well avatar, id, cycle, day; one status line — T_pump, μ, FMI, cut-off day.
- Records for that well: table plus a small SOR-per-cycle bar chart, file name and upload time,
  and "See the counterfactual backtest →" (CSS design, Counterfactual backtest tab).
- No records for that well: short explanation with **Try a sample** and **Upload records**
  (goes to Edge telemetry).

### Backtest — `CssDesign.jsx`

When `history[well.id]` has records:
- Historical bars = uploaded `sor`, `energy`, `failures`, one bar per uploaded cycle.
- USHNA SOR = `design.best.sor` (the twin's NPV-optimal cycle design for this well). It
  maximises NPV, not SOR, so for some wells it sits above history; the text states the
  numbers either way.
- Energy and rod failures: historical bars only; note "Twin counterfactual not modelled per
  cycle yet". A chart whose field is absent from the upload says "Not in the uploaded file".
- Caption: "From `<file>` · N cycles uploaded <date>" in place of the "Illustrative" line.

Wells without records keep the current synthetic view and its "Illustrative" caption.

### Tour and architecture

- Tour step 1 ("The data coming in") text adds: "It also ingests the pad's historical cycle
  records: upload a spreadsheet or PDF here, or try the sample." The spotlight target wraps
  both cards. The tour does not gain a step.
- Traceability → Observation layer box adds "cycle records (CSV · XLSX · PDF)".

### Sample files — `frontend/public/samples/`

`sample-cycle-history.csv`, `.xlsx`, `.pdf` with identical content: all six wells, each with
`well.cycle − 1` completed cycles (18 rows), values in the ranges the twin produces (SOR
roughly 6.5–10, energy 19–24 kWh/bbl, failures 0–3). The PDF has a digital text layer with a
title line, a real table and a page footer. A script `frontend/scripts/make-samples.mjs`
generates all three from one array so they can't drift.

Charts carry a provenance watermark (`index.css`). Charts of uploaded records say
"uploaded records"; when the file is the synthetic sample (name starts `sample-cycle-history`)
they say "synthetic sample", so no screenshot of the sample can pass for field data.

## Testing

- `frontend/src/data/history.check.mjs`, run by `npm run check`: all three samples parse to
  identical records; alias matching on messy headers; each skip reason; duplicate handling;
  file-size and extension rejection.
- `npm run build` passes and the main chunk does not include SheetJS or pdf.js.
- Driven in Chrome: Try a sample → switch each well and see its pop-up → backtest shows
  uploaded bars and caption → upload the XLSX and PDF samples → remap a renamed column by hand
  → Clear returns the synthetic view → the tour's first step shows the upload card and the
  tour switching wells opens no pop-up. Screenshots of each.

## Out of scope

Daily production logs, scanned-PDF OCR, server-side parsing or storage, EnKF calibration from
uploaded records, per-cycle counterfactuals for energy and rod failures.
