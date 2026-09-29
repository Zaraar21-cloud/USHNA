import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { FileSpreadsheet, Upload, Trash2, X } from 'lucide-react';
import { Card, Avatar, sub, fmt, VIZ, AXIS, GRID } from './ui';
import { FIELDS, readFile, matchColumns, missingFields, toCycles, toHistory, markClass } from '../data/history';
import { CSS_TABS } from '../pages/CssDesign';

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
      title="Historical Cycle Records" icon={FileSpreadsheet}
      right={
        <div className="flex flex-wrap gap-2">
          <button onClick={() => open(sampleFile)} disabled={busy} className="btn-ghost disabled:opacity-40">Load Sample File</button>
          <label className="btn-primary cursor-pointer">
            <Upload size={15} /> Upload Records
            <input type="file" accept=".csv,.xlsx,.xls,.pdf" className="sr-only" disabled={busy}
              onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) open(async () => file); }} />
          </label>
        </div>
      }
    >
      <p className="text-sm text-ink-2">
        Historical Cyclic Steam Stimulation (CSS) cycles from the well pad's spreadsheets and reports: one row per well per cycle, with steam injected and oil produced.
        Accepted formats: CSV, XLSX or a digital (text-based) PDF, up to 10 MB. Download the sample file: {link('csv')} · {link('xlsx')} · {link('pdf')}.
      </p>
      {busy && <p className="mt-3 text-sm text-ink-3">Reading the file…</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {pending && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">{pending.file}: map the columns</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FIELDS.map((fd) => (
              <label key={fd.key} className="text-xs text-ink-2">
                {fd.label}{fd.required && ' *'}
                <select
                  value={pending.mapping[fd.key]}
                  onChange={(e) => setPending((p) => ({ ...p, mapping: { ...p.mapping, [fd.key]: +e.target.value } }))}
                  className="mt-1 block w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink"
                >
                  <option value={-1}>Not present in file</option>
                  {pending.headers.map((hd, i) => <option key={i} value={i}>{hd || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0
            ? <p className="text-sm text-amber-800">Select a column for {missing.join(', ')} to continue the import.</p>
            : <RecordsTable records={result.records} />}
          {missing.length === 0 && result.skipped.length > 0 && (
            <details className="text-xs text-ink-2">
              <summary className="cursor-pointer">{result.skipped.length} row{result.skipped.length > 1 ? 's' : ''} excluded</summary>
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
          <p className="text-xs text-ink-3">Select a well in the header to view its history; the Counterfactual Backtest tab now charts these records.</p>
          <RecordsTable records={Object.values(h.wells).flat()} />
        </div>
      )}
    </Card>
  );
}

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
            <p className="text-sm text-ink-2 num">Cycle {well.cycle} · Production day {s.day}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2 num">
          {sub('T_pump')} {Math.round(s.now.Tpump)} °C · μ {fmt.n0(s.now.mu)} cP · Float Margin Index {s.fmiMin.fmi.toFixed(2)} · Economic cut-off day {s.cut.day}
        </p>

        <h3 className="mt-5 text-sm font-semibold">Historical Cyclic Steam Stimulation (CSS) Cycles</h3>
        {recs.length ? (
          <>
            <p className="mt-1 text-xs text-ink-3">
              {recs.length} completed cycle{recs.length > 1 ? 's' : ''} from {ctx.history.file}{ctx.history.sample && ' (synthetic sample)'}, imported {new Date(ctx.history.at).toLocaleDateString('en-IN')}.
            </p>
            <p className="mt-3 text-xs font-medium text-ink-2">Steam-Oil Ratio (SOR) per cycle</p>
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
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button autoFocus onClick={onClose} className="btn-primary">Continue</button>
              <button onClick={() => { ctx.setCssTab(CSS_TABS[2]); leave('CssDesign'); }} className="text-sm font-medium text-brand-600 hover:underline">
                View the Counterfactual Backtest →
              </button>
            </div>
          </>
        ) : (
          <div className="mt-2 rounded-xl bg-canvas p-4 text-sm text-ink-2">
            {ctx.history // an upload is loaded: say so, and never offer a one-click overwrite with the sample
              ? <p>{ctx.history.file} has no rows for {well.id}. Upload a file that includes this well to view its history.</p>
              : <p>No historical records are available for {well.id}. Upload the well pad's cycle spreadsheet or report, or load the sample file to see how the digital twin uses it.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {!ctx.history && <button autoFocus onClick={trySample} disabled={busy} className="btn-primary disabled:opacity-40">{busy ? 'Reading…' : 'Load Sample File'}</button>}
              <button autoFocus={!!ctx.history} onClick={() => leave('Telemetry')} className={ctx.history ? 'btn-primary' : 'btn-ghost'}>Upload Records</button>
            </div>
            {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
