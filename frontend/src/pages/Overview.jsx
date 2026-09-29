import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, LabelList,
} from 'recharts';
import { Thermometer, Gauge, Droplet, ShieldAlert, Activity, Download, Search, Flame, ArrowDown, BookOpen, SlidersHorizontal, ShieldCheck, RotateCcw } from 'lucide-react';
import { PageHeader, Card, StatRow, Avatar, sub, Toggle, Bar, Status, VIZ, AXIS, GRID, fmt, toneOf, Legend } from '../components/ui';
import RecCard from '../components/RecCard';
import { AiStrip } from './Learning';
import { FIELD, buildState, envelope } from '../data/twin';
import { Slider } from './SrpControl';

export default function Overview({ ctx }) {
  const [tab, setTab] = useState('Overview');
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${FIELD.field}, Rajasthan: 6 of 35 wells modelled. Pump-intake temperature, the resulting crude viscosity, and rod-string safety at the current pumping speed.`}
        tabs={['Overview', 'Fleet Operating Envelope']}
        tab={tab}
        onTab={setTab}
      />
      {tab === 'Overview' ? <OverviewTab ctx={ctx} /> : <FleetTab ctx={ctx} />}
    </>
  );
}

function OverviewTab({ ctx }) {
  const { s, well, recs } = ctx;
  const [view, setView] = useState('Current');
  const r = view === 'Current' ? s.now : s.ahead;

  const download = () => {
    const blob = new Blob([JSON.stringify({ well: well.id, day: s.day, setpoint: s.sp, state: r, cutoff: s.cut, mpc: s.mpc }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${well.id}-day${s.day}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <FieldCard sources={ctx.sources} />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Machine Learning Layer: Trained Models Supporting the Digital Twin</h2>
          <button onClick={() => ctx.go('Learning')} className="text-sm font-medium text-brand-600 hover:underline">View Learning Layers</button>
        </div>
        <AiStrip onPick={(t) => { ctx.setLearnTab(t); ctx.go('Learning'); }} />
      </section>

      {/* Summary header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar text={well.id.slice(-2)} color={well.hue} size={34} />
          <div>
            <h2 className="text-lg font-semibold">{well.id} Digital Twin</h2>
            <p className="text-xs text-ink-3">Cycle {well.cycle} · Production day {s.day} · Strokes per minute (SPM) {s.sp.spm.toFixed(1)} · Downstroke speed {Math.round(s.sp.down * 100)}%</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Toggle options={['Current', '48-Hour Projection']} value={view} onChange={setView} />
          <button onClick={download} className="flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
            <Download size={15} /> Download State (JSON)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CouplingCard s={s} r={r} view={view} />
        <ControlCard ctx={ctx} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EconomicsCard s={s} />
        <EnthalpyCard s={s} r={r} />
      </div>

      <TrajectoryCard s={s} />

      {recs[0] && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Priority Recommendation</h2>
            <button onClick={() => ctx.go('Recommendations')} className="text-sm font-medium text-brand-600 hover:underline">
              View all {recs.length} recommendations
            </button>
          </div>
          <RecCard rec={recs[0]} wellId={well.id} onApply={ctx.submit} />
        </div>
      )}

      <WellsTable ctx={ctx} />
    </div>
  );
}

function FieldCard({ sources }) {
  return (
    <Card title="Field Calibration Data and Sources" icon={BookOpen} right={<span className="text-xs text-ink-3">Synthetic wells calibrated to published values</span>}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map(([k, v, src, edited]) => (
          <div key={k} className="border-l-2 border-amber-300 pl-3">
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="text-sm font-semibold">{v}{edited && <span className="ml-1 text-[10px] font-normal text-brand-600">edited</span>}</dd>
            <dd className="text-xs text-ink-2">{src}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function CouplingCard({ s, r, view }) {
  const fmiTone = toneOf(s.fmiMin.fmi, FIELD.fmiLimit);
  return (
    <Card title="Thermal–Mechanical Coupling Chain" icon={Activity} right={<span className="text-xs text-ink-3">{view === 'Current' ? 'Measured, with EnKF update' : 'Projection (Ramey thermal lag)'}</span>}>
      <StatRow icon={Flame} label="Mean heated-zone temperature T̄" value={fmt.n0(r.Tbar)} unit="°C" />
      <Arrow />
      <StatRow icon={Thermometer} label="Pump-intake temperature T_pump" value={fmt.n0(r.Tpump)} unit="°C" tone={r.Tpump < FIELD.T_onset ? 'warn' : undefined} />
      <Arrow />
      <StatRow icon={Droplet} label="Crude viscosity μ(T_pump)" value={fmt.n0(r.mu)} unit="cP" />
      <Arrow />
      <StatRow icon={ShieldAlert} label={`Minimum Float Margin Index (at ${s.fmiMin.z} m)`} value={fmt.n2(s.fmiMin.fmi)} tone={fmiTone} />
      <StatRow icon={Gauge} label="Maximum safe SPM, (S·N)max" value={s.spmMax.toFixed(1)} unit={`setpoint ${s.sp.spm.toFixed(1)}`} tone={s.sp.spm > s.spmMax ? 'crit' : 'ok'} />
    </Card>
  );
}
const Arrow = () => <div className="-my-1 flex pl-[9px]"><ArrowDown size={10} className="text-ink-3" /></div>;

// [label, value, format, format |Δ|, +1 if higher is better / −1 if lower is better]
const DELTAS = [
  ['Minimum Float Margin Index', (x) => x.fmiMin.fmi, fmt.n2, fmt.n2, 1],
  ['Economic cut-off day', (x) => x.cut.day, (v) => `day ${v}`, (d) => `${d} d`, 1],
  ['Steam-Oil Ratio (SOR) at cut-off', (x) => x.sorAtCut, fmt.n2, fmt.n2, -1],
  ['Cycle Net Present Value (NPV)', (x) => x.npv, fmt.lakh, fmt.lakh, 1],
  ['Gross fluid rate', (x) => x.now.gross, (v) => `${fmt.n1(v)} bbl/d`, fmt.n1, 1],
];
const spLabel = (x) => `SPM ${x.spm.toFixed(1)} · downstroke ${fmt.pct(x.down)}`;

// What-if on the live well: drag = free preview through the physics; Apply = the audited path (envelope + log).
function ControlCard({ ctx }) {
  const { s, well, day } = ctx;
  const live = s.sp;
  const [p, setP] = useState(live);
  const [result, setResult] = useState(null);
  useEffect(() => setP(live), [well.id, day, live.spm, live.down]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setResult(null), [well.id, day]);
  const move = (next) => { setP((q) => ({ ...q, ...next })); setResult(null); };

  const changed = p.spm !== live.spm || p.down !== live.down;
  const ps = useMemo(() => (changed ? buildState(well, day, p) : s), [changed, well, day, p, s]);
  const verdict = useMemo(() => envelope(well, day, p), [well, day, p]);
  const where = ps.fmiMin.z ? `at ${ps.fmiMin.z} m` : 'at the top of the string';

  return (
    <Card tour="controls" title="Setpoint Evaluation" icon={SlidersHorizontal} className="lg:col-span-2"
      right={<span className="text-xs text-ink-3">Previews are not recorded; applied setpoints are logged</span>}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <Slider label="Strokes per minute" value={p.spm} min={2} max={9} step={0.1} onChange={(spm) => move({ spm })} display={p.spm.toFixed(1)} />
          <Slider label="Downstroke speed" value={p.down} min={0.7} max={1} step={0.05} onChange={(down) => move({ down })} display={fmt.pct(p.down)} />
          <p className="text-sm">
            <b className="num">{spLabel(p)}</b>
            {changed && <span className="ml-2 rounded bg-brand-50 px-1.5 py-px text-[11px] font-medium text-brand-700">Preview</span>}
          </p>
          {verdict.binding ? (
            <p role="status" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <b>{changed ? 'Rejected' : 'Current setpoint outside the safety envelope'}: {verdict.binding}</b>. {verdict.binding.startsWith('FMI') ? `The rod string would float ${where}` : 'The gearbox would exceed its torque rating'}.
              {' '}The safety envelope would limit this to <b className="num">SPM {verdict.applied.spm.toFixed(1)}</b>.
            </p>
          ) : (
            <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700"><ShieldCheck size={15} /> Within the safety envelope</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => Promise.resolve(ctx.submit(p)).then(setResult)} disabled={!changed} className="btn-primary disabled:opacity-40">
              <ShieldCheck size={15} /> Apply via Safety Envelope
            </button>
            <button onClick={() => move(live)} disabled={!changed} className="btn-ghost disabled:opacity-40"><RotateCcw size={14} /> Reset</button>
            <button onClick={() => move({ spm: s.mpc.spm, down: s.mpc.down })} disabled={s.mpc.infeasible || (p.spm === s.mpc.spm && p.down === s.mpc.down)} className="btn-ghost disabled:opacity-40">
              Use Optimizer Setpoint
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {s.mpc.infeasible
              ? 'The optimizer found no setpoint that satisfies every hard constraint for this well today.'
              : <>Model Predictive Control (MPC) optimizer: <span className="num">{spLabel(s.mpc)}</span>. It maximises profit over the next 48 hours within all hard constraints (rod float, pump fillage, gearbox torque, rod fatigue); it does not optimise whole-cycle NPV.</>}
          </p>
          {result && (
            <p className="mt-2 text-sm text-ink-2">
              {result.binding ? <>Clamped to <b className="num">{spLabel(result.applied)}</b> ({result.binding}).</> : <>Accepted. <b className="num">{spLabel(result.applied)}</b> is now the active setpoint.</>}
              {' '}<button onClick={() => ctx.go('SrpControl')} className="font-medium text-brand-600 hover:underline">View the safety envelope log</button>
            </p>
          )}
        </div>
        <dl>
          {DELTAS.map(([label, get, show, showD, better]) => {
            const a = get(s), b = get(ps), d = b - a;
            const flat = showD(Math.abs(d)) === showD(0);
            const good = d * better > 0;
            return (
              <div key={label} className="border-b border-line py-2 last:border-0">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="num whitespace-nowrap">
                    {changed && <span className="text-ink-3">{show(a)} → </span>}
                    <b>{show(b)}</b>
                    {changed && (flat
                      ? <span className="ml-2 text-xs text-ink-3">No change</span>
                      : <span className={`ml-2 text-xs font-semibold ${good ? 'text-emerald-700' : 'text-red-600'}`}>{d > 0 ? '▲ +' : '▼ −'}{showD(Math.abs(d))}</span>)}
                  </dd>
                </div>
                {label === 'Gross fluid rate' && ps.now.fillage < 1 && (
                  <p className="mt-0.5 text-right text-[11px] text-amber-700">Limited by pump fillage: additional speed increases load, not fluid rate</p>
                )}
              </div>
            );
          })}
        </dl>
      </div>
    </Card>
  );
}

function EconomicsCard({ s }) {
  const atCut = s.rows[s.cut.day];
  return (
    <Card title="Cycle Economics" icon={Gauge}>
      <div className="flex items-center gap-5">
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-viz-pink text-white">
          <div className="text-center">
            <div className="text-3xl font-bold num">{s.sor.toFixed(1)}</div>
            <div className="text-[11px] opacity-90">SOR to date</div>
          </div>
        </div>
        <div className="text-sm text-ink-2">
          The Steam-Oil Ratio (SOR) falls to <b className="text-ink num">{s.sorAtCut.toFixed(2)}</b> by the computed economic cut-off on day <b className="text-ink num">{s.cut.day}</b> ± {s.cut.band}.
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink-2">Cumulative oil production</span><span className="num font-semibold">{fmt.n0(s.now.cumOil)} <span className="font-normal text-ink-3">/ {fmt.n0(atCut.cumOil)} bbl</span></span></div>
          <Bar value={s.now.cumOil} max={atCut.cumOil} color={VIZ.pink} />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink-2">Steam injected</span><span className="num font-semibold">{fmt.n0(s.steam)} t <span className="font-normal text-ink-3">100%</span></span></div>
          <Bar value={1} color={VIZ.purple} />
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-ink-2">Cycle Net Present Value (NPV) at cut-off</span>
          <span className="num font-semibold">{fmt.lakh(s.npv)}</span>
        </div>
      </div>
    </Card>
  );
}

function EnthalpyCard({ s, r }) {
  const [basis, setBasis] = useState('Current');
  const row = basis === 'Current' ? r : s.rows[s.cut.day];
  const E = s.steam * 2.33; // GJ
  const retained = Math.max(0, (row.Tbar - FIELD.T_R) / (FIELD.T_s - FIELD.T_R));
  const produced = Math.min(row.delta, 1 - retained);
  const parts = [
    { name: 'Retained in heated zone', v: retained, color: VIZ.pink },
    { name: 'Carried off by produced fluid (δ)', v: produced * 0.85, color: VIZ.lightGreen },
    { name: 'Conduction to overburden and underburden', v: Math.max(0, 1 - retained - produced), color: VIZ.orange },
    { name: 'Wellbore loss (Ramey)', v: produced * 0.15, color: VIZ.yellow },
  ];
  return (
    <Card
      title="Injected Enthalpy Balance"
      icon={Flame}
      right={
        <select value={basis} onChange={(e) => setBasis(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-xs" aria-label="Energy basis">
          <option>Current</option>
          <option>At economic cut-off</option>
        </select>
      }
    >
      <div className="flex items-center gap-4">
        <div className="no-mark h-28 w-28 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={parts} dataKey="v" innerRadius={34} outerRadius={54} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                {parts.map((p) => <Cell key={p.name} fill={p.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <p className="text-sm text-ink-2"><b className="text-ink num">{fmt.n0(E)} GJ</b> injected. The balance closes by construction; in the field, closure is verified against enthalpy meters.</p>
      </div>
      <ul className="mt-4 space-y-3">
        {parts.map((p) => (
          <li key={p.name}>
            <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-2">{p.name}</span><span className="num font-semibold">{fmt.pct(p.v)} <span className="font-normal text-ink-3">{fmt.n0(p.v * E)} GJ</span></span></div>
            <Bar value={p.v} color={p.color} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TrajectoryCard({ s }) {
  const data = useMemo(
    () => s.rows.map((r) => ({
      p: r.p,
      TpH: r.p <= s.day ? r.Tpump : null, TpP: r.p >= s.day ? r.Tpump : null,
      muH: r.p <= s.day ? r.mu : null, muP: r.p >= s.day ? r.mu : null,
      fmiH: r.p <= s.day ? r.fmi : null, fmiP: r.p >= s.day ? r.fmi : null,
    })),
    [s],
  );
  const markers = (yAxisId) => (
    <>
      <ReferenceLine yAxisId={yAxisId} x={s.day} stroke="#16161D" strokeDasharray="2 3" label={{ value: 'Today', position: 'insideTopLeft', fontSize: 11, fill: '#5B5B6B' }} />
      <ReferenceLine yAxisId={yAxisId} x={s.cut.day} stroke={VIZ.purple} strokeDasharray="4 3" label={{ value: 'Economic cut-off', position: 'insideTopRight', fontSize: 11, fill: VIZ.purple }} />
    </>
  );
  return (
    <Card title="Cycle Trajectory: Coupling Over Time" icon={Activity} right={<Legend items={[['T_pump °C', VIZ.orange], ['μ cP', VIZ.pink], ['FMI', VIZ.purple], ['Projection', '#8C8C9A', true]]} />}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" {...AXIS} type="number" domain={[0, FIELD.horizon]} tickCount={7} />
              <YAxis yAxisId="t" {...AXIS} width={40} />
              <YAxis yAxisId="mu" orientation="right" {...AXIS} width={44} />
              <Tooltip formatter={(v) => (v == null ? '—' : fmt.n0(v))} labelFormatter={(l) => `Production day ${l}`} />
              {markers('t')}
              <Line yAxisId="t" dataKey="TpH" name="Pump temperature °C" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="t" dataKey="TpP" name="Pump temperature (projected)" stroke={VIZ.orange} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
              <Line yAxisId="mu" dataKey="muH" name="μ cP" stroke={VIZ.pink} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="mu" dataKey="muP" name="μ (projected)" stroke={VIZ.pink} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" {...AXIS} type="number" domain={[0, FIELD.horizon]} tickCount={7} />
              <YAxis {...AXIS} width={40} domain={[-0.5, 1]} ticks={[-0.5, 0, 0.5, 1]} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip formatter={(v) => (v == null ? '—' : v.toFixed(2))} labelFormatter={(l) => `Production day ${l}`} />
              <ReferenceLine y={FIELD.fmiLimit} stroke="#DC2626" strokeDasharray="4 3" label={{ value: 'FMI limit 0.15', position: 'insideBottomLeft', fontSize: 11, fill: '#DC2626' }} />
              {markers(0)}
              <Line dataKey="fmiH" name="FMI" stroke={VIZ.purple} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="fmiP" name="FMI (projected at setpoint)" stroke={VIZ.purple} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

function statusOf(st) {
  if (st.fmiMin.fmi <= FIELD.fmiLimit) return ['crit', 'Rod float risk'];
  if (st.now.fillage < FIELD.fillageLimit) return ['warn', 'Fluid pound risk'];
  if (st.cut.day - st.day <= 7) return ['warn', 'Cut-off approaching'];
  return ['ok', 'Within envelope'];
}

function WellsTable({ ctx }) {
  const [q, setQ] = useState('');
  const rows = ctx.fleet.filter((st) => st.well.id.toLowerCase().includes(q.toLowerCase()));
  const cols = ['Well', 'Cycle · Day', 'T_pump °C', 'μ at pump cP', 'Minimum FMI', 'SPM setpoint / MPC', 'Pump fillage', 'SOR to date', 'Cut-off day', 'Status'];
  const cells = (st) => [st.well.id, `${st.well.cycle} · ${st.day}`, fmt.n0(st.now.Tpump), fmt.n0(st.now.mu), fmt.n2(st.fmiMin.fmi), `${st.sp.spm.toFixed(1)} / ${st.mpc.spm.toFixed(1)}`, fmt.pct(st.now.fillage), st.sor.toFixed(1), st.cut.day, statusOf(st)[1]];

  const exportCsv = () => {
    const csv = [cols, ...ctx.fleet.map(cells)].map((r) => r.join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'baghewala-fleet.csv' });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      pad="p-0"
      className="overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-[15px] font-semibold">Wells</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm">
            <Search size={15} className="text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wells" className="w-32 outline-none placeholder:text-ink-3" />
          </label>
          <button onClick={exportCsv} className="btn-primary"><Download size={15} /> Export CSV</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-y border-line bg-canvas">
            <tr>{cols.map((c) => <th key={c} className="th">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((st) => {
              const [tone, label] = statusOf(st);
              const active = st.well.id === ctx.well.id;
              return (
                <tr
                  key={st.well.id}
                  onClick={() => ctx.pickWell(st.well.id)}
                  className={`cursor-pointer border-b border-line last:border-0 hover:bg-canvas ${active ? 'bg-brand-50/60' : ''}`}
                >
                  <td className="td">
                    <span className="flex items-center gap-2.5 font-medium">
                      <Avatar text={st.well.id.slice(-2)} color={st.well.hue} size={26} />
                      {st.well.id}
                    </span>
                  </td>
                  <td className="td text-ink-2">{st.well.cycle} · {st.day}</td>
                  <td className="td">{fmt.n0(st.now.Tpump)}</td>
                  <td className="td">{fmt.n0(st.now.mu)}</td>
                  <td className="td font-semibold">{fmt.n2(st.fmiMin.fmi)}</td>
                  <td className="td">{st.sp.spm.toFixed(1)} <span className="text-ink-3">/ {st.mpc.spm.toFixed(1)}</span></td>
                  <td className="td">{fmt.pct(st.now.fillage)}</td>
                  <td className="td">{st.sor.toFixed(1)}</td>
                  <td className="td">{st.cut.day}</td>
                  <td className="td"><Status tone={tone}>{label}</Status></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FleetTab({ ctx }) {
  const pts = ctx.fleet.map((st) => ({ id: st.well.id, mu: st.now.mu, fmi: st.fmiMin.fmi, oil: st.now.oil, fill: st.well.hue }));
  return (
    <div className="space-y-6">
      <Card title="Field-Wide Operating Envelope" icon={ShieldAlert} right={<span className="text-xs text-ink-3">Bubble size: oil rate</span>}>
        <p className="mb-4 max-w-3xl text-sm text-ink-2">
          All wells follow the same physics: as μ({sub("T_pump")}) rises through the cycle, the Float Margin Index falls unless strokes per minute or downstroke speed is reduced.
          Wells below the red line require immediate action.
        </p>
        <div className="h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid {...GRID} vertical />
              <XAxis dataKey="mu" type="number" name="μ pump" unit=" cP" scale="log" domain={[30, 10000]} {...AXIS} ticks={[30, 100, 300, 1000, 3000, 10000]} />
              <YAxis dataKey="fmi" type="number" name="Min FMI" {...AXIS} domain={[-0.5, 1]} width={44} />
              <ZAxis dataKey="oil" range={[120, 700]} />
              <Tooltip formatter={(v, n) => [typeof v === 'number' ? v.toFixed(n === 'Min FMI' ? 2 : 0) : v, n]} />
              <ReferenceLine y={FIELD.fmiLimit} stroke="#DC2626" strokeDasharray="4 3" />
              <Scatter data={pts} isAnimationActive={false}>
                {pts.map((p) => <Cell key={p.id} fill={p.fill} stroke="#16161D" strokeOpacity={0.25} />)}
                <LabelList dataKey="id" position="right" fontSize={11} fill="#5B5B6B" />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <WellsTable ctx={ctx} />
    </div>
  );
}
