import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, LabelList,
} from 'recharts';
import { Thermometer, Gauge, Droplet, ShieldAlert, Activity, Download, Search, Flame, ArrowDown, Zap, Clock, ChevronDown as ChevDown, ChevronUp } from 'lucide-react';
import { PageHeader, Card, StatRow, Avatar, Toggle, Bar, Status, VIZ, AXIS, GRID, fmt, toneOf, Legend, PhaseBadge, PhaseTimeline } from '../components/ui';
import RecCard from '../components/RecCard';
import { FIELD, PHASES, getPhase } from '../data/twin';

export default function Overview({ ctx }) {
  const [tab, setTab] = useState('Overview');
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${FIELD.field}, Rajasthan · ${FIELD.formation} · ${FIELD.api}. One scalar, μ(T_pump), flows from the thermal model into the pump control law.`}
        tabs={['Overview', 'Fleet envelope']}
        tab={tab}
        onTab={setTab}
      />
      {tab === 'Overview' ? <OverviewTab ctx={ctx} /> : <FleetTab ctx={ctx} />}
    </>
  );
}

function OverviewTab({ ctx }) {
  const { s, well, recs } = ctx;
  const [view, setView] = useState('Now');
  const r = view === 'Now' ? s.now : s.ahead;

  const download = () => {
    const blob = new Blob([JSON.stringify({ well: well.id, day: s.day, setpoint: s.sp, state: r, cutoff: s.cut, mpc: s.mpc }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${well.id}-day${s.day}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar text={well.id.slice(-2)} color={well.hue} size={34} />
          <div>
            <h2 className="text-lg font-semibold">{well.id} twin</h2>
            <p className="text-xs text-ink-3">Cycle {well.cycle} · production day {s.day} · SPM {s.sp.spm.toFixed(1)} · downstroke {Math.round(s.sp.down * 100)}%</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Toggle options={['Now', '+48 h']} value={view} onChange={setView} />
          <button onClick={download} className="flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
            <Download size={15} /> Download
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CouplingCard s={s} r={r} view={view} />
        <EconomicsCard s={s} />
        <EnthalpyCard s={s} r={r} />
      </div>

      <PhaseIndicatorCard s={s} well={well} />

      <TrajectoryCard s={s} />

      <PhaseDataSection s={s} well={well} />

      {recs[0] && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">What the operator sees</h2>
            <button onClick={() => ctx.go('Recommendations')} className="text-sm font-medium text-brand-600 hover:underline">
              All {recs.length} recommendations
            </button>
          </div>
          <RecCard rec={recs[0]} wellId={well.id} onApply={ctx.submit} />
        </div>
      )}

      <WellsTable ctx={ctx} />
    </div>
  );
}

function CouplingCard({ s, r, view }) {
  const fmiTone = toneOf(s.fmiMin.fmi, FIELD.fmiLimit);
  return (
    <Card title="Coupling chain" icon={Activity} right={<span className="text-xs text-ink-3">{view === 'Now' ? 'measured + EnKF' : 'Ramey-lag projection'}</span>}>
      <StatRow icon={Flame} label="Heated zone T̄" value={fmt.n0(r.Tbar)} unit="°C" />
      <Arrow />
      <StatRow icon={Thermometer} label="Pump intake T_pump" value={fmt.n0(r.Tpump)} unit="°C" tone={r.Tpump < FIELD.T_onset ? 'warn' : undefined} />
      <Arrow />
      <StatRow icon={Droplet} label="Viscosity μ(T_pump)" value={fmt.n0(r.mu)} unit="cP" />
      <Arrow />
      <StatRow icon={ShieldAlert} label={`Min FMI (at ${s.fmiMin.z} m)`} value={fmt.n2(s.fmiMin.fmi)} tone={fmiTone} />
      <StatRow icon={Gauge} label="(S·N)max → SPM max" value={s.spmMax.toFixed(1)} unit={`set ${s.sp.spm.toFixed(1)}`} tone={s.sp.spm > s.spmMax ? 'crit' : 'ok'} />
    </Card>
  );
}
const Arrow = () => <div className="-my-1 flex pl-[9px]"><ArrowDown size={10} className="text-ink-3" /></div>;

function EconomicsCard({ s }) {
  const atCut = s.rows[s.cut.day];
  return (
    <Card title="Cycle economics" icon={Gauge}>
      <div className="flex items-center gap-5">
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-viz-pink text-white">
          <div className="text-center">
            <div className="text-3xl font-bold num">{s.sor.toFixed(1)}</div>
            <div className="text-[11px] opacity-90">SOR to date</div>
          </div>
        </div>
        <div className="text-sm text-ink-2">
          Steam–oil ratio falls to <b className="text-ink num">{s.sorAtCut.toFixed(2)}</b> by the computed cut-off on day <b className="text-ink num">{s.cut.day}</b> ± {s.cut.band}.
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink-2">Cumulative oil</span><span className="num font-semibold">{fmt.n0(s.now.cumOil)} <span className="font-normal text-ink-3">/ {fmt.n0(atCut.cumOil)} bbl</span></span></div>
          <Bar value={s.now.cumOil} max={atCut.cumOil} color={VIZ.pink} />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink-2">Steam injected</span><span className="num font-semibold">{fmt.n0(s.steam)} t <span className="font-normal text-ink-3">100%</span></span></div>
          <Bar value={1} color={VIZ.purple} />
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-ink-2">Cycle NPV at cut-off</span>
          <span className="num font-semibold">{fmt.lakh(s.npv)}</span>
        </div>
      </div>
    </Card>
  );
}

function EnthalpyCard({ s, r }) {
  const [basis, setBasis] = useState('Now');
  const row = basis === 'Now' ? r : s.rows[s.cut.day];
  const E = s.steam * 2.33; // GJ
  const retained = Math.max(0, (row.Tbar - FIELD.T_R) / (FIELD.T_s - FIELD.T_R));
  const produced = Math.min(row.delta, 1 - retained);
  const parts = [
    { name: 'Retained in heated zone', v: retained, color: VIZ.pink },
    { name: 'Carried off by produced fluid (δ)', v: produced * 0.85, color: VIZ.lightGreen },
    { name: 'Conduction to over/underburden', v: Math.max(0, 1 - retained - produced), color: VIZ.orange },
    { name: 'Wellbore loss (Ramey)', v: produced * 0.15, color: VIZ.yellow },
  ];
  return (
    <Card
      title="Injected enthalpy"
      icon={Flame}
      right={
        <select value={basis} onChange={(e) => setBasis(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-xs" aria-label="Energy basis">
          <option>Now</option>
          <option>At cut-off</option>
        </select>
      }
    >
      <div className="flex items-center gap-4">
        <div className="h-28 w-28 shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={parts} dataKey="v" innerRadius={34} outerRadius={54} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                {parts.map((p) => <Cell key={p.name} fill={p.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <p className="text-sm text-ink-2"><b className="text-ink num">{fmt.n0(E)} GJ</b> injected. Balance closes by construction; field closure check runs on enthalpy meters.</p>
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
      <ReferenceLine yAxisId={yAxisId} x={s.day} stroke="#16161D" strokeDasharray="2 3" label={{ value: 'today', position: 'insideTopLeft', fontSize: 11, fill: '#5B5B6B' }} />
      <ReferenceLine yAxisId={yAxisId} x={s.cut.day} stroke={VIZ.purple} strokeDasharray="4 3" label={{ value: 'cut-off', position: 'insideTopRight', fontSize: 11, fill: VIZ.purple }} />
    </>
  );
  return (
    <Card title="Cycle trajectory — the coupling over time" icon={Activity} right={<Legend items={[['T_pump °C', VIZ.orange], ['μ cP', VIZ.pink], ['FMI', VIZ.purple], ['projection', '#8C8C9A', true]]} />}>
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
              <Line yAxisId="t" dataKey="TpH" name="T_pump °C" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="t" dataKey="TpP" name="T_pump (proj.)" stroke={VIZ.orange} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
              <Line yAxisId="mu" dataKey="muH" name="μ cP" stroke={VIZ.pink} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="mu" dataKey="muP" name="μ (proj.)" stroke={VIZ.pink} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
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
              <Line dataKey="fmiP" name="FMI (proj. at setpoint)" stroke={VIZ.purple} dot={false} strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />
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
  if (st.cut.day - st.day <= 7) return ['warn', 'Cut-off near'];
  return ['ok', 'In envelope'];
}

function WellsTable({ ctx }) {
  const [q, setQ] = useState('');
  const rows = ctx.fleet.filter((st) => st.well.id.toLowerCase().includes(q.toLowerCase()));
  const cols = ['Well', 'Phase', 'Cycle · day', 'T_pump °C', 'μ pump cP', 'Min FMI', 'SPM set / MPC', 'Fillage', 'SOR to date', 'Cut-off day', 'Status'];
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
          <button onClick={exportCsv} className="btn-primary"><Download size={15} /> Export</button>
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
                  onClick={() => ctx.selectWell(st.well.id)}
                  className={`cursor-pointer border-b border-line last:border-0 hover:bg-canvas ${active ? 'bg-brand-50/60' : ''}`}
                >
                  <td className="td">
                    <span className="flex items-center gap-2.5 font-medium">
                      <Avatar text={st.well.id.slice(-2)} color={st.well.hue} size={26} />
                      {st.well.id}
                    </span>
                  </td>
                  <td className="td"><PhaseBadge phase={getPhase(st.well, st.day).phase} size="sm" /></td>
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

function PhaseIndicatorCard({ s, well }) {
  const { phaseInfo, phaseData: pd } = s;
  if (!phaseInfo || !pd) return null;
  const { phase, phaseDay, totalCycleDay, boundaries } = phaseInfo;
  const totalDays = boundaries.productionEnd;

  // Stats for the active phase
  const activeData = pd.phases[phase.id - 1];

  return (
    <Card title="Cycle phase" icon={Clock} right={<PhaseBadge phase={phase} />}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.5fr]">
        {/* Left: Phase info */}
        <div>
          <p className="text-sm text-ink-2">{phase.description}</p>
          <div className="mt-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-ink-2">Cycle</span>
              <span className="num font-semibold">{well.cycle}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-2">Total cycle day</span>
              <span className="num font-semibold">{totalCycleDay} <span className="font-normal text-ink-3">of {totalDays}</span></span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-2">Phase day</span>
              <span className="num font-semibold">{phaseDay} <span className="font-normal text-ink-3">of {activeData?.duration ?? '—'}</span></span>
            </div>
            {s.cut && (
              <div className="flex justify-between text-sm">
                <span className="text-ink-2">Cut-off projected</span>
                <span className="num font-semibold">day {s.cut.day} <span className="font-normal text-ink-3">± {s.cut.band}</span></span>
              </div>
            )}
          </div>
        </div>
        {/* Right: Timeline */}
        <div>
          <p className="mb-2 text-xs font-medium text-ink-3 uppercase tracking-wide">Full cycle timeline</p>
          <PhaseTimeline phaseInfo={phaseInfo} />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {PHASES.map((p) => {
              const isActive = p.id === phase.id;
              return (
                <div key={p.id} className={`rounded-xl border px-3 py-2.5 transition-all ${isActive ? 'border-2 shadow-sm' : 'border-line opacity-70'}`} style={isActive ? { borderColor: p.color } : {}}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: p.color }}>{p.id}</span>
                    <span className="text-xs font-semibold">{p.name}</span>
                  </div>
                  <p className="text-[11px] text-ink-3 leading-relaxed">
                    {p.id === 1 && `${FIELD.tInj} days`}
                    {p.id === 2 && `${well.soak} days`}
                    {p.id === 3 && `up to ${FIELD.horizon} days`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function PhaseDataSection({ s, well }) {
  const { phaseData: pd } = s;
  const [expanded, setExpanded] = useState(null);
  if (!pd) return null;

  const toggle = (id) => setExpanded((prev) => (prev === id ? null : id));

  const phaseRows = [
    {
      data: pd.injection,
      metrics: [
        ['Steam injected', `${fmt.n0(pd.injection.steam)} t (${fmt.n0(pd.injection.steamBbl)} bbl)`],
        ['Duration', `${pd.injection.duration} days`],
        ['Heated radius', `${pd.injection.heatedRadius.toFixed(1)} m`],
        ['Energy injected', `${pd.injection.energyInjected.toFixed(0)} GJ`],
        ['Start temperature', `${pd.injection.startTemp} °C`],
        ['Target temperature', `${pd.injection.endTemp} °C`],
      ],
    },
    {
      data: pd.soak,
      metrics: [
        ['Duration', `${pd.soak.duration} days`],
        ['Redistribution efficiency', `${(pd.soak.redistributionEfficiency * 100).toFixed(0)}%`],
        ['Heat loss (conduction)', `${(pd.soak.heatLoss * 100).toFixed(1)}%`],
        ['Reservoir temp at end of soak', `${fmt.n0(pd.soak.endTemp)} °C`],
      ],
    },
    {
      data: pd.production,
      metrics: [
        ['Duration (horizon)', `${pd.production.duration} days`],
        ['Total oil produced', `${fmt.n0(pd.production.totalOil)} bbl`],
        ['Peak oil rate', `${pd.production.peakOilRate.toFixed(1)} bbl/d`],
        ['Avg pump temperature', `${fmt.n0(pd.production.avgTemp)} °C`],
        ['Avg viscosity', `${fmt.n0(pd.production.avgViscosity)} cP`],
        ['Avg FMI', pd.production.avgFmi.toFixed(2)],
        ['Steam-oil ratio', pd.production.sor.toFixed(2)],
        ['Water cut range', `${fmt.pct(pd.production.waterCutRange[0])} → ${fmt.pct(pd.production.waterCutRange[1])}`],
      ],
    },
  ];

  return (
    <Card pad="p-0" title="Phase data" icon={Zap} right={<span className="text-xs text-ink-3">Click a phase to expand</span>}>
      <div className="divide-y divide-line">
        {phaseRows.map(({ data: d, metrics }) => {
          const isOpen = expanded === d.phase.id;
          return (
            <div key={d.phase.id}>
              <button
                onClick={() => toggle(d.phase.id)}
                className={`flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm hover:bg-canvas transition-colors ${isOpen ? 'bg-canvas' : ''}`}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: d.phase.color }}>
                  {d.phase.id}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{d.phase.name}</span>
                  <span className="ml-2 text-ink-3">{d.duration} days</span>
                </div>
                <span className="mr-2 max-w-xs truncate text-xs text-ink-2 hidden sm:inline">{d.description}</span>
                {isOpen ? <ChevronUp size={16} className="text-ink-3 shrink-0" /> : <ChevDown size={16} className="text-ink-3 shrink-0" />}
              </button>
              {isOpen && (
                <div className="bg-canvas/50 px-5 py-4 border-t border-line">
                  <p className="text-sm text-ink-2 mb-4">{d.description}</p>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {metrics.map(([label, value]) => (
                      <div key={label} className="flex justify-between text-sm py-1 border-b border-line/50 last:border-0">
                        <span className="text-ink-2">{label}</span>
                        <span className="num font-semibold">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FleetTab({ ctx }) {
  const pts = ctx.fleet.map((st) => ({ id: st.well.id, mu: st.now.mu, fmi: st.fmiMin.fmi, oil: st.now.oil, fill: st.well.hue }));
  return (
    <div className="space-y-6">
      <Card title="Operating envelope across the field" icon={ShieldAlert} right={<span className="text-xs text-ink-3">bubble size = oil rate</span>}>
        <p className="mb-4 max-w-3xl text-sm text-ink-2">
          Every well sits somewhere on the same physics: as μ(T_pump) climbs through the cycle, float margin falls unless SPM or downstroke speed comes down.
          Wells below the red line need action now.
        </p>
        <div className="h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid {...GRID} vertical />
              <XAxis dataKey="mu" type="number" name="μ pump" unit=" cP" scale="log" domain={[30, 3000]} {...AXIS} ticks={[30, 100, 300, 1000, 3000]} />
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
