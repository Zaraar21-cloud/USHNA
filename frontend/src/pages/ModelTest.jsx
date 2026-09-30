import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ReferenceDot } from 'recharts';
import { SlidersHorizontal, FlaskConical, Droplets, TrendingDown, Brain, Loader2, RotateCcw } from 'lucide-react';
import { Card, Badge, Legend, VIZ, AXIS, GRID, fmt } from '../components/ui';
import { FIELD, viscosity } from '../data/twin';
import { studio, studioDefaults, refitWalther, designCount, PRESETS, MID_DAY, BOUNDS } from '../data/studio';
import { AI, pinn } from '../data/ml';

// Model Test: the viewer sets the well's input conditions, the CSS design search returns a recommended design.
// Ranges are the physics' bounds (BOUNDS); the slider steps coarsely, the box takes any value inside them.
const CONTROLS = [
  { key: 'mu', label: 'Crude viscosity at reservoir temperature', step: 100, unit: 'cP', digits: 0 },
  { key: 'T_R', label: 'Reservoir temperature', step: 0.5, unit: '°C', digits: 1 },
  { key: 'boiler', label: 'Boiler capacity (maximum steam volume)', step: 250, unit: 't', digits: 0 },
  { key: 'oilPrice', label: 'Oil price', step: 100, unit: '₹/bbl', digits: 0 },
  { key: 'steamCost', label: 'Steam cost', step: 50, unit: '₹/t', digits: 0 },
];

const thin = (muRes, mu) => muRes / mu;
const sign = (x, f) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${f(Math.abs(x))}`;

export default function ModelTest({ ctx }) {
  const { well } = ctx;
  const [inp, setInp] = useState(studioDefaults);
  const [res, setRes] = useState(() => studio(well, studioDefaults()));
  const [busy, setBusy] = useState(false);
  useEffect(() => { // debounced: dragging a slider searches once it settles
    setBusy(true);
    const t = setTimeout(() => { setRes(studio(well, inp)); setBusy(false); }, 250);
    return () => clearTimeout(t);
  }, [well, inp]);
  const set = (k, v) => setInp((p) => ({ ...p, [k]: v }));
  const { design: d, current: c, muRes } = res;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <Badge tone="info">Test environment</Badge>
        <span>Results here do not change {well.id}'s setpoints or the audit log. Each result is compared with the well's current practice: {fmt.n0(well.steam)} t steam, {well.soak}-day soak, {well.spm} strokes per minute (SPM).</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Input Conditions" icon={SlidersHorizontal}>
          <div className="space-y-4">
            {CONTROLS.map((k) => (
              <Control key={k.key} k={k} value={inp[k.key]} onChange={(v) => set(k.key, v)}>
                {k.key === 'mu' && <span className="text-xs text-ink-3 num">≈ {fmt.n0(viscosity(50, refitWalther(inp.mu, inp.T_R)))} cP at 50 °C (Oil India published range: 10,000–13,000 cP)</span>}
              </Control>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([name, p]) => (
              <button key={name} onClick={() => setInp({ ...studioDefaults(), ...p })} className="btn-ghost !px-3 !py-1.5 text-xs">{name}</button>
            ))}
            <button onClick={() => setInp(studioDefaults())} className="btn-ghost !px-3 !py-1.5 text-xs"><RotateCcw size={13} /> Reset to Well Values</button>
          </div>
          <p className="mt-3 text-xs text-ink-3">Heavier crude scenario: {fmt.n0(PRESETS['Heavier Crude Scenario'].mu)} cP at reservoir temperature. Low steam cost scenario: ₹{fmt.n0(PRESETS['Low Steam Cost Scenario'].steamCost)}/t.</p>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <p aria-live="polite" className={`flex items-center gap-2 text-xs text-ink-3 ${busy ? '' : 'invisible'}`}>
            <Loader2 size={13} className="animate-spin" /> Evaluating {designCount(inp.boiler)} designs…
          </p>
          <div className={`grid grid-cols-1 gap-4 md:grid-cols-3 transition-opacity ${busy ? 'opacity-60' : ''}`}>
            <Card title="Recommended Design" icon={FlaskConical}>
              <Row label="Steam volume" value={`${fmt.n0(d.steam)} t`} delta={sign(d.steam - c.steam, fmt.n0) + ' t'} cur={`${fmt.n0(c.steam)} t`} />
              <Row label="Soak time" value={`${d.soak} days`} delta={sign(d.soak - c.soak, (x) => x) + ' d'} cur={`${c.soak} d`} />
              <Row label="Production until" value={`day ${d.cutDay}`} delta={sign(d.cutDay - c.cutDay, (x) => x) + ' d'} cur={`day ${c.cutDay}`} />
              <Row label="Steam re-injection on" value={`day ${d.reinject}`} delta={sign(d.reinject - c.reinject, (x) => x) + ' d'} cur={`day ${c.reinject}`} />
              <p className="mt-2 text-xs text-ink-3">Re-injection day is counted from the start of steam injection: {FIELD.tInj} days of injection, then soak, then production.</p>
            </Card>

            <Card title="Effect on Crude Viscosity" icon={Droplets}>
              <Row label="Viscosity at reservoir temperature" value={`${fmt.n0(muRes)} cP`} />
              {[0, MID_DAY, d.cutDay].map((day) => (
                <div key={day} className="border-b border-line py-2.5 last:border-0">
                  <div className="flex items-baseline justify-between">
                    <span className="label">At pump intake, day {day}</span>
                    <span className="num text-sm text-ink-2">{fmt.n0(d.mu[day])} cP</span>
                  </div>
                  <div className="num text-2xl font-bold tracking-tight">{fmt.n1(thin(muRes, d.mu[day]))}× reduction</div>
                  <div className="num text-xs text-ink-3">Current practice: {fmt.n1(thin(muRes, c.mu[day]))}× reduction</div>
                </div>
              ))}
              <Row label="Heated-zone radius" value={`${fmt.n1(d.rh)} m`} delta={sign(d.rh - c.rh, fmt.n1) + ' m'} cur={`${fmt.n1(c.rh)} m`} />
            </Card>

            <Card title="Production and Economic Outcomes" icon={TrendingDown}>
              <Row label="Cumulative oil per cycle" value={`${fmt.n0(d.oil)} bbl`} delta={sign(d.oil - c.oil, fmt.n0) + ' bbl'} cur={`${fmt.n0(c.oil)} bbl`} good={d.oil >= c.oil} />
              <Row label="Steam-Oil Ratio (SOR)" value={fmt.n2(d.sor)} delta={sign(d.sor - c.sor, fmt.n2)} cur={fmt.n2(c.sor)} good={d.sor <= c.sor} />
              <Row label="Cycle Net Present Value (NPV)" value={fmt.lakh(d.npv)} delta={sign((d.npv - c.npv) / 1e5, fmt.n1) + ' L'} cur={fmt.lakh(c.npv)} good={d.npv >= c.npv} />
              <Row label={`Maximum safe SPM, day ${MID_DAY}`} value={fmt.n1(d.spmMax)} delta={sign(d.spmMax - c.spmMax, fmt.n1)} cur={fmt.n1(c.spmMax)} good={d.spmMax >= c.spmMax} />
              <Row label={`Minimum Float Margin Index, day ${MID_DAY} at ${well.spm} SPM`} value={d.fmiMin.toFixed(3)} delta={sign(d.fmiMin - c.fmiMin, (x) => x.toFixed(3))} cur={c.fmiMin.toFixed(3)} good={d.fmiMin >= c.fmiMin} />
            </Card>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ViscosityChart d={d} c={c} muRes={muRes} />
        <ReturnsChart curve={res.curve} best={d} />
      </div>

      <PinnStrip designs={res.designs} ms={res.ms} />

      <p className="text-xs text-ink-3">
        Computed live by the USHNA physics engine in your browser; PINN figures from its last training run ({pinn.trained_at}).
        Viscosity anchored to Oil India's published Baghewala value of 10,000–13,000 cP at 50 °C.
      </p>
    </div>
  );
}

// Slider + typed value. A typed value applies only once it is a number inside BOUNDS; until then the
// box shows what was typed, flagged, and the search keeps the last valid value.
function Control({ k, value, onChange, children }) {
  const [lo, hi] = BOUNDS[k.key];
  const [draft, setDraft] = useState(null); // text being typed; null = show the applied value
  const ok = (s) => s.trim() !== '' && +s >= lo && +s <= hi;
  const id = `studio-${k.key}`;
  return (
    <div>
      <label htmlFor={id} className="text-[13px] text-ink-2">{k.label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range" min={lo} max={hi} step={k.step} value={value} aria-label={`${k.label} slider`}
          onChange={(e) => { setDraft(null); onChange(+e.target.value); }} className="min-w-0 flex-1 accent-brand-500"
        />
        <input
          id={id} type="number" inputMode="decimal" min={lo} max={hi} step="any"
          value={draft ?? String(+value.toFixed(k.digits))} aria-invalid={draft != null && !ok(draft)}
          onChange={(e) => { setDraft(e.target.value); if (ok(e.target.value)) onChange(+e.target.value); }}
          onBlur={() => setDraft(null)}
          className={`num w-24 rounded-lg border bg-white px-2 py-1 text-right text-sm font-semibold ${draft != null && !ok(draft) ? 'border-red-400 text-red-700' : 'border-line'}`}
        />
        <span className="w-10 text-xs text-ink-3">{k.unit}</span>
      </div>
      {draft != null && !ok(draft)
        ? <p className="text-xs text-red-700 num">Enter {fmt.n0(lo)}–{fmt.n0(hi)} {k.unit}</p>
        : children}
    </div>
  );
}

function Row({ label, value, delta, cur, good }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <span className="label">{label}</span>
      <span className="text-right">
        <span className="num block text-sm font-semibold">{value}</span>
        {cur != null && (
          <span className="num block text-xs text-ink-3">
            <span className={good == null ? '' : good ? 'text-emerald-600' : 'text-red-600'}>{delta}</span> vs {cur}
          </span>
        )}
      </span>
    </div>
  );
}

// Chart A: μ at the pump over the cycle, log scale, each line starting at reservoir viscosity when injection begins.
function ViscosityChart({ d, c, muRes }) {
  const start = (s) => -(FIELD.tInj + s.soak);
  const byX = new Map();
  const put = (x, k, v) => byX.set(x, { ...byX.get(x), x, [k]: v });
  put(start(d), 'd', muRes); put(start(c), 'c', muRes);
  d.mu.forEach((m, p) => { put(p, 'd', m); put(p, 'c', c.mu[p]); });
  const data = [...byX.values()].sort((a, b) => a.x - b.x);
  return (
    <Card title="Pump-Intake Viscosity over the Cycle" icon={Droplets} right={<Legend items={[['Recommended design', VIZ.pink], ['Current practice', VIZ.grey], ['Reservoir viscosity', VIZ.purple, true]]} />}>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="x" type="number" domain={[Math.min(start(d), start(c)), FIELD.horizon]} {...AXIS} />
            <YAxis scale="log" domain={['auto', 'auto']} allowDataOverflow {...AXIS} width={56} tickFormatter={(v) => fmt.n0(v)} />
            <Tooltip formatter={(v) => `${fmt.n0(v)} cP`} labelFormatter={(l) => (l < 0 ? `${-l} days before production` : `Production day ${l}`)} />
            <ReferenceArea x1={Math.min(start(d), start(c))} x2={0} fill="#F5F1FF" label={{ value: 'Injection and soak', position: 'insideTop', fontSize: 11, fill: '#8C8C9A' }} />
            <ReferenceLine y={muRes} stroke={VIZ.purple} strokeDasharray="5 4" />
            <Line dataKey="c" name="Current practice" stroke={VIZ.grey} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="d" name="Recommended design" stroke={VIZ.pink} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-ink-3">Logarithmic scale. Steam injection reduces crude viscosity by more than an order of magnitude; as the heated zone cools, viscosity rises back toward the reservoir value.</p>
    </Card>
  );
}

// Chart B: more steam, less and less thinning, rising SOR. This is why an optimizer rather than "use more steam".
function ReturnsChart({ curve, best }) {
  const opt = curve.find((p) => p.steam === best.steam);
  return (
    <Card title={`Diminishing Returns on Steam Volume (${best.soak}-day soak)`} icon={TrendingDown} right={<Legend items={[[`Viscosity at pump, day ${MID_DAY}`, VIZ.blue], ['Steam-Oil Ratio', VIZ.orange]]} />}>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={curve} margin={{ top: 16, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="steam" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={(v) => `${v / 1000}k`} />
            <YAxis yAxisId="mu" {...AXIS} width={52} tickFormatter={(v) => fmt.n0(v)} />
            <YAxis yAxisId="sor" orientation="right" {...AXIS} width={40} domain={['auto', 'auto']} />
            <Tooltip formatter={(v, n) => (n === 'SOR' ? fmt.n2(v) : `${fmt.n0(v)} cP`)} labelFormatter={(l) => `${fmt.n0(l)} t of steam`} />
            <ReferenceLine yAxisId="mu" x={best.steam} stroke="#16161D" strokeDasharray="2 3" />
            <Line yAxisId="mu" dataKey="mu" name={`μ day ${MID_DAY}`} stroke={VIZ.blue} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            <Line yAxisId="sor" dataKey="sor" name="SOR" stroke={VIZ.orange} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            {opt && <ReferenceDot yAxisId="mu" x={opt.steam} y={opt.mu} r={6} fill={VIZ.pink} stroke="#fff" label={{ value: 'Optimum', position: 'top', fontSize: 12, fill: VIZ.pink }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-ink-3">Doubling the steam volume does not halve the viscosity: the viscosity curve flattens while the Steam-Oil Ratio continues to rise.</p>
    </Card>
  );
}

// The trained PINN's own numbers, read from ushna/ml/artifacts/pinn_training.json.
function PinnStrip({ designs, ms }) {
  const p = AI.pinn;
  const secs = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
  const stats = [
    ['PINN surrogate, one thermal field', `${fmt.n1(p.pinnMs)} ms`],
    ['Finite-volume solver, same field', `${fmt.n0(p.solverMs)} ms`],
    ['Speed-up', `${fmt.n1(p.speedup)}×`],
    ['Validation RMSE, designs excluded from training', `${fmt.n2(p.rmse)} °C`, `release limit ${fmt.n1(p.rmseLimit)} °C`],
    ['Energy audit', p.auditPassed ? 'PASSED' : 'FAILED', `max imbalance ${fmt.n2(p.audit)}% (limit ${p.auditLimit}%)`],
  ];
  return (
    <Card title="Trained Thermal Surrogate (PINN)" icon={Brain}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map(([label, value, note]) => (
          <div key={label}>
            <div className="label">{label}</div>
            <div className={`num text-lg font-semibold ${label === 'Energy audit' ? (p.auditPassed ? 'text-emerald-600' : 'text-red-600') : ''}`}>{value}</div>
            {note && <div className="text-xs text-ink-3">{note}</div>}
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-2">
        The optimizer evaluated {designs} designs, each requiring a thermal field: {secs(designs * p.solverMs)} with the finite-volume solver,
        {' '}{secs(designs * p.pinnMs)} with the trained surrogate. This in-browser test uses the digital twin's closed-form heated-zone model, so the complete search took {secs(ms)}.
      </p>
    </Card>
  );
}
