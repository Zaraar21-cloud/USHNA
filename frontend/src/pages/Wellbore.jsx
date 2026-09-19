import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Thermometer, Clock, Layers } from 'lucide-react';
import { PageHeader, Card, StatRow, Eq, Legend, VIZ, AXIS, GRID, fmt } from '../components/ui';
import { FIELD, ROD, tubingProfile } from '../data/twin';

const TAU_H = 9; // wellbore thermal lag, hours

export default function Wellbore({ ctx }) {
  const { s } = ctx;
  const prof = s.prof;
  const lag = useMemo(() => {
    const target = tubingProfile(s.now.Tpump, s.mpc.gross ?? s.now.gross);
    const i = Math.round(300 / 20);
    const a = prof[i].T, b = target[i].T;
    return Array.from({ length: 49 }, (_, h) => ({ h, T: b + (a - b) * Math.exp(-h / TAU_H), naive: h === 0 ? a : b }));
  }, [s, prof]);

  return (
    <>
      <PageHeader title="Wellbore" subtitle="Timescale: hours. The bridge between reservoir and surface: it turns reservoir temperature into the viscosity at the pump." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card title="Well schematic" icon={Layers} className="lg:col-span-3">
          <Schematic prof={prof} s={s} />
        </Card>

        <Card title="Temperature and viscosity with depth (Ramey)" icon={Thermometer} className="lg:col-span-6" right={<Legend items={[['tubing fluid', VIZ.orange], ['geothermal', '#8C8C9A', true], ['μ(z)', VIZ.pink]]} />}>
          <div className="grid h-80 grid-cols-2 gap-2">
            <ResponsiveContainer>
              <LineChart layout="vertical" data={prof} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid stroke="#F0F0F4" />
                <XAxis type="number" {...AXIS} unit="°" domain={[25, 'auto']} />
                <YAxis type="number" dataKey="z" {...AXIS} width={40} domain={[0, FIELD.pumpDepth]} />
                <Tooltip formatter={(v) => `${fmt.n1(v)} °C`} labelFormatter={(l) => `${l} m`} />
                <Line dataKey="T" name="Tubing fluid" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="Tgeo" name="Geothermal" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <ResponsiveContainer>
              <LineChart layout="vertical" data={prof} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid stroke="#F0F0F4" />
                <XAxis type="number" {...AXIS} domain={['auto', 'auto']} />
                <YAxis type="number" dataKey="z" {...AXIS} width={40} domain={[0, FIELD.pumpDepth]} />
                <Tooltip formatter={(v) => `${fmt.n0(v)} cP`} labelFormatter={(l) => `${l} m`} />
                <Line dataKey="mu" name="μ" stroke={VIZ.pink} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4">
            <Eq note="A = w·c_p·(1/(r·U) + f(t)/k)/2π. The relaxation distance grows with rate, so faster pumping keeps the column warmer.">
              {'T(z,t) = T_geo(z) + g·A·(1 − e^(−(L−z)/A)) + (T_pump − T_geo(L))·e^(−(L−z)/A)'}
            </Eq>
          </div>
        </Card>

        <Card title="Now" icon={Thermometer} className="lg:col-span-3">
          <StatRow label="T_pump" value={fmt.n0(s.now.Tpump)} unit="°C" />
          <StatRow label="μ at pump" value={fmt.n0(s.now.mu)} unit="cP" />
          <StatRow label="T at surface" value={fmt.n0(prof[0].T)} unit="°C" />
          <StatRow label="μ at surface" value={fmt.n0(prof[0].mu)} unit="cP" />
          <StatRow label="Pump setting depth" value={FIELD.pumpDepth} unit="m" />
          <StatRow label="Geothermal gradient" value={FIELD.gradGeo * 1000} unit="°C/km" />
          <StatRow label="Gross rate" value={fmt.n0(s.now.gross)} unit="bbl/d" />
        </Card>

        <Card title="Why the controller must be predictive: thermal lag after a rate change" icon={Clock} className="lg:col-span-12" right={<Legend items={[['physics (Ramey transient)', VIZ.orange], ['naive reactive assumption', '#8C8C9A', true]]} />}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="h-56 lg:col-span-2">
              <ResponsiveContainer>
                <LineChart data={lag} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="h" type="number" {...AXIS} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} tickFormatter={(v) => `${v} h`} />
                  <YAxis {...AXIS} width={44} domain={['auto', 'auto']} tickFormatter={(v) => `${v.toFixed(1)}°`} />
                  <Tooltip formatter={(v) => `${fmt.n1(v)} °C`} labelFormatter={(l) => `${l} h after rate change`} />
                  <ReferenceLine x={TAU_H} stroke={VIZ.purple} strokeDasharray="4 3" label={{ value: `τ ≈ ${TAU_H} h`, position: 'insideTopRight', fontSize: 11, fill: VIZ.purple }} />
                  <Line dataKey="T" name="Fluid T at 300 m" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="naive" type="stepAfter" name="Instant response" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-ink-2">
              A rate change reaches rod loading hours later. A reactive controller that expects an instant response over-corrects and oscillates.
              The MPC evaluates constraints at the end of the lag (+48 h), because the lag is part of its model.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function Schematic({ prof, s }) {
  const H = 420, top = 20, scale = (H - 40) / FIELD.pumpDepth;
  const color = (T) => {
    const k = Math.max(0, Math.min(1, (T - 30) / 60));
    return `rgb(${Math.round(246 - 4 * k)}, ${Math.round(230 - 146 * k)}, ${Math.round(160 - 5 * k)})`;
  };
  return (
    <svg viewBox={`0 0 180 ${H}`} className="mx-auto w-full max-w-[200px]" role="img" aria-label="Wellbore schematic coloured by fluid temperature">
      <rect x="70" y={top} width="40" height={H - 40} fill="#F1F1F5" stroke="#D5D5DE" />
      {prof.map((p) => <rect key={p.z} x="80" y={top + p.z * scale} width="20" height={20 * scale + 0.5} fill={color(p.T)} />)}
      {ROD.sections.map((sec) => (
        <g key={sec.name}>
          <rect x={89 - sec.d * 80} y={top + sec.from * scale} width={2 + sec.d * 160} height={(sec.to - sec.from) * scale} fill="#16161D" opacity="0.55" />
          <line x1="112" x2="120" y1={top + sec.from * scale} y2={top + sec.from * scale} stroke="#8C8C9A" />
          <text x="122" y={top + sec.from * scale + 10} fontSize="9" fill="#5B5B6B">{sec.name}</text>
        </g>
      ))}
      <rect x="82" y={top + FIELD.pumpDepth * scale - 12} width="16" height="12" fill={VIZ.purple} />
      <text x="122" y={top + FIELD.pumpDepth * scale - 2} fontSize="9" fill={VIZ.purple}>pump {FIELD.pumpDepth} m</text>
      <line x1="60" x2="68" y1={top + s.fmiMin.z * scale} y2={top + s.fmiMin.z * scale} stroke="#DC2626" strokeWidth="2" />
      <text x="58" y={top + s.fmiMin.z * scale + 3} fontSize="9" textAnchor="end" fill="#DC2626">min FMI</text>
      {[0, 300, 600, 900].map((z) => <text key={z} x="4" y={top + z * scale + 3} fontSize="9" fill="#8C8C9A">{z} m</text>)}
    </svg>
  );
}
