import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ScatterChart, Scatter, Cell } from 'recharts';
import { Atom, Sigma, FunctionSquare, Cpu, AlertTriangle } from 'lucide-react';
import { PageHeader, Card, Eq, Badge, Legend, Status, VIZ, AXIS, GRID } from '../components/ui';
import { enkfParams, enkfTrace } from '../data/twin';

const TABS = ['EnKF parameters', 'GP residual', 'Symbolic regression', 'PINN surrogate'];

export default function Learning({ ctx }) {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <>
      <PageHeader
        title="Learning layer"
        subtitle="The physics sets the state equations. Learning has four jobs: estimate named parameters, learn bounded corrections, build fast surrogates, and find closed-form correlations. Each output has a name, units and an uncertainty band."
        tabs={TABS} tab={tab} onTab={setTab}
      />
      {tab === 'EnKF parameters' && <Enkf well={ctx.well} />}
      {tab === 'GP residual' && <Gp />}
      {tab === 'Symbolic regression' && <Symbolic />}
      {tab === 'PINN surrogate' && <Pinn />}
    </>
  );
}

const show = (x) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-IN') : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3));

function Enkf({ well }) {
  const params = useMemo(() => enkfParams(well), [well]);
  const [key, setKey] = useState('skin');
  const p = params.find((x) => x.key === key);
  const trace = useMemo(() => enkfTrace(p), [p]);
  return (
    <div className="space-y-4">
      <Card pad="p-0" className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Atom size={16} className="text-ink-3" /> Live parameter table · {well.id}</h2>
          <span className="text-xs text-ink-3">ensemble of 64 physics models · click a row</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-line bg-canvas">
              <tr>{['Estimated parameter', 'Units', 'Prior (mean ± σ)', 'Posterior (mean ± σ)', 'Band collapse', 'Updated from'].map((c) => <th key={c} className="th">{c}</th>)}</tr>
            </thead>
            <tbody>
              {params.map((r) => {
                const shrink = 1 - r.post[1] / r.prior[1];
                return (
                  <tr key={r.key} onClick={() => setKey(r.key)} className={`cursor-pointer border-b border-line last:border-0 hover:bg-canvas ${key === r.key ? 'bg-brand-50/60' : ''}`}>
                    <td className="td font-medium">
                      {r.name}
                      {r.flag && <Badge tone="warn" className="ml-2"><AlertTriangle size={11} /> drift</Badge>}
                    </td>
                    <td className="td text-ink-2">{r.unit}</td>
                    <td className="td text-ink-2">{show(r.prior[0])} ± {show(r.prior[1])}</td>
                    <td className="td font-semibold">{show(r.post[0])} ± {show(r.post[1])}</td>
                    <td className="td">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 rounded-full bg-[#F1F1F5]"><span className="block h-1.5 rounded-full bg-viz-green" style={{ width: `${shrink * 100}%` }} /></span>
                        <span className="text-xs text-ink-2">−{Math.round(shrink * 100)}%</span>
                      </span>
                    </td>
                    <td className="td text-ink-2">{r.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={`Assimilation trace: ${p.name}`} className="lg:col-span-2" right={<Legend items={[['posterior mean', VIZ.purple], ['±2σ band', '#D9CCFF'], ['synthetic truth', '#8C8C9A', true]]} />}>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={trace} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="step" {...AXIS} />
                <YAxis {...AXIS} width={52} domain={['auto', 'auto']} tickFormatter={show} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? v.map(show).join(' – ') : show(v))} labelFormatter={(l) => `Assimilation step ${l}`} />
                <Area dataKey="band" stroke="none" fill="#D9CCFF" fillOpacity={0.6} isAnimationActive={false} />
                <Line dataKey="truth" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Line dataKey="mean" stroke={VIZ.purple} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="The learning is a diagnostic">
          {p.flag ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <b>{p.flag}.</b> Skin has risen steadily from cycle to cycle, from 1.6 to {well.skin.toFixed(1)} over {well.cycle} cycles. That isn't a model artefact. It points to asphaltene deposition near the wellbore. Posterior ±{p.post[1]} (1σ).
            </div>
          ) : (
            <p className="text-sm text-ink-2">{p.name} has converged from its prior. The band is {Math.round((1 - p.post[1] / p.prior[1]) * 100)}% narrower, estimated from {p.source}.</p>
          )}
          <p className="mt-3 text-sm text-ink-2">To answer “is this a black box?”, show this table: named physical parameters, each with error bars.</p>
        </Card>
      </div>
    </div>
  );
}

function Gp() {
  const pts = useMemo(() => {
    let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    return Array.from({ length: 70 }, () => {
      const V = 1500 + Math.abs(r() + 0.5) * 3000;
      const thief = V > 3700 ? (V - 3700) / 60 : 0;
      const d = Math.max(-15, Math.min(15, r() * 7 - thief));
      return { V, d, clamped: Math.abs(d) === 15 };
    });
  }, []);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Residual δ(x) vs steam volume" icon={Sigma} className="lg:col-span-2">
        <div className="h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical />
              <XAxis type="number" dataKey="V" {...AXIS} unit=" t" domain={[1500, 4500]} name="Steam volume" />
              <YAxis type="number" dataKey="d" {...AXIS} unit="%" domain={[-20, 20]} width={44} name="δ" />
              <Tooltip formatter={(v) => Math.round(v)} />
              <ReferenceArea x1={3700} x2={4500} fill={VIZ.orange} fillOpacity={0.08} label={{ value: 'thief-zone override?', position: 'insideTop', fontSize: 11, fill: '#B45309' }} />
              <ReferenceLine y={15} stroke="#DC2626" strokeDasharray="4 3" label={{ value: '+15% hard bound', position: 'insideTopLeft', fontSize: 11, fill: '#DC2626' }} />
              <ReferenceLine y={-15} stroke="#DC2626" strokeDasharray="4 3" label={{ value: '−15% hard bound', position: 'insideBottomLeft', fontSize: 11, fill: '#DC2626' }} />
              <ReferenceLine y={0} stroke="#16161D" />
              <Scatter data={pts} isAnimationActive={false}>
                {pts.map((p, i) => <Cell key={i} fill={p.clamped ? '#DC2626' : p.V > 3700 ? VIZ.orange : VIZ.purple} fillOpacity={0.75} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Kennedy–O’Hagan calibration">
        <Eq note="The GP learns only the discrepancy δ, clipped to ±15% of the physics prediction.">y_obs = f_physics(x, θ) + δ(x) + ε</Eq>
        <ul className="mt-4 space-y-3 text-sm text-ink-2">
          <li><b className="text-ink">Physics stays the backbone.</b> The GP can only shift a valid answer by a bounded amount, so it can't produce a physically absurd one.</li>
          <li><b className="text-ink">Calibrated uncertainty.</b> Every prediction comes with a confidence interval.</li>
          <li><b className="text-ink">Where δ is large is itself a finding.</b> The residual only grows above ~3,700 t of steam, which points to thief-zone override that the 1-D thermal model doesn't capture.</li>
        </ul>
      </Card>
    </div>
  );
}

const SR = [
  { target: 'Field viscosity law μ(T, asphaltene)', rows: [
    { c: 5, loss: 0.081, eq: 'μ = 2.1·10⁵ · T^(−2.31)' },
    { c: 9, loss: 0.019, eq: 'μ = exp(8.41 − 0.047·T) · (1 + 0.62·w_asph)', pick: true },
    { c: 17, loss: 0.017, eq: 'μ = exp(8.39 − 0.046·T + 0.00003·T²) · (1 + 0.58·w_asph + 0.9·w_asph²)' },
  ] },
  { target: 'Soak-time efficiency η(t_soak, V_steam)', rows: [
    { c: 5, loss: 0.064, eq: 'η = 1 − e^(−t_soak/2.6)' },
    { c: 11, loss: 0.022, eq: 'η = (1 − e^(−t_soak/2.5)) · (1 − 0.011·t_soak) · V^0.04', pick: true },
  ] },
  { target: 'Rod-failure hazard λ(ΔL, t_comp)', rows: [
    { c: 7, loss: 0.110, eq: 'λ = 0.002 · ΔL^1.8' },
    { c: 11, loss: 0.041, eq: 'λ = 0.0017 · ΔL^1.6 · (1 + 4.2·t_comp)', pick: true },
  ] },
];

function Symbolic() {
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        PySR searches for equations on field and synthetic data. Each target below shows its Pareto front of complexity against loss. The highlighted equation is the one proposed for engineer sign-off:
        it can be printed, checked for dimensions, and added to the Baghewala operating manual.
      </p>
      {SR.map((t) => (
        <Card key={t.target} title={t.target} icon={FunctionSquare} pad="p-0" className="overflow-hidden">
          <table className="w-full">
            <thead className="border-y border-line bg-canvas"><tr>{['Complexity', 'Loss', 'Equation', ''].map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.eq} className={`border-b border-line last:border-0 ${r.pick ? 'bg-brand-50/60' : ''}`}>
                  <td className="td w-28">{r.c}</td>
                  <td className="td w-28">{r.loss.toFixed(3)}</td>
                  <td className="td eq whitespace-normal">{r.eq}</td>
                  <td className="td w-40">{r.pick ? <Badge tone="info">Proposed for sign-off</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

const PINN = [
  { id: 'pinn-v7', resid: 0.8, err: 1.9, grad: 'pass', status: 'ok', note: 'Deployed to optimizer' },
  { id: 'pinn-v6', resid: 1.1, err: 2.4, grad: 'pass', status: 'ok', note: 'Superseded' },
  { id: 'pinn-v5', resid: 6.3, err: 1.7, grad: 'pass', status: 'crit', note: 'Rejected: energy balance violated' },
];

function Pinn() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Validation against the numerical solver" icon={Cpu} pad="p-0" className="overflow-hidden lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-line bg-canvas"><tr>{['Candidate', 'Energy-balance residual', 'Max T error vs solver', 'Gradient check', 'Status'].map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
            <tbody>
              {PINN.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="td font-medium">{r.id}</td>
                  <td className="td">{r.resid.toFixed(1)}% <span className="text-ink-3">(limit 2%)</span></td>
                  <td className="td">{r.err.toFixed(1)} °C</td>
                  <td className="td">{r.grad}</td>
                  <td className="td"><Status tone={r.status}>{r.note}</Status></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-5">
          <Eq note="Trained on the 2-D axisymmetric heat equation. The optimizer makes ~10⁴ calls to it.">𝓛 = ‖ρc·∂ₜT − ∇·(k∇T) + q‖² + 𝓛_BC + λ·𝓛_data</Eq>
        </div>
      </Card>
      <Card title="Its role, stated plainly">
        <p className="text-sm text-ink-2">The numerical solver stays the ground truth. The PINN is a compressed, differentiable copy of it. A candidate that breaks the energy balance is rejected at validation (see v5) and never deployed.</p>
        <p className="mt-3 text-sm text-ink-2">What it buys is exact gradients for the CSS optimizer, which is what makes gradient-based cycle design practical.</p>
      </Card>
    </div>
  );
}
