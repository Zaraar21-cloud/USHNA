import React, { Suspense, lazy, useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { Thermometer, Clock } from 'lucide-react';
import { PageHeader, Card, StatRow, Eq, Tex, Legend, VIZ, AXIS, GRID, fmt } from '../components/ui';
import { FIELD, tubingProfile, heatedRadius, viscosity } from '../data/twin';

const Wellbore3DModel = lazy(() => import('../components/Wellbore3DModel')); // three.js loads only on this page
const TAU_H = 9; // wellbore thermal lag, hours
const SPEED = 5; // pump strokes drawn 5× real time at 1× pace, so a stroke reads in a couple of seconds

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
      <PageHeader title="Wellbore" subtitle="Heat loss from the produced fluid as it rises through the wellbore, which determines crude viscosity at the pump intake." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-12">
          <Suspense fallback={<div className="card grid h-[720px] place-items-center text-sm text-ink-3">Loading the three-dimensional wellbore model…</div>}>
            <Well3D ctx={ctx} />
          </Suspense>
        </div>

        <Card tour="ramey" title="Temperature and Viscosity Profiles with Depth (Ramey)" icon={Thermometer} className="lg:col-span-9" right={<Legend items={[['Tubing fluid', VIZ.orange], ['Geothermal', '#8C8C9A', true], ['Viscosity μ(z)', VIZ.pink]]} />}>
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
            <Eq note={<><Tex>{String.raw`A = \frac{w\,c_p}{2\pi}\left(\frac{1}{r\,U} + \frac{f(t)}{k}\right)`}</Tex> is the relaxation distance. It increases with flow rate, so faster pumping keeps the fluid column warmer.</>}>
              {String.raw`T(z,t) = T_{geo}(z) + g_G\,A\left(1 - e^{-(L-z)/A}\right) + \left(T_{pump} - T_{geo}(L)\right)e^{-(L-z)/A}`}
            </Eq>
          </div>
        </Card>

        <Card title="Current Conditions" icon={Thermometer} className="lg:col-span-3">
          <StatRow label="Pump-intake temperature T_pump" value={fmt.n0(s.now.Tpump)} unit="°C" />
          <StatRow label="Viscosity at pump" value={fmt.n0(s.now.mu)} unit="cP" />
          <StatRow label="Temperature at surface" value={fmt.n0(prof[0].T)} unit="°C" />
          <StatRow label="Viscosity at surface" value={fmt.n0(prof[0].mu)} unit="cP" />
          <StatRow label="Pump setting depth" value={FIELD.pumpDepth} unit="m" />
          <StatRow label="Geothermal gradient" value={FIELD.gradGeo * 1000} unit="°C/km" />
          <StatRow label="Gross fluid rate" value={fmt.n0(s.now.gross)} unit="bbl/d" />
        </Card>

        <Card title="Wellbore Thermal Lag after a Rate Change: Basis for Predictive Control" icon={Clock} className="lg:col-span-12" right={<Legend items={[['Physics (Ramey transient)', VIZ.orange], ['Instantaneous-response assumption', '#8C8C9A', true]]} />}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="h-56 lg:col-span-2">
              <ResponsiveContainer>
                <LineChart data={lag} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="h" type="number" {...AXIS} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} tickFormatter={(v) => `${v} h`} />
                  <YAxis {...AXIS} width={44} domain={['auto', 'auto']} tickFormatter={(v) => `${v.toFixed(1)}°`} />
                  <Tooltip formatter={(v) => `${fmt.n1(v)} °C`} labelFormatter={(l) => `${l} h after rate change`} />
                  <ReferenceLine x={TAU_H} stroke={VIZ.purple} strokeDasharray="4 3" label={{ value: `τ ≈ ${TAU_H} h`, position: 'insideTopRight', fontSize: 11, fill: VIZ.purple }} />
                  <Line dataKey="T" name="Fluid temperature at 300 m" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="naive" type="stepAfter" name="Instantaneous response" stroke="#8C8C9A" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-ink-2">
              A rate change affects rod loading only several hours later. A reactive controller that assumes an instantaneous response over-corrects and oscillates.
              The Model Predictive Controller (MPC) evaluates constraints at the end of the lag (+48 h), because the lag is part of its model.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

// The 3D well follows the twin, and during Run cycle the camera follows the phase:
// surface first, then down to the steam wave, then the pump as production starts.
function Well3D({ ctx }) {
  const { s, well, day, demoT: t, playing, pace } = ctx;
  const demo = t != null, soak = well.soak, start = -(FIELD.tInj + soak);
  const injecting = demo && t < -soak, soaking = demo && t >= -soak && t < 0;
  // Production: the hot core cools (Boberg–Lantz T̄) and its isotherm shrinks with it.
  const span = FIELD.T_s - FIELD.T_R, warm = (Tbar) => s.rh * Math.sqrt(Math.max(0.02, (Tbar - FIELD.T_R) / span));
  const T0 = s.rows[0].Tbar, f = soaking ? (t + soak + 1) / soak : 0;
  const heat = injecting ? { radius: heatedRadius(well.steam, t - start + 1), core: FIELD.T_s }
    : soaking ? { radius: s.rh + (warm(T0) - s.rh) * f, core: FIELD.T_s + (T0 - FIELD.T_s) * f }
    : { radius: warm(s.now.Tbar), core: s.now.Tbar };
  const view = !demo ? undefined
    : t < start + 5 ? 'Surface'
    : t < 0 ? 'Heated Zone'
    : t >= FIELD.horizon ? 'Full Well'
    : t > s.cut.day ? 'Heated Zone' : 'Pump & Pay Zone';
  const pumping = !(demo && t < 0) && !(demo && !playing && t < FIELD.horizon);
  const phaseLabel = injecting ? `Steam injection · day ${t - start + 1} of ${FIELD.tInj}` : soaking ? `Soak (shut-in) · day ${t + soak + 1} of ${soak}` : undefined;
  const pump = pumping ? `${s.sp.spm.toFixed(1)} SPM · ${fmt.n0(s.now.gross)} bbl/d` : 'Off';
  const muCold = viscosity(FIELD.T_R);
  const info = {
    thermal: {
      title: injecting ? 'Steam Front' : 'Heated Zone',
      rows: [['Core temperature', `${fmt.n0(heat.core)} °C`], ['Heated radius', `${heat.radius.toFixed(1)} m`],
        ['Oil temperature at pump', `${fmt.n0(s.now.Tpump)} °C`], ['Viscosity at pump', `${fmt.n0(s.now.mu)} cP`], ['Pump', pump]],
      note: injecting || soaking
        ? 'Steam heats the crude surrounding the well. The pump remains off until the soak period ends.'
        : 'Heated, lower-viscosity crude flows readily to the pump. As this zone cools, viscosity rises, so the controller reduces pump speed to prevent rod float.',
    },
    oil: {
      title: 'Unheated Heavy Crude',
      rows: [['Reservoir temperature', `${FIELD.T_R} °C`], ['Unheated crude viscosity', `${fmt.n0(muCold)} cP`], ['Inflow to pump', `${fmt.n0(s.now.inflow)} bbl/d`],
        ['Pump fillage', `${Math.round(s.now.fillage * 100)}%`], ['Float Margin Index', `${s.fmiMin.fmi.toFixed(2)} (limit ${FIELD.fmiLimit})`]],
      note: `Beyond the heated radius the crude is approximately ${fmt.n0(muCold / s.now.mu)}× more viscous than at the pump and flows very slowly, which limits how quickly the pump can fill.`,
    },
  };
  return (
    <Wellbore3DModel
      day={day} pumpDepth={FIELD.pumpDepth} reservoirTemp={FIELD.T_R} spm={s.sp.spm} strokeLength={FIELD.stroke}
      fmi={s.fmiMin.fmi} heat={heat} steam={injecting} animating={pumping} speed={SPEED * (playing ? pace : 1)}
      view={view} tweenMs={Math.min(3000, 1800 / pace)} info={info} phaseLabel={phaseLabel}
      height={720} onDayChange={ctx.setDay}
    />
  );
}
