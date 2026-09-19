import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { SlidersHorizontal, ShieldCheck, ListChecks, Gauge } from 'lucide-react';
import { PageHeader, Card, Status, Badge, Legend, VIZ, AXIS, GRID, fmt } from '../components/ui';
import { FIELD, fmiProfile, loads, displacement, rodVelocity } from '../data/twin';

const MOTOR_KW = 45;
const NPSH_MPA = 0.6;

function evaluate(s, spm, down) {
  const fr = fmiProfile(s.prof, spm, down);
  const disp = displacement(spm);
  const gross = Math.min(s.now.inflow, disp * 0.97);
  const L = loads(fr, spm, down, gross);
  const fill = Math.min(1, s.now.inflow / disp);
  const fmi = fr.reduce((m, r) => (r.fmi < m.fmi ? r : m));
  const pip = 0.3 + 2.2 * Math.max(0, 1 - disp / Math.max(s.now.inflow * 1.6, 1)); // fluid-level proxy
  return {
    gross, fill, fmi, L, pip,
    constraints: [
      { name: 'FMI(z) > 0.15 for all z', value: fmi.fmi.toFixed(2), ok: fmi.fmi > FIELD.fmiLimit, margin: (fmi.fmi - FIELD.fmiLimit) / 0.85, source: 'Rod float criterion (4.5)' },
      { name: 'Load within modified Goodman', value: fmt.pct(L.goodman), ok: L.goodman <= 1, margin: 1 - L.goodman, source: 'Rod fatigue life' },
      { name: 'Pump fillage > 85%', value: fmt.pct(fill), ok: fill > FIELD.fillageLimit, margin: (fill - FIELD.fillageLimit) / 0.15, source: 'Avoids fluid pound and impact loading' },
      { name: 'Gearbox torque ≤ rating', value: `${fmt.n1(L.torque)} / ${FIELD.torqueRating} kN·m`, ok: L.torque <= FIELD.torqueRating, margin: 1 - L.torque / FIELD.torqueRating, source: 'Surface equipment limit (API 456)' },
      { name: 'Motor loading within VFD envelope', value: `${fmt.n1(L.powerKW)} / ${MOTOR_KW} kW`, ok: L.powerKW <= MOTOR_KW, margin: 1 - L.powerKW / MOTOR_KW, source: 'Electrical limit' },
      { name: 'Pump intake pressure > NPSH', value: `${pip.toFixed(2)} MPa`, ok: pip > NPSH_MPA, margin: (pip - NPSH_MPA) / 2, source: 'Cavitation avoidance' },
    ],
  };
}

export default function SrpControl({ ctx }) {
  const { s } = ctx;
  const [spm, setSpm] = useState(s.sp.spm);
  const [down, setDown] = useState(s.sp.down);
  const [result, setResult] = useState(null);
  useEffect(() => { setSpm(s.sp.spm); setDown(s.sp.down); }, [s.well.id, s.sp.spm, s.sp.down]);

  const ev = useMemo(() => evaluate(s, spm, down), [s, spm, down]);
  const binding = ev.constraints.filter((c) => c.ok).reduce((m, c) => (c.margin < m.margin ? c : m), { margin: Infinity });

  const profile = useMemo(() => {
    const out = [];
    const T = 60 / spm, tDown = T / 2 / down, tUp = T - tDown, u = T / 2 / tUp, vpk = rodVelocity(spm);
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * T;
      const base = t < T / 2 ? vpk * Math.sin((Math.PI * t) / (T / 2)) : -vpk * Math.sin((Math.PI * (t - T / 2)) / (T / 2));
      const asym = t < tUp ? vpk * u * Math.sin((Math.PI * t) / tUp) : -vpk * down * Math.sin((Math.PI * (t - tUp)) / tDown);
      out.push({ t: +t.toFixed(2), base, asym });
    }
    return out;
  }, [spm, down]);

  return (
    <>
      <PageHeader title="SRP control & safety envelope" subtitle="The MPC optimises an explicit objective under explicit constraints. A separate rule-based envelope sits between the optimizer and SCADA. It can clamp any setpoint and it logs the binding constraint every time." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card title="Setpoint what-if (forward solve)" icon={SlidersHorizontal} className="lg:col-span-5">
          <Slider label="Strokes per minute" value={spm} min={2} max={9} step={0.1} onChange={setSpm} display={spm.toFixed(1)} />
          <Slider label="Downstroke velocity" value={down} min={0.7} max={1} step={0.05} onChange={setDown} display={fmt.pct(down)} hint={`upstroke speeds up ×${(1 / (2 - 1 / down)).toFixed(2)} to keep the cycle time`} />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Kpi label="Min FMI" value={ev.fmi.fmi.toFixed(2)} tone={ev.fmi.fmi > FIELD.fmiLimit ? 'ok' : 'crit'} />
            <Kpi label="Gross bbl/d" value={fmt.n0(ev.gross)} />
            <Kpi label="Fillage" value={fmt.pct(ev.fill)} tone={ev.fill > FIELD.fillageLimit ? 'ok' : 'warn'} />
          </div>
          <div className="mt-4 rounded-xl border border-line bg-canvas p-3 text-sm">
            MPC optimum now: <b className="num">SPM {s.mpc.spm?.toFixed(1)}</b>, downstroke <b className="num">{fmt.pct(s.mpc.down)}</b>
            <button onClick={() => { setSpm(s.mpc.spm); setDown(s.mpc.down); }} className="ml-2 font-medium text-brand-600 hover:underline">load</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={() => setResult(ctx.submit({ spm: +spm.toFixed(1), down: +down.toFixed(2) }))} className="btn-primary">
              <ShieldCheck size={15} /> Submit through envelope
            </button>
            {result && (
              <span className="text-sm text-ink-2">
                {result.binding ? <>Clamped to <b>SPM {result.applied.spm.toFixed(1)}</b>. Binding: {result.binding}</> : <>Accepted. <b>SPM {result.applied.spm.toFixed(1)}</b> is now live.</>}
              </span>
            )}
          </div>
        </Card>

        <Card title="Hard constraints" icon={ListChecks} className="lg:col-span-7" pad="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-y border-line bg-canvas"><tr>{['Constraint', 'Value', 'Status', 'Physical source'].map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
              <tbody>
                {ev.constraints.map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-0">
                    <td className="td font-medium">{c.name}</td>
                    <td className="td">{c.value}</td>
                    <td className="td">{!c.ok ? <Status tone="crit">Violated</Status> : c === binding ? <Status tone="warn">Closest to binding</Status> : <Status tone="ok">OK</Status>}</td>
                    <td className="td whitespace-normal text-ink-2">{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="VFD velocity profile within one stroke" icon={Gauge} className="lg:col-span-7" right={<Legend items={[['fixed-speed unit', '#8C8C9A', true], ['asymmetric VFD profile', VIZ.purple]]} />}>
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={profile} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="t" type="number" {...AXIS} unit=" s" domain={[0, 'dataMax']} />
                <YAxis {...AXIS} width={36} />
                <Tooltip formatter={(v) => `${v.toFixed(2)} m/s`} labelFormatter={(l) => `t = ${l} s`} />
                <ReferenceLine y={0} stroke="#16161D" />
                <Line dataKey="base" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Line dataKey="asym" stroke={VIZ.purple} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-ink-2"><b className="text-ink">In heavy oil, the downstroke is the constrained half of the cycle.</b> A slow, controlled downstroke removes float and impact loading, and a faster upstroke wins back the cycle time.</p>
        </Card>

        <Card title="Safety envelope log" icon={ShieldCheck} className="lg:col-span-5" pad="p-0">
          <div className="max-h-80 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 border-y border-line bg-canvas"><tr>{['Time', 'Well', 'Requested → applied', 'Binding'].map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
              <tbody>
                {ctx.log.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0 align-top">
                    <td className="td text-ink-3">{l.time}</td>
                    <td className="td font-medium">{l.well}</td>
                    <td className="td whitespace-normal text-xs">{l.requested}<br />→ {l.applied}</td>
                    <td className="td">{l.binding ? <Badge tone="warn">{l.binding}</Badge> : <Badge tone="ok">accepted</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-ink-3">The log is also a training signal. If the controller keeps getting clamped at the same constraint, that is where the well's real limit is.</p>
        </Card>
      </div>
    </>
  );
}

function Slider({ label, value, min, max, step, onChange, display, hint }) {
  return (
    <label className="mb-4 block">
      <span className="flex justify-between text-sm"><span className="text-ink-2">{label}</span><span className="num font-semibold">{display}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-2 w-full accent-brand-500" />
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Kpi({ label, value, tone }) {
  const c = tone === 'ok' ? 'text-emerald-700' : tone === 'crit' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : 'text-ink';
  return (
    <div className="rounded-xl border border-line p-3">
      <div className={`text-xl font-bold num ${c}`}>{value}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  );
}
