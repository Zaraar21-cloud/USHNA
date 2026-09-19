import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ScatterChart, Scatter, Cell } from 'recharts';
import { ShieldAlert, Activity, Microscope, Wrench } from 'lucide-react';
import { PageHeader, Card, StatRow, Eq, Legend, Status, Badge, Bar, VIZ, AXIS, GRID, fmt, toneOf } from '../components/ui';
import { FIELD, fmiProfile, loads } from '../data/twin';

const TABS = ['Float margin', 'Card diagnosis', 'Fatigue & buckling'];

export default function RodString({ ctx }) {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <>
      <PageHeader
        title="Rod string & SRP"
        subtitle="Timescale: seconds to minutes. Gibbs damped wave equation, run forward for what-if and inverted to turn the surface card into a downhole card."
        tabs={TABS} tab={tab} onTab={setTab}
      />
      {tab === 'Float margin' && <FloatMargin s={ctx.s} />}
      {tab === 'Card diagnosis' && <Diagnosis s={ctx.s} />}
      {tab === 'Fatigue & buckling' && <Fatigue s={ctx.s} />}
    </>
  );
}

function FloatMargin({ s }) {
  const profile = s.fmiZ.map((r) => ({ z: r.z, fmi: r.fmi, W: r.W / 1000, F: r.F / 1000 }));
  const trend = s.rows.map((r) => ({ p: r.p, fmi: r.fmi }));
  const tone = toneOf(s.fmiMin.fmi, FIELD.fmiLimit);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card title="FMI(z) along the string" icon={ShieldAlert} className="lg:col-span-4">
        <div className="h-80">
          <ResponsiveContainer>
            <LineChart layout="vertical" data={profile} margin={{ top: 5, right: 12, left: -5, bottom: 0 }}>
              <CartesianGrid stroke="#F0F0F4" />
              <XAxis type="number" {...AXIS} domain={[-0.5, 1]} ticks={[-0.5, 0, 0.15, 0.5, 1]} />
              <YAxis type="number" dataKey="z" {...AXIS} width={40} domain={[0, FIELD.pumpDepth]} />
              <Tooltip formatter={(v) => v.toFixed(2)} labelFormatter={(l) => `${l} m`} />
              <ReferenceLine x={FIELD.fmiLimit} stroke="#DC2626" strokeDasharray="4 3" />
              <ReferenceLine x={0} stroke="#16161D" />
              <Line dataKey="fmi" name="FMI" stroke={VIZ.purple} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-3">Red dashed line: 0.15 operating limit. Black line: float onset (FMI ≤ 0).</p>
      </Card>

      <Card title="Float Margin Index" icon={Activity} className="lg:col-span-4">
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-bold num">{fmt.n2(s.fmiMin.fmi)}</span>
          <Status tone={tone}>{tone === 'ok' ? 'Safe margin' : tone === 'warn' ? 'Near limit' : 'Below 0.15 limit'}</Status>
        </div>
        <p className="mt-1 text-sm text-ink-2">minimum over the string, at {s.fmiMin.z} m</p>
        <div className="mt-4 space-y-3">
          <Eq>FMI(z) = (W_buoyant(z) − F_drag(z) − F_fric(z)) / W_buoyant(z)</Eq>
          <Eq note="Laminar annular drag per unit length">f_drag ≈ 2π·μ·v_rod / ln(D_t/D_r)</Eq>
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <div className="eq">(S·N)max ∝ 1 / μ(T_pump)</div>
            <p className="mt-1 text-xs text-ink-2">Maximum safe pumping speed is inversely proportional to viscosity at the pump. You can check this by hand.</p>
          </div>
        </div>
      </Card>

      <Card title="At the setpoint" icon={Wrench} className="lg:col-span-4">
        <StatRow label="SPM (set)" value={s.sp.spm.toFixed(1)} />
        <StatRow label="Downstroke velocity factor" value={fmt.pct(s.sp.down)} />
        <StatRow label="SPM max for FMI > 0.15 (+48 h)" value={s.spmMax.toFixed(1)} tone={s.sp.spm > s.spmMax ? 'crit' : 'ok'} />
        <StatRow label="Buoyed rod weight" value={fmt.n1(s.fmiZ[0].W / 1000)} unit="kN" />
        <StatRow label="Downstroke drag + friction" value={fmt.n1(s.fmiZ[0].F / 1000)} unit="kN" />
        <StatRow label="Stroke length" value={FIELD.stroke} unit="m" />
        <StatRow label="Rod damping c (EnKF)" value="0.42" unit="1/s" />
        <StatRow label="Wave speed a = √(Eg/ρ)" value="≈ 4,900" unit="m/s" />
      </Card>

      <Card title="Min FMI through the cycle at this setpoint" icon={Activity} className="lg:col-span-12">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" type="number" domain={[0, FIELD.horizon]} {...AXIS} />
              <YAxis {...AXIS} width={40} domain={[-0.5, 1]} ticks={[-0.5, 0, 0.5, 1]} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip formatter={(v) => v.toFixed(2)} labelFormatter={(l) => `Production day ${l}`} />
              <ReferenceLine y={FIELD.fmiLimit} stroke="#DC2626" strokeDasharray="4 3" />
              <ReferenceLine x={s.day} stroke="#16161D" strokeDasharray="2 3" label={{ value: 'today', position: 'insideTopLeft', fontSize: 11 }} />
              <Line dataKey="fmi" stroke={VIZ.purple} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ── Inverse-simulation diagnosis (Section 5.5) ──
const CASES = {
  Live: null,
  'Gas interference': { fill: 0.61, gvf: 0.34, leak: 0.02, pound: false, drag: 1, label: 'gas interference, not fluid pound', gbm: 'Fluid pound (0.58)' },
  'Fluid pound': { fill: 0.62, gvf: 0.03, leak: 0.02, pound: true, drag: 1, label: 'fluid pound: pump intake is above bubble point and the plunger hits the fluid surface', gbm: 'Fluid pound (0.81)' },
  'Rod float': { fill: 0.9, gvf: 0.02, leak: 0.03, pound: false, drag: 2.4, label: 'rod float: downstroke drag is more than the buoyed rod weight', gbm: 'Normal (0.44)' },
};

function makeCards(s, c) {
  const S = FIELD.stroke, W = s.fmiZ[0].W / 1000, Wf = s.loads.Wf / 1000, F = (s.fmiZ[0].F / 1000) * c.drag * 0.35;
  const n = 60, down = [], up = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * S;
    up.push({ x, L: Wf * Math.min(1, i / 6) });
  }
  const contact = c.fill * S;
  for (let i = n; i >= 0; i--) {
    const x = (i / n) * S;
    let L;
    if (x > contact) L = c.pound ? Wf : Wf * (1 - ((S - x) / (S - contact)) ** (1 / (1 + c.gvf * 4)) * 0.9);
    else L = -F * Math.min(1, (contact - x) / (0.15 * S));
    down.push({ x, L });
  }
  const pump = [...up, ...down];
  const surface = pump.map((p, i) => {
    const th = (i / pump.length) * 2 * Math.PI;
    return { x: p.x * 1.08 - 0.12 * Math.sin(th), L: p.L + W + W * s.loads.accUp * 0.5 * Math.cos(th) + 1.2 * Math.sin(3 * th) };
  });
  return { pump, surface };
}

function Diagnosis({ s }) {
  const [name, setName] = useState('Live');
  const c = CASES[name] || { fill: Math.min(0.98, s.now.fillage), gvf: 0.04, leak: 0.03, pound: s.now.fillage < FIELD.fillageLimit, drag: s.fmiMin.fmi < 0.15 ? 2.4 : 1, gbm: 'Normal (0.71)' };
  const live = !CASES[name];
  const label = live
    ? s.fmiMin.fmi < FIELD.fmiLimit ? CASES['Rod float'].label : s.now.fillage < FIELD.fillageLimit ? CASES['Fluid pound'].label : 'normal operation within envelope'
    : c.label;
  const cards = useMemo(() => makeCards(s, c), [s, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = cards.pump.reduce((a, p, i, arr) => { const q = arr[(i + 1) % arr.length]; return a + (p.x * q.L - q.x * p.L) / 2; }, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card
        title="Surface card → downhole card (Gibbs inverse solve)" icon={Activity} className="lg:col-span-8"
        right={
          <select value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-sm" aria-label="Card case">
            {Object.keys(CASES).map((k) => <option key={k}>{k}</option>)}
          </select>
        }
      >
        <Legend items={[['surface card (measured)', '#8C8C9A'], ['downhole pump card (computed)', VIZ.pink]]} />
        <div className="mt-2 h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical />
              <XAxis type="number" dataKey="x" {...AXIS} unit=" m" domain={[-0.2, 3.4]} />
              <YAxis type="number" dataKey="L" {...AXIS} unit=" kN" width={52} />
              <Tooltip formatter={(v) => v.toFixed(1)} />
              <ReferenceLine y={0} stroke="#16161D" />
              <Scatter data={cards.surface} line={{ stroke: '#8C8C9A', strokeWidth: 1.5 }} shape={() => null} isAnimationActive={false} />
              <Scatter data={cards.pump} line={{ stroke: VIZ.pink, strokeWidth: 2.5 }} shape={() => null} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Diagnosis = fitted parameter set" icon={Microscope} className="lg:col-span-4">
        <StatRow label="Pump fillage" value={fmt.pct(c.fill)} tone={c.fill < FIELD.fillageLimit ? 'warn' : 'ok'} />
        <StatRow label="Best-fit gas void fraction" value={fmt.n2(c.gvf)} />
        <StatRow label="Best-fit μ at pump" value={fmt.n0(s.now.mu * (live ? 1 : c.drag))} unit="cP" />
        <StatRow label="Leakage / slippage" value={fmt.pct(c.leak)} />
        <StatRow label="Card area (work/stroke)" value={fmt.n1(Math.abs(area))} unit="kJ" />
        <StatRow label="Time in compression" value={fmt.pct(Math.max(0, c.drag - 1) * 0.12)} />
        <div className="mt-4 rounded-xl border border-line bg-canvas p-3 text-sm">
          <span className="font-semibold">“Fillage {fmt.pct(c.fill)}; best-fit gas void fraction {fmt.n2(c.gvf)} — {label}.”</span>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-ink-2">
          <span>Classifier first-pass screen</span>
          <Badge tone="grey">{c.gbm}</Badge>
        </div>
        <p className="mt-2 text-xs text-ink-3">The screen is fast but only gives a label. The inverse solve above is what counts, because it gives the mechanism with numbers.</p>
      </Card>
    </div>
  );
}

function Fatigue({ s }) {
  const alt = useMemo(() => {
    const fr = fmiProfile(s.prof, s.mpc.spm, s.mpc.down);
    return loads(fr, s.mpc.spm, s.mpc.down, s.mpc.gross ?? s.now.gross);
  }, [s]);
  const line = Array.from({ length: 11 }, (_, i) => { const smin = -40 + i * 20; return { smin, smax: (793 / 4 + 0.5625 * smin) * 0.9 }; });
  const pts = [
    { name: 'Current setpoint', smin: s.loads.sMin, smax: s.loads.sMax, color: VIZ.pink },
    { name: 'MPC recommendation', smin: alt.sMin, smax: alt.sMax, color: VIZ.purple },
  ];
  const compression = s.fmiZ.filter((r) => r.fmi < 0);
  const neutral = compression.length ? Math.min(...compression.map((r) => r.z)) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card title="Modified Goodman diagram (top rod, grade D)" icon={Wrench} className="lg:col-span-7" right={<Legend items={[['allowable', '#DC2626', true], ['current', VIZ.pink], ['MPC', VIZ.purple]]} />}>
        <div className="h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical />
              <XAxis type="number" dataKey="smin" {...AXIS} unit=" MPa" domain={[-40, 160]} name="σ min" />
              <YAxis type="number" dataKey="smax" {...AXIS} unit=" MPa" domain={[0, 300]} width={58} name="σ max" />
              <Tooltip formatter={(v) => `${fmt.n0(v)} MPa`} />
              <Scatter data={line} line={{ stroke: '#DC2626', strokeDasharray: '5 4' }} shape={() => null} isAnimationActive={false} />
              <Scatter data={pts} isAnimationActive={false}>
                {pts.map((p) => <Cell key={p.name} fill={p.color} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <Eq note="SF = 0.9 service factor. Stress range ÷ allowable range = Goodman usage.">S_A = (T/4 + 0.5625·σ_min)·SF</Eq>
      </Card>
      <div className="space-y-4 lg:col-span-5">
        <Card title="Consumed rod life">
          {pts.map((p, i) => {
            const g = i === 0 ? s.loads.goodman : alt.goodman;
            return (
              <div key={p.name} className="mb-4 last:mb-0">
                <div className="mb-1.5 flex justify-between text-sm"><span className="text-ink-2">{p.name}</span><span className="num font-semibold">{fmt.pct(g)} of allowable range</span></div>
                <Bar value={g} color={p.color} marker={1} max={1.2} />
              </div>
            );
          })}
          <p className="mt-3 text-sm text-ink-2">Relative fatigue life at MPC setpoint: <b className="num text-ink">×{Math.min(9.9, (s.loads.goodman / alt.goodman) ** 6).toFixed(1)}</b> (S-N exponent 6).</p>
        </Card>
        <Card title="Lubinski buckling check">
          <StatRow label="Segment in compression" value={compression.length ? `${compression.length * 20} m` : 'none'} tone={compression.length ? 'crit' : 'ok'} />
          <StatRow label="Neutral point" value={neutral != null ? `${neutral} m` : '—'} />
          <StatRow label="Peak polished-rod load" value={fmt.n1(s.loads.PPRL / 1000)} unit="kN" />
          <StatRow label="Min polished-rod load" value={fmt.n1(s.loads.MPRL / 1000)} unit="kN" tone={s.loads.MPRL < 0 ? 'crit' : undefined} />
          <p className="mt-3 text-xs text-ink-3">Compressed segments are checked for helical buckling onset and tubing contact load. Each stroke in compression adds to the rod-failure hazard.</p>
        </Card>
      </div>
    </div>
  );
}
