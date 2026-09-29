import React from 'react';
import { ArrowDown, RotateCcw } from 'lucide-react';
import { PageHeader, Card, Status, sub } from '../components/ui';

const REQS = [
  ['Optimize Cyclic Steam Stimulation (CSS) cycle parameters', 'Marx–Langenheim / Boberg–Lantz core driving NPV Bayesian optimization', 'CssDesign', 'Cyclic Steam Design'],
  ['Predict reservoir heating, cooling and production', 'Thermal decline model + trained PINN surrogate, corrected by EnKF', 'Learning', 'Learning Layers'],
  ['Continuously optimize Sucker Rod Pump (SRP) stroke speed and strokes per minute (SPM)', 'MPC on the Gibbs rod model, driven by μ(T_pump)', 'SrpControl', 'Sucker Rod Pump Control'],
  ['Detect rod float; minimise impact loading', 'Float Margin Index as live scalar and hard MPC constraint; asymmetric VFD stroke', 'RodString', 'Rod String'],
  ['Improve pump efficiency and equipment reliability', 'Inverse card diagnosis; fillage constraint; Goodman fatigue accounting', 'RodString', 'Dynamometer Card Diagnosis'],
  ['Optimize steam and energy consumption; reduce cost', 'Optimal-stopping cut-off; NPV objective with steam and electrical cost', 'CssDesign', 'Economic Cut-off'],
  ['Reduce Steam-Oil Ratio (SOR)', 'Cut-off rule plus soak-time and steam-volume optimization', 'CssDesign', 'Cycle Design'],
  ['Lower energy per barrel', 'MPC energy term; no work wasted against rod float and fluid pound', 'SrpControl', 'Sucker Rod Pump Control'],
  ['Reduce rod failures and pump unsetting', 'FMI constraint, Lubinski buckling, Goodman envelope; slow downstroke', 'RodString', 'Fatigue & Buckling'],
  ['Data-driven and predictive decision making', 'Trained PINN surrogate, EnKF assimilation, bounded GP residual, symbolic regression', 'Learning', 'Learning Layers'],
];

const ROADMAP = [
  ['Physics engine: Marx–Langenheim, Boberg–Lantz, Ramey, Gibbs wave equation', 'ok', 'Done (ushna/physics)'],
  ['Synthetic data generator and live FMI monitor', 'ok', 'Done (ushna/data)'],
  ['EnKF assimilation loop with collapsing uncertainty bands', 'ok', 'Done (ushna/ml/enkf.py)'],
  ['PINN trained in PyTorch, validated on unseen designs, energy-audited', 'ok', 'Done (ushna/ml/pinn_training.py)'],
  ['GP residual, symbolic regression, inverse card diagnosis', 'ok', 'Done (ushna/ml)'],
  ['MPC controller and safety envelope, closed loop through a cooling cycle', 'warn', 'In progress: grid search in the interface'],
  ['CSS optimizer and optimal-stopping cut-off; NPV and SOR vs history', 'warn', 'In-browser grid evaluation; Gaussian-process Bayesian optimization in progress'],
  ['Dashboard, wellbore visualisation, backtest, explainability cards', 'ok', 'Implemented in this prototype'],
];

const Box = ({ title, children, tone = 'plain' }) => (
  <div className={`rounded-xl border px-4 py-3 text-center ${tone === 'safety' ? 'border-orange-200 bg-orange-50' : tone === 'obs' ? 'border-brand-200 bg-brand-50' : 'border-line bg-white'}`}>
    <div className="text-xs font-bold uppercase tracking-wide">{title}</div>
    <div className="mt-1 text-xs text-ink-2">{sub(children)}</div>
  </div>
);
const Down = () => <div className="flex justify-center py-1"><ArrowDown size={16} className="text-ink-3" /></div>;

export default function Traceability({ ctx }) {
  return (
    <>
      <PageHeader title="Traceability" subtitle="The system component that addresses each requirement in the problem statement, and the implementation status of each component." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card title="System Architecture: Closed-Loop Operation" className="lg:col-span-2">
          <div className="relative pr-8">
            <Box title="Observation layer" tone="obs">SCADA · VFD · surface dynamometer · THP/CHP · steam mass flow · echometer · flowline T · cycle records (CSV · XLSX · PDF)</Box>
            <Down />
            <Box title="Data assimilation: Ensemble Kalman Filter">kh · skin · heat-loss coefficient · rod damping c · PVT · pump slippage</Box>
            <Down />
            <div className="rounded-xl border border-dashed border-viz-pink p-2">
              <div className="mb-2 text-center text-[11px] font-semibold uppercase text-viz-pink">Physics core · coupled through μ({sub("T_pump")})</div>
              <div className="grid grid-cols-3 gap-2">
                <Box title="Reservoir">M–L, B–L ⇒ r_h, T̄, q_o</Box>
                <Box title="Wellbore">Ramey ⇒ T(z,t), T_pump</Box>
                <Box title="Rod String">Gibbs ⇒ cards, FMI</Box>
              </div>
            </div>
            <Down />
            <Box title="Optimization layer">CSS: NPV Bayesian optimization · economic cut-off rule · SRP: MPC on SPM, stroke and VFD profile</Box>
            <Down />
            <Box title="Safety envelope" tone="safety">Hard physical limits · may reject or limit setpoints · logs every intervention</Box>
            <Down />
            <Box title="Actuation & operator interface">VFD setpoints · CSS cycle plan · explainability cards</Box>
            <div className="absolute bottom-6 right-0 top-6 flex w-6 flex-col items-center justify-center rounded-r-xl border-y border-r border-dashed border-ink-3">
              <RotateCcw size={13} className="text-ink-3" />
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-3">A model that does not continuously recalibrate against its own well is a simulator, not a digital twin.</p>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          <Card title="Requirement Traceability Matrix" pad="p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-y border-line bg-canvas"><tr>{['Required outcome', 'Delivering component', 'Location'].map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
                <tbody>
                  {REQS.map(([req, comp, page, label]) => (
                    <tr key={req} className="border-b border-line last:border-0 align-top">
                      <td className="td whitespace-normal font-medium">{req}</td>
                      <td className="td whitespace-normal text-ink-2">{sub(comp)}</td>
                      <td className="td"><button onClick={() => ctx.go(page)} className="text-sm font-medium text-brand-600 hover:underline">{label} →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Implementation Roadmap" pad="p-0" className="overflow-hidden">
            <table className="w-full">
              <tbody>
                {ROADMAP.map(([d, tone, st], i) => (
                  <tr key={d} className="border-b border-line last:border-0">
                    <td className="td w-10 text-ink-3">{i + 1}</td>
                    <td className="td whitespace-normal">{d}</td>
                    <td className="td"><Status tone={tone}>{st}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
