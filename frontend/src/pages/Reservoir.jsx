import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea } from 'recharts';
import { Flame, Droplet, Target, Waves } from 'lucide-react';
import { PageHeader, Card, StatRow, Eq, Tex, Legend, VIZ, AXIS, GRID, fmt } from '../components/ui';
import { FIELD, WALTHER, viscosity, heatedRadius } from '../data/twin';

const TABS = ['Thermal Decline', 'Reservoir Inflow', 'Heated Zone', 'Viscosity Correlation'];

export default function Reservoir({ ctx }) {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <>
      <PageHeader
        title="Reservoir & Cyclic Steam Stimulation (CSS)"
        subtitle="Cooling of the steam-heated zone around the well after each injection, and the resulting oil production."
        tabs={TABS} tab={tab} onTab={setTab}
      />
      {tab === 'Thermal Decline' && <Thermal s={ctx.s} />}
      {tab === 'Reservoir Inflow' && <Inflow s={ctx.s} />}
      {tab === 'Heated Zone' && <HeatedZone s={ctx.s} />}
      {tab === 'Viscosity Correlation' && <Viscosity s={ctx.s} />}
    </>
  );
}

const dayMarker = (day) => <ReferenceLine x={day} stroke="#16161D" strokeDasharray="2 3" label={{ value: 'Today', position: 'insideTopLeft', fontSize: 11, fill: '#5B5B6B' }} />;

function Thermal({ s }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card tour="thermal" title="Heated-Zone Temperature (Boberg–Lantz)" icon={Flame} className="lg:col-span-2" right={<Legend items={[['T̄ mean heated zone', VIZ.pink], ['T_pump pump intake', VIZ.orange], ['T_R reservoir', '#8C8C9A', true]]} />}>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={s.rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" type="number" domain={[0, FIELD.horizon]} {...AXIS} />
              <YAxis {...AXIS} width={40} unit="°" />
              <Tooltip formatter={(v) => `${fmt.n0(v)} °C`} labelFormatter={(l) => `Production day ${l}`} />
              {dayMarker(s.day)}
              <ReferenceLine y={FIELD.T_R} stroke="#8C8C9A" strokeDasharray="4 3" />
              <ReferenceLine y={FIELD.T_onset} stroke={VIZ.yellow} strokeDasharray="4 3" label={{ value: 'Asphaltene onset', position: 'insideBottomRight', fontSize: 11, fill: '#A16207' }} />
              <Line dataKey="Tbar" name="T̄" stroke={VIZ.pink} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="Tpump" name="Pump-intake temperature" stroke={VIZ.orange} dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Eq note={<><Tex>{String.raw`f_{VD},\ f_{HD}`}</Tex>: vertical and radial conduction unit solutions. <Tex>\delta</Tex>: fraction of heat removed by produced fluid.</>}>
            {String.raw`\bar{T}(t) = T_R + (T_s - T_R)\, f_{VD}\, f_{HD}\,(1 - \delta)`}
          </Eq>
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-ink-2">
            <b className="text-ink">δ captures the central economic trade-off of CSS in a single coefficient.</b> Faster pumping cools the heated zone faster, so strokes per minute (SPM) and cut-off timing cannot be optimised independently.
          </div>
        </div>
      </Card>
      <Card title="Current Conditions" icon={Target}>
        <StatRow label="Steam temperature T_s" value={FIELD.T_s} unit="°C" />
        <StatRow label="Reservoir temperature T_R" value={FIELD.T_R} unit="°C" />
        <StatRow label="Mean heated-zone temperature T̄" value={fmt.n0(s.now.Tbar)} unit="°C" />
        <StatRow label="Fraction of heat removed, δ" value={fmt.n2(s.now.delta)} />
        <StatRow label="Heated radius r_h" value={fmt.n1(s.rh)} unit="m" />
        <StatRow label="Pay thickness h" value={FIELD.pay} unit="m" />
        <StatRow label="Change in T̄, last 4 days" value={fmt.n1(s.now.Tbar - s.ago.Tbar)} unit="°C" />
      </Card>
    </div>
  );
}

function Inflow({ s }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Production Rates over the Cycle" icon={Droplet} className="lg:col-span-2" right={<Legend items={[['Reservoir inflow', VIZ.blue], ['Gross fluid lifted', VIZ.purple], ['Oil', VIZ.pink]]} />}>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={s.rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="p" type="number" domain={[0, FIELD.horizon]} {...AXIS} />
              <YAxis {...AXIS} width={40} />
              <Tooltip formatter={(v) => `${fmt.n0(v)} bbl/d`} labelFormatter={(l) => `Production day ${l}`} />
              {dayMarker(s.day)}
              <Line dataKey="inflow" name="Reservoir inflow" stroke={VIZ.blue} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="gross" name="Gross fluid lifted" stroke={VIZ.purple} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="oil" name="Oil" stroke={VIZ.pink} dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-sm text-ink-2">Early in the cycle, reservoir inflow exceeds pump capacity; the flat section of the gross-fluid line is where pump capacity is limiting. Once the lines meet, pump fillage declines and the fluid-pound constraint becomes limiting.</p>
      </Card>
      <Card title="Radial Composite Inflow" icon={Waves}>
        <Eq note={<>A heated inner zone within a cold reservoir. <Tex>{String.raw`\mu_h \ll \mu_c`}</Tex> reproduces the post-injection rate peak without curve fitting.</>}>
          {String.raw`q_o = \frac{2\pi k\, k_{ro}\, h\,(\bar{P}_R - P_{wf})}{\mu_h\left[\ln(r_h/r_w) + s\right] + \mu_c \ln(r_e/r_h)}`}
        </Eq>
        <div className="mt-3">
          <StatRow label="μ_h (heated zone)" value={fmt.n0(s.now.muH)} unit="cP" />
          <StatRow label="μ_c (cold reservoir)" value={fmt.n0(viscosity(FIELD.T_R))} unit="cP" />
          <StatRow label="Current inflow" value={fmt.n0(s.now.inflow)} unit="bbl/d" />
          <StatRow label="Water cut" value={fmt.pct(s.now.waterCut)} />
          <StatRow label="Skin factor s (EnKF estimate)" value={fmt.n1(s.well.skin)} />
          <StatRow label="kh multiplier (EnKF estimate)" value={fmt.n2(s.well.kh)} />
        </div>
      </Card>
    </div>
  );
}

function HeatedZone({ s }) {
  const data = useMemo(() => Array.from({ length: 41 }, (_, i) => {
    const d = (i / 40) * FIELD.tInj;
    return { d: +d.toFixed(2), rh: heatedRadius(s.steam, d), rh2: heatedRadius(s.steam * 1.4, d * 1), rh3: heatedRadius(s.steam * 0.6, d) };
  }), [s.steam]);
  const rings = [1, 0.75, 0.5, 0.25];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Heated Radius during Injection (Marx–Langenheim)" icon={Flame} className="lg:col-span-2" right={<Legend items={[[`${fmt.n0(s.steam * 0.6)} t`, VIZ.yellow], [`${fmt.n0(s.steam)} t (current cycle)`, VIZ.pink], [`${fmt.n0(s.steam * 1.4)} t`, VIZ.purple]]} />}>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="d" type="number" {...AXIS} unit=" d" />
              <YAxis {...AXIS} width={40} unit=" m" />
              <Tooltip formatter={(v) => `${fmt.n1(v)} m`} labelFormatter={(l) => `Injection day ${l}`} />
              <Area dataKey="rh2" stroke={VIZ.purple} fill={VIZ.purple} fillOpacity={0.06} strokeWidth={1.5} isAnimationActive={false} />
              <Area dataKey="rh" stroke={VIZ.pink} fill={VIZ.pink} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
              <Area dataKey="rh3" stroke={VIZ.yellow} fill={VIZ.yellow} fillOpacity={0.1} strokeWidth={1.5} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <Eq note={<><Tex>{String.raw`G(t_D) = e^{t_D}\operatorname{erfc}\sqrt{t_D} + 2\sqrt{t_D/\pi} - 1`}</Tex>. The heated radius grows approximately with the square root of steam volume, so additional steam yields diminishing returns.</>}>
            {String.raw`A(t) = \frac{Q_i\, M_R\, h\, \alpha_{ob}}{4\, k_{ob}^2\, \Delta T}\, G(t_D), \qquad t_D = \frac{4\, k_{ob}^2\, t}{M_R^2\, h^2\, \alpha_{ob}}`}
          </Eq>
        </div>
      </Card>
      <Card title="Plan View" icon={Target}>
        <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[240px]" role="img" aria-label={`Heated zone radius ${fmt.n1(s.rh)} m inside ${FIELD.re} m drainage radius`}>
          <circle cx="100" cy="100" r="95" fill="#F1F1F5" />
          {rings.map((k, i) => (
            <circle key={k} cx="100" cy="100" r={(95 * s.rh * k) / FIELD.re} fill={VIZ.pink} fillOpacity={0.18 + i * 0.18} />
          ))}
          <circle cx="100" cy="100" r="3" fill="#16161D" />
          <text x="100" y="192" textAnchor="middle" fontSize="10" fill="#5B5B6B">r_e = {FIELD.re} m</text>
        </svg>
        <StatRow label="Steam injected" value={fmt.n0(s.steam)} unit="t" />
        <StatRow label="Injection period" value={FIELD.tInj} unit="d" />
        <StatRow label="Soak period" value={s.well.soak} unit="d" />
        <StatRow label="Heated radius r_h" value={fmt.n1(s.rh)} unit="m" />
      </Card>
    </div>
  );
}

function Viscosity({ s }) {
  const data = useMemo(() => Array.from({ length: 60 }, (_, i) => { const T = 40 + i * 3.6; return { T: +T.toFixed(1), mu: viscosity(T) }; }), []);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Viscosity–Temperature Relationship μ(T)" icon={Droplet} className="lg:col-span-2">
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="T" type="number" domain={[40, 252]} {...AXIS} unit="°" />
              <YAxis scale="log" domain={[10, 30000]} ticks={[10, 100, 1000, 10000]} {...AXIS} width={48} allowDataOverflow />
              <Tooltip formatter={(v) => `${fmt.n0(v)} cP`} labelFormatter={(l) => `${l} °C`} />
              <ReferenceArea x1={40} x2={FIELD.T_onset} fill={VIZ.yellow} fillOpacity={0.15} label={{ value: 'Below T_onset: shear-thinning regime', position: 'insideTop', fontSize: 11, fill: '#A16207' }} />
              <ReferenceLine x={+s.now.Tpump.toFixed(1)} stroke={VIZ.orange} label={{ value: `T_pump ${fmt.n0(s.now.Tpump)} °C → ${fmt.n0(s.now.mu)} cP`, position: 'right', fontSize: 11, fill: '#B45309' }} />
              <Line dataKey="mu" stroke={VIZ.pink} dot={false} strokeWidth={2.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="ASTM D341 Walther Correlation" icon={Waves}>
        <Eq note="Fitted to Oil India's published 10,000–13,000 cP at 50 °C and 14 cP at steam temperature. A and B are updated jointly by the Ensemble Kalman Filter (EnKF) from dynamometer-card, rate and temperature data.">
          {String.raw`\log_{10}\log_{10}(\nu + 0.7) = A - B\,\log_{10} T`}
        </Eq>
        <div className="mt-3">
          <StatRow label="Walther constant A" value={WALTHER.A.toFixed(3)} />
          <StatRow label="Walther constant B" value={WALTHER.B.toFixed(3)} />
          <StatRow label={`μ at T_R (${FIELD.T_R} °C)`} value={fmt.n0(viscosity(FIELD.T_R))} unit="cP" />
          <StatRow label="μ at T_s (250 °C)" value={fmt.n0(viscosity(FIELD.T_s))} unit="cP" />
          <StatRow label="Viscosity ratio, T_R to T_s" value={`${fmt.n0(viscosity(FIELD.T_R) / viscosity(FIELD.T_s))}×`} />
          <StatRow label="Asphaltene onset temperature" value={FIELD.T_onset} unit="°C" tone={s.asphaltene ? 'warn' : 'ok'} />
        </div>
      </Card>
    </div>
  );
}
