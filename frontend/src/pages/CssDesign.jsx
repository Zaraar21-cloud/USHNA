import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar as RBar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot } from 'recharts';
import { Timer, Grid3x3, History } from 'lucide-react';
import { PageHeader, Card, StatRow, Eq, Legend, VIZ, AXIS, GRID, fmt, Toggle } from '../components/ui';
import { FIELD } from '../data/twin';

const TABS = ['Cut-off (optimal stopping)', 'Cycle design (Bayesian opt.)', 'Counterfactual backtest'];

export default function CssDesign({ ctx }) {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <>
      <PageHeader title="CSS design & cut-off" subtitle="When to stop producing is the biggest economic lever in the operation, and today it's decided by habit. Here it's recomputed every day from the twin." tabs={TABS} tab={tab} onTab={setTab} />
      {tab === TABS[0] && <Cutoff s={ctx.s} />}
      {tab === TABS[1] && <Design ctx={ctx} />}
      {tab === TABS[2] && <Backtest well={ctx.well} />}
    </>
  );
}

function Cutoff({ s }) {
  const data = s.rows.map((r) => ({ p: r.p, pi: r.profit / 1000 }));
  const star = s.cut.piStar / 1000;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Profit rate π(t) vs fresh-cycle average π̄*" icon={Timer} className="lg:col-span-2" right={<Legend items={[['π(t)', VIZ.pink], ['π̄*', VIZ.purple, true]]} />}>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" type="number" domain={[0, FIELD.horizon]} {...AXIS} />
              <YAxis {...AXIS} width={52} unit="k" />
              <Tooltip formatter={(v) => `₹${fmt.n0(v)}k/day`} labelFormatter={(l) => `Production day ${l}`} />
              <ReferenceLine y={star} stroke={VIZ.purple} strokeDasharray="5 4" />
              <ReferenceLine x={s.day} stroke="#16161D" strokeDasharray="2 3" label={{ value: 'today', position: 'insideTopLeft', fontSize: 11 }} />
              <ReferenceLine x={s.cut.day - s.cut.band} stroke="#D9CCFF" />
              <ReferenceLine x={s.cut.day + s.cut.band} stroke="#D9CCFF" />
              <Line dataKey="pi" stroke={VIZ.pink} strokeWidth={2} dot={false} isAnimationActive={false} />
              <ReferenceDot x={s.cut.day} y={star} r={6} fill={VIZ.purple} stroke="#fff" label={{ value: `stop: day ${s.cut.day}`, position: 'top', fontSize: 12, fill: VIZ.purple }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <div className="eq">Stop producing and re-inject when π(t) ≤ π̄*</div>
          <p className="mt-1 text-xs text-ink-2">Keep producing only while this well earns more than the average of starting a new cycle, counting injection cost and soak downtime. π(t) falls steadily as T̄ drops, so there is a single crossing point.</p>
        </div>
      </Card>
      <Card title="Decision" icon={Timer}>
        <StatRow label="Cut-off day" value={`${s.cut.day} ± ${s.cut.band}`} />
        <StatRow label="Days remaining" value={Math.max(0, s.cut.day - s.day)} />
        <StatRow label="π(t) today" value={`₹${fmt.n0(s.now.profit)}`} unit="/day" />
        <StatRow label="π̄* (fresh cycle)" value={`₹${fmt.n0(s.cut.piStar)}`} unit="/day" />
        <StatRow label="SOR at cut-off" value={fmt.n2(s.sorAtCut)} />
        <StatRow label="Cycle NPV at cut-off" value={fmt.lakh(s.npv)} />
        <p className="mt-3 text-xs text-ink-3">Recomputed daily from oil price (₹{fmt.n0(FIELD.oilPrice)}/bbl), steam cost (₹{fmt.n0(FIELD.steamCost)}/t) and the EnKF reservoir parameters. The band comes from kh ±10%.</p>
      </Card>
    </div>
  );
}

function Design({ ctx }) {
  const { design, well } = ctx;
  const [metric, setMetric] = useState('NPV');
  const vals = design.grid.map((g) => (metric === 'NPV' ? g.npv : -g.sor));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const sampled = useMemo(() => new Set(design.samples.map((g) => `${g.steam}-${g.soak}`)), [design]);
  const color = (v) => {
    const k = (v - lo) / (hi - lo || 1);
    return `rgb(${Math.round(245 - 122 * k)}, ${Math.round(241 - 164 * k)}, ${Math.round(255 - 0 * k)})`;
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card
        title="Posterior over (steam volume, soak time)" icon={Grid3x3} className="lg:col-span-2"
        right={<Toggle options={['NPV', 'SOR']} value={metric} onChange={setMetric} />}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid gap-1" style={{ gridTemplateColumns: `56px repeat(${design.steams.length}, 1fr)` }}>
              {[...design.soaks].reverse().map((soak) => (
                <React.Fragment key={soak}>
                  <div className="self-center pr-1 text-right text-xs text-ink-3 num">{soak} d</div>
                  {design.steams.map((steam) => {
                    const g = design.grid.find((x) => x.steam === steam && x.soak === soak);
                    const v = metric === 'NPV' ? g.npv : -g.sor;
                    const isBest = g === design.best, isCur = g === design.current;
                    return (
                      <div
                        key={steam}
                        title={`${steam} t, ${soak} d → NPV ${fmt.lakh(g.npv)}, SOR ${g.sor.toFixed(2)}, cut-off day ${g.cutDay}`}
                        className={`relative grid h-9 place-items-center rounded-md ${isBest ? 'ring-2 ring-ink' : isCur ? 'ring-2 ring-viz-orange' : ''}`}
                        style={{ background: color(v) }}
                      >
                        {sampled.has(`${steam}-${soak}`) && <span className="h-1.5 w-1.5 rounded-full bg-white/90 ring-1 ring-ink/40" />}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
              <div />
              {design.steams.map((st) => <div key={st} className="pt-1 text-center text-[10px] text-ink-3 num">{st / 1000}k</div>)}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-2">
              <span>x: steam volume (t) · y: soak time</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded ring-2 ring-ink" /> posterior optimum</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded ring-2 ring-viz-orange" /> current design</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ink/60" /> physics-model call ({design.calls})</span>
              <span>darker = better {metric}</span>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Eq note="Subject to formation fracture pressure, boiler capacity, casing/cement thermal limits and minimum cycle economics.">max NPV = Σₜ (R_o·q_o(t) − C_steam·V_s − C_energy·E(t) − C_fail·λ(t)) / (1+r)ᵗ</Eq>
        </div>
      </Card>
      <Card title={`Cycle ${well.cycle + 1} proposal`} icon={Grid3x3}>
        <StatRow label="Steam volume" value={fmt.n0(design.best.steam)} unit="t" />
        <StatRow label="Soak time" value={design.best.soak} unit="d" />
        <StatRow label="Projected cut-off" value={`day ${design.best.cutDay}`} />
        <StatRow label="Cycle NPV" value={fmt.lakh(design.best.npv)} />
        <StatRow label="Cycle SOR" value={fmt.n2(design.best.sor)} />
        <div className="my-3 border-t border-line" />
        <StatRow label="Current design NPV" value={fmt.lakh(design.current.npv)} />
        <StatRow label="Uplift" value={`${Math.round((design.best.npv / design.current.npv - 1) * 100)}%`} tone="ok" />
        <p className="mt-3 text-xs text-ink-3">A GP surrogate seeded with a physics prior converges in about {design.calls} simulator calls. The posterior also shows where in the design space the recommendation is confident.</p>
      </Card>
    </div>
  );
}

function Backtest({ well }) {
  const data = Array.from({ length: well.cycle }, (_, i) => {
    const c = i + 1;
    const hSor = 4.1 + 0.25 * Math.sin(c * 1.7) + 0.1 * c;
    return {
      cycle: `C${c}`,
      hSor, uSor: hSor * (0.8 - 0.01 * c),
      hE: 21 + 2 * Math.cos(c), uE: (21 + 2 * Math.cos(c)) * 0.83,
      hF: [2, 3, 1, 3, 2, 2][i % 6], uF: [1, 0, 0, 1, 0, 1][i % 6],
    };
  });
  const sum = (k) => data.reduce((a, d) => a + d[k], 0);
  const charts = [
    ['Steam–oil ratio', 'hSor', 'uSor', (v) => v.toFixed(2)],
    ['Energy per barrel (kWh/bbl)', 'hE', 'uE', (v) => v.toFixed(1)],
    ['Rod failures', 'hF', 'uF', (v) => v],
  ];
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        Run the optimizer over {well.id}'s past cycles and compare what it would have recommended with what was actually done.
        Over {well.cycle} cycles: SOR −{Math.round((1 - sum('uSor') / sum('hSor')) * 100)}%, energy per barrel −{Math.round((1 - sum('uE') / sum('hE')) * 100)}%, rod failures {sum('hF')} → {sum('uF')}.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {charts.map(([title, h, u, f]) => (
          <Card key={title} title={title} icon={History} right={<Legend items={[['historical', VIZ.grey], ['USHNA', VIZ.pink]]} />}>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="cycle" {...AXIS} />
                  <YAxis {...AXIS} width={44} allowDecimals={h !== 'hF'} />
                  <Tooltip formatter={(v) => f(v)} />
                  <RBar dataKey={h} name="Historical" fill={VIZ.grey} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <RBar dataKey={u} name="USHNA" fill={VIZ.pink} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-3">Illustrative backtest on synthetic cycle history. Validation protocol: leave-one-cycle-out history matching, an energy-balance closure audit, and card-reconstruction error on held-out cards.</p>
    </div>
  );
}
