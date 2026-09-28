import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea,
} from 'recharts';
import { Atom, Sigma, FunctionSquare, Cpu, ShieldCheck, Activity, Brain, Thermometer } from 'lucide-react';
import { PageHeader, Card, Eq, Tex, Badge, Legend, Status, StatRow, VIZ, AXIS, GRID } from '../components/ui';
import { pinn, enkf, gp, eqs, AI } from '../data/ml';

export const LEARN_TABS = ['PINN surrogate', 'EnKF assimilation', 'GP residual', 'Symbolic regression'];

export default function Learning({ ctx }) {
  const tab = ctx.learnTab;
  return (
    <>
      <PageHeader
        title="Learning Layers"
        subtitle="The AI half of the digital twin: four models that learn from the well's data. Each one is bounded by physics and has to pass a check before the twin trusts it."
        tabs={LEARN_TABS} tab={tab} onTab={ctx.setLearnTab}
      />
      <AiStrip active={tab} onPick={ctx.setLearnTab} />
      <div className="mt-6">
        {tab === 'PINN surrogate' && <Pinn />}
        {tab === 'EnKF assimilation' && <Enkf />}
        {tab === 'GP residual' && <Gp />}
        {tab === 'Symbolic regression' && <Symbolic />}
      </div>
    </>
  );
}

const f1 = (x) => x.toFixed(1);
const show = (x) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-IN') : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3));

// Four headline tiles: one per model, every number read from ushna/ml/artifacts/.
export function AiStrip({ active, onPick }) {
  const tiles = [
    { tab: 'PINN surrogate', icon: Brain, name: 'Physics-informed neural net', value: `${f1(AI.pinn.rmse)} °C`,
      note: `error on designs it never saw · ${Math.round(AI.pinn.speedup)}× faster than the solver`,
      badge: AI.pinn.trained ? ['ok', 'Trained · audited'] : ['crit', 'Held back'] },
    { tab: 'EnKF assimilation', icon: Atom, name: 'Ensemble Kalman filter', value: `−${Math.round(AI.enkf.collapse)}%`,
      note: `uncertainty on permeability-thickness after ${AI.enkf.days} days of data`, badge: ['info', 'Assimilating'] },
    { tab: 'GP residual', icon: Sigma, name: 'Gaussian-process residual', value: `${f1(AI.gp.found)}%`,
      note: `rate loss the physics missed, found by the GP (true ${f1(AI.gp.truth)}%)`, badge: ['info', `Bounded ±${AI.gp.bound}%`] },
    { tab: 'Symbolic regression', icon: FunctionSquare, name: 'Symbolic regression', value: `${AI.sr.count} laws`,
      note: `closed-form field correlations, R² ≥ ${AI.sr.minR2.toFixed(3)}`, badge: ['grey', 'For sign-off'] },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <button
          key={t.tab}
          onClick={() => onPick(t.tab)}
          aria-pressed={active === t.tab}
          className={`card p-4 text-left transition-colors hover:border-brand-200 ${active === t.tab ? 'border-brand-500 ring-1 ring-brand-500' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2"><t.icon size={15} className="text-brand-600" />{t.name}</span>
            <Badge tone={t.badge[0]}>{t.badge[1]}</Badge>
          </div>
          <div className="mt-2 text-2xl font-bold num">{t.value}</div>
          <p className="mt-0.5 text-xs text-ink-2">{t.note}</p>
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── PINN ─────────────────────────────
const DAY_COLORS = { 0: VIZ.pink, 30: VIZ.orange, 60: VIZ.purple, 120: VIZ.blue };

function Pinn() {
  const hist = pinn.history;
  const profData = useMemo(() => {
    const c = pinn.profiles.curves;
    return c[0].r.map((r, i) => ({ r, ...Object.fromEntries(c.flatMap((d) => [[`s${d.day}`, d.solver_c[i]], [`p${d.day}`, d.pinn_c[i]]])) }));
  }, []);
  const audit = pinn.energy_audit;
  const auditData = audit.days.map((d, i) => ({ d, pinn: audit.pinn_imbalance_pct[i], solver: audit.solver_imbalance_pct[i] }));
  const g = pinn.gates || { rmse_limit_c: 5 };
  const accOk = pinn.validation.val_rmse_c <= g.rmse_limit_c;
  const lastLoss = hist[hist.length - 1];
  const rh = pinn.profiles.r_h;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card title="Training: losses and error on unseen designs" icon={Activity} className="lg:col-span-7"
        right={<Legend items={[['total loss', VIZ.purple], ['physics (PDE)', VIZ.pink], ['sensor data', VIZ.orange], ['held-out RMSE °C', VIZ.blue]]} />}>
        <div className="h-64">
          <ResponsiveContainer>
            <ComposedChart data={hist} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="iter" type="number" {...AXIS} domain={[0, 'dataMax']} ticks={[0, 1000, 2000, 3000, 4000, 5000].filter((v) => v <= pinn.training.iterations)} tickFormatter={(v) => (v ? `${v / 1000}k` : '0')} />
              <YAxis yAxisId="l" scale="log" domain={['auto', 'auto']} {...AXIS} width={48} allowDataOverflow tickFormatter={(v) => v.toExponential(0)} />
              <YAxis yAxisId="e" orientation="right" {...AXIS} width={36} domain={[0, 'auto']} unit="°" />
              <Tooltip formatter={(v, n) => (n === 'held-out RMSE' ? `${f1(v)} °C` : v.toExponential(2))} labelFormatter={(l) => `Iteration ${l}`} />
              <Line yAxisId="l" dataKey="loss" name="total" stroke={VIZ.purple} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line yAxisId="l" dataKey="pde" name="physics" stroke={VIZ.pink} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line yAxisId="l" dataKey="data" name="sensor data" stroke={VIZ.orange} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line yAxisId="e" dataKey="val_rmse_c" name="held-out RMSE" stroke={VIZ.blue} strokeWidth={2} connectNulls dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {pinn.training.iterations.toLocaleString('en-IN')} Adam iterations, {pinn.training.collocation_per_iter.toLocaleString('en-IN')} random physics points each, trained in {Math.round(pinn.training.seconds)} s on a laptop CPU.
          Held-out error is measured on heated radii of {pinn.training.holdout_designs_r_h.join(' and ')} m, which the network never trained on.
        </p>
      </Card>

      <Card tour="pinn" title="Release gates" icon={ShieldCheck} className="lg:col-span-5"
        right={<Status tone={pinn.status === 'trained' ? 'ok' : 'crit'}>{pinn.status === 'trained' ? 'Released to optimizer' : 'Held back'}</Status>}>
        <StatRow label="Error on unseen designs (RMSE)" value={<span className="flex items-center gap-2">{f1(pinn.validation.val_rmse_c)} °C <Status tone={accOk ? 'ok' : 'crit'}>≤ {g.rmse_limit_c} °C</Status></span>} />
        <StatRow label="Worst-case error" value={f1(pinn.validation.val_max_c)} unit="°C" />
        <StatRow label="Energy audit, worst day" value={<span className="flex items-center gap-2">{audit.max_imbalance_pct.toFixed(2)}% <Status tone={audit.passed ? 'ok' : 'crit'}>≤ {audit.limit_pct}%</Status></span>} />
        <StatRow label="Physics residual (final)" value={lastLoss.pde.toExponential(1)} />
        <StatRow label="Speed vs finite-volume solver" value={`${Math.round(pinn.speed.speedup)}×`} unit={`${pinn.speed.pinn_ms} ms vs ${pinn.speed.solver_ms} ms`} />
        <StatRow label="Network" value={`${pinn.architecture.hidden.length}×${pinn.architecture.hidden[0]} tanh`} unit={`${pinn.architecture.parameters.toLocaleString('en-IN')} weights`} />
        {pinn.trained_at && <StatRow label="Last trained" value={pinn.trained_at} />}
        <p className="mt-3 text-xs text-ink-3">A network that fails either gate is never handed to the CSS optimizer. The solver stays the ground truth; the PINN is its fast, differentiable copy.</p>
      </Card>

      <Card title={`PINN vs solver on a design it never saw (r_h = ${rh} m)`} icon={Thermometer} className="lg:col-span-7"
        right={<Legend items={[...Object.entries(DAY_COLORS).map(([d, c]) => [`day ${d}`, c]), ['PINN (dashed)', '#8C8C9A', true]]} />}>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={profData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="r" type="number" {...AXIS} domain={[0, 40]} allowDataOverflow unit=" m" />
              <YAxis {...AXIS} width={44} unit="°" domain={[40, 260]} />
              <Tooltip formatter={(v, n) => [`${f1(v)} °C`, n]} labelFormatter={(l) => `r = ${l} m, mid-pay`} />
              {Object.entries(DAY_COLORS).map(([d, c]) => (
                <React.Fragment key={d}>
                  <Line dataKey={`s${d}`} name={`solver day ${d}`} stroke={c} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey={`p${d}`} name={`PINN day ${d}`} stroke="#16161D" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </React.Fragment>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-3">Temperature across the heated zone at mid-pay as it cools. Coloured: finite-volume solver. Dashed: the PINN.</p>
      </Card>

      <Card title="Heated-zone average temperature" icon={Thermometer} className="lg:col-span-5" right={<Legend items={[['solver', VIZ.pink], ['PINN', '#16161D', true]]} />}>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={pinn.tbar.curve} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="day" type="number" {...AXIS} domain={[0, pinn.physics.horizon_days]} />
              <YAxis {...AXIS} width={44} unit="°" domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => `${f1(v)} °C`} labelFormatter={(l) => `Day ${l}`} />
              <Line dataKey="solver_c" name="solver" stroke={VIZ.pink} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="pinn_c" name="PINN" stroke="#16161D" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-3">T̄(t) is the number the reservoir model and the cut-off rule consume.</p>
      </Card>

      <Card title="Energy audit: is heat conserved?" icon={ShieldCheck} className="lg:col-span-5" right={<Legend items={[['PINN', VIZ.purple], ['solver', '#8C8C9A', true]]} />}>
        <div className="h-52">
          <ResponsiveContainer>
            <LineChart data={auditData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="d" type="number" {...AXIS} domain={[0, pinn.physics.horizon_days]} />
              <YAxis {...AXIS} width={44} unit="%" domain={[-audit.limit_pct * 1.5, audit.limit_pct * 1.5]} allowDataOverflow />
              <Tooltip formatter={(v) => `${v.toFixed(3)}%`} labelFormatter={(l) => `Day ${l}`} />
              <ReferenceArea y1={-audit.limit_pct} y2={audit.limit_pct} fill={VIZ.green} fillOpacity={0.08} />
              <ReferenceLine y={audit.limit_pct} stroke="#DC2626" strokeDasharray="4 3" label={{ value: `+${audit.limit_pct}% limit`, position: 'insideTopRight', fontSize: 11, fill: '#DC2626' }} />
              <ReferenceLine y={-audit.limit_pct} stroke="#DC2626" strokeDasharray="4 3" />
              <Line dataKey="solver" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="pinn" stroke={VIZ.purple} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-3">The boundaries are insulated, so the field must keep all {Math.round(audit.injected_gj).toLocaleString('en-IN')} GJ it started with. Checked on the network's own output, every 10 days.</p>
      </Card>

      <Card title="How it is built" icon={Cpu} className="lg:col-span-7">
        <Eq note="The initial condition is built in exactly, so the network only learns how the heat moves.">
          {String.raw`\theta(r,z,t;\,r_h) = \theta_0(r,z;\,r_h) + \frac{t}{t_{end}}\,\mathrm{NN}(r,z,t,r_h)`}
        </Eq>
        <div className="mt-3">
          <Eq>
            {String.raw`\mathcal{L} = \underbrace{\left\lVert \partial_t\theta - \alpha\left(\partial_{rr}\theta + \tfrac{1}{r}\partial_r\theta + \partial_{zz}\theta\right)\right\rVert^2}_{\text{physics}} + \underbrace{\left\lVert \theta - \theta_{sensor}\right\rVert^2}_{\text{DTS + obs. wells}} + \underbrace{\left\lVert \partial_n\theta \right\rVert^2}_{\text{boundaries}}`}
          </Eq>
        </div>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          <li><b className="text-ink">One network, the whole design space.</b> Heated radius r<sub>h</sub> is an input, so the optimizer can try any steam volume without retraining.</li>
          <li><b className="text-ink">Trained on sparse sensors, not a full field.</b> {pinn.training.sensors}, with ±{pinn.training.sensor_noise_c} °C noise. The physics loss fills in everywhere else.</li>
          <li><b className="text-ink">Code:</b> <code className="text-xs">ushna/ml/pinn_training.py</code> (PyTorch training, NumPy inference) · <code className="text-xs">ushna/ml/train.py</code></li>
        </ul>
      </Card>
    </div>
  );
}

// ───────────────────────────── EnKF ─────────────────────────────
const LABELS = { kh: 'Permeability-thickness kh', skin: 'Skin s', k_ob: 'Overburden conductivity k_ob', c_rod: 'Rod damping c', A_visc: 'Walther A', B_visc: 'Walther B', eta_slip: 'Pump slippage' };

function Enkf() {
  const names = Object.keys(enkf.units);
  const lastRow = enkf.daily_trace[enkf.daily_trace.length - 1];
  const rows = names.map((n) => {
    const [pm, ps] = enkf.prior[n], [m, s] = lastRow[n], truth = enkf.true_params[n];
    const collapse = 1 - s / ps;
    const held = collapse < 0.05;
    const err = (m - truth) / truth;
    // recovered: inside its own 2σ band, or within a 15% engineering tolerance
    return { n, pm, ps, m, s, truth, collapse, held, err, hit: Math.abs(m - truth) <= 2 * s || Math.abs(err) <= 0.15 };
  });
  const [key, setKey] = useState('kh');
  const p = rows.find((r) => r.n === key);
  const trace = enkf.daily_trace.map((d) => ({ day: d.day, mean: d[key][0], band: [d[key][0] - 2 * d[key][1], d[key][0] + 2 * d[key][1]], truth: enkf.true_params[key] }));

  return (
    <div className="space-y-4">
      <Card pad="p-0" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Atom size={16} className="text-ink-3" /> What the filter learned in {AI.enkf.days} days</h2>
          <span className="text-xs text-ink-3">twin experiment: data generated from known true values · click a row</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-line bg-canvas">
              <tr>{['Parameter', 'Units', 'Prior (mean ± σ)', 'Learned (mean ± σ)', 'True value', 'Uncertainty cut', 'Verdict'].map((c) => <th key={c} className="th">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n} onClick={() => setKey(r.n)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-canvas ${key === r.n ? 'bg-brand-50/60' : ''}`}>
                  <td className="td font-medium">{LABELS[r.n] || r.n}</td>
                  <td className="td text-ink-2">{enkf.units[r.n]}</td>
                  <td className="td text-ink-2">{show(r.pm)} ± {show(r.ps)}</td>
                  <td className="td font-semibold">{show(r.m)} ± {show(r.s)}</td>
                  <td className="td text-ink-2">{show(r.truth)} <span className="text-xs text-ink-3">({r.err >= 0 ? '+' : '−'}{Math.abs(Math.round(r.err * 100))}%)</span></td>
                  <td className="td">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-20 rounded-full bg-[#F1F1F5]"><span className="block h-1.5 rounded-full bg-viz-green" style={{ width: `${Math.max(0, r.collapse) * 100}%` }} /></span>
                      <span className="text-xs text-ink-2">−{Math.max(0, Math.round(r.collapse * 100))}%</span>
                    </span>
                  </td>
                  <td className="td">
                    {r.held ? <Badge tone="grey">held (card / PVT)</Badge>
                      : r.hit ? <Status tone="ok">recovered</Status> : <Status tone="warn">weakly observable</Status>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card tour="enkf" title={`Assimilation: ${LABELS[key] || key}`} className="lg:col-span-2" right={<Legend items={[['learned mean', VIZ.purple], ['±2σ band', '#D9CCFF'], ['true value', '#8C8C9A', true]]} />}>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={trace} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="day" type="number" {...AXIS} domain={['dataMin', 'dataMax']} />
                <YAxis {...AXIS} width={56} domain={['auto', 'auto']} tickFormatter={show} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? v.map(show).join(' – ') : show(v))} labelFormatter={(l) => `Day ${l}`} />
                <Area dataKey="band" stroke="none" fill="#D9CCFF" fillOpacity={0.6} isAnimationActive={false} />
                <Line dataKey="truth" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Line dataKey="mean" stroke={VIZ.purple} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Reading the result">
          <p className="text-sm text-ink-2">
            Every day, {40} copies of the physics model are nudged toward the latest temperature and rate. Where they agree, the band narrows.
            On kh the uncertainty fell {Math.round(AI.enkf.collapse)}%.
          </p>
          <p className="mt-3 text-sm text-ink-2">
            {p.held ? `${LABELS[key]} is deliberately held: temperature and rate cannot see it, so it waits for dynamometer-card or lab PVT data.`
              : p.hit ? `${LABELS[key]} was recovered: learned ${show(p.m)} against a true ${show(p.truth)} (${p.err >= 0 ? '+' : '−'}${Math.abs(Math.round(p.err * 100))}%).`
                : `${LABELS[key]} is only weakly visible in temperature and rate, so the filter does not claim more certainty than the data supports. Card data tightens it.`}
          </p>
          <p className="mt-3 text-xs text-ink-3">This is a twin experiment: the data were generated from known true parameters, which is the only way to prove the filter recovers the truth before trusting it on field data.</p>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────────── GP ─────────────────────────────
function Gp() {
  const data = gp.day.map((d, i) => ({ d, obs: gp.observed_residual_pct[i], mean: gp.gp_mean_pct[i], band: [gp.gp_lo_pct[i], gp.gp_hi_pct[i]], truth: gp.true_unmodelled_pct[i] }));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="What the physics missed: residual δ over the cycle" icon={Sigma} className="lg:col-span-2"
        right={<Legend items={[['field − physics', VIZ.orange], ['GP mean', VIZ.purple], ['95% band', '#D9CCFF'], ['true unmodelled loss', '#8C8C9A', true]]} />}>
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="d" type="number" {...AXIS} domain={['dataMin', 'dataMax']} />
              <YAxis {...AXIS} unit="%" domain={[-gp.bound_pct - 5, gp.bound_pct + 5]} width={48} allowDataOverflow />
              <Tooltip formatter={(v) => (Array.isArray(v) ? v.map((x) => `${x.toFixed(1)}%`).join(' – ') : `${v.toFixed(1)}%`)} labelFormatter={(l) => `Day ${l}`} />
              <ReferenceLine y={gp.bound_pct} stroke="#DC2626" strokeDasharray="4 3" label={{ value: `+${gp.bound_pct}% hard bound`, position: 'insideTopLeft', fontSize: 11, fill: '#DC2626' }} />
              <ReferenceLine y={-gp.bound_pct} stroke="#DC2626" strokeDasharray="4 3" label={{ value: `−${gp.bound_pct}% hard bound`, position: 'insideBottomLeft', fontSize: 11, fill: '#DC2626' }} />
              <ReferenceLine y={0} stroke="#16161D" />
              <Area dataKey="band" stroke="none" fill="#D9CCFF" fillOpacity={0.6} isAnimationActive={false} />
              <Scatter dataKey="obs" fill={VIZ.orange} fillOpacity={0.7} isAnimationActive={false} />
              <Line dataKey="truth" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="mean" stroke={VIZ.purple} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Kennedy–O'Hagan calibration">
        <Eq note={`The GP learns only the discrepancy δ, clipped to ±${gp.bound_pct}% of the physics prediction.`}>{String.raw`y_{obs} = f_{physics}(x,\theta) + \delta(x) + \varepsilon`}</Eq>
        <ul className="mt-4 space-y-3 text-sm text-ink-2">
          <li><b className="text-ink">It found the gap.</b> The field rate drifts {f1(AI.gp.truth)}% below the physics by day {gp.day[gp.day.length - 1]}; the GP recovered {f1(AI.gp.found)}% (RMSE {gp.rmse_vs_truth_pct.toFixed(1)} points).</li>
          <li><b className="text-ink">A growing deficit is a finding.</b> It is the signature of near-wellbore skin damage, which is what the EnKF re-estimates and the solvent-treatment card acts on.</li>
          <li><b className="text-ink">Physics stays the backbone.</b> The correction can never exceed ±{gp.bound_pct}%, so it cannot produce a physically absurd answer.</li>
        </ul>
      </Card>
    </div>
  );
}

// ─────────────────────────── Symbolic regression ───────────────────────────
const SR_TITLES = { viscosity_law: 'Field viscosity law μ(T, asphaltene)', soak_efficiency: 'Soak thermal retention η(t_soak, V_steam)', rod_hazard: 'Rod failure hazard H(ΔF, t_comp)' };

function Symbolic() {
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        The discovered laws are short enough to print, check for units, and add to the Baghewala operating manual after an engineer signs them off.
        These fits use synthetic lab-style data with measurement noise; they are refitted on measured PVT, soak and rod-failure records before operational use.
      </p>
      {Object.entries(eqs).map(([k, e]) => (
        <Card key={k} title={SR_TITLES[k] || k} icon={FunctionSquare} right={<Badge tone="info">Proposed for sign-off</Badge>}>
          <div className="overflow-x-auto rounded-xl border border-line bg-canvas px-4 py-3"><Tex block>{e.latex}</Tex></div>
          <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
            <StatRow label="Fit quality R²" value={e.r2_score.toFixed(4)} />
            <StatRow label="RMSE" value={e.rmse >= 1 ? show(e.rmse) : e.rmse.toExponential(2)} />
          </div>
          <p className="mt-2 text-xs text-ink-3">{e.signoff}</p>
        </Card>
      ))}
    </div>
  );
}
