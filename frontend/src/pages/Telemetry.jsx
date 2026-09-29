import React, { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea } from 'recharts';
import { Radio, Zap, Upload, Pause, Play, Cpu, WifiOff } from 'lucide-react';
import { PageHeader, Card, StatRow, Badge, Legend, VIZ, AXIS, GRID } from '../components/ui';
import { RecordsUpload } from '../components/Records';

const HZ = 20, WINDOW = 15 * HZ, JERK_LIMIT = 4, SIM = 'Simulated edge stream';

function sample(t, spm, impact) {
  const th = (2 * Math.PI * spm * t) / 60;
  const noise = () => (Math.random() - 0.5) * 0.06;
  let z = 1 + 0.05 * Math.sin(th) + 0.015 * Math.sin(3 * th) + noise();
  let jerk = 0.05 * Math.cos(th) * ((2 * Math.PI * spm) / 60) * 10 + noise() * 3;
  if (impact) { z += 0.6 * Math.sin(40 * t); jerk += 6 + Math.random() * 3; }
  return { t: +t.toFixed(2), z, jerk, anomaly: Math.abs(jerk) > JERK_LIMIT };
}

export default function Telemetry({ ctx }) {
  const { s } = ctx;
  const [data, setData] = useState([]);
  const [running, setRunning] = useState(true);
  const [events, setEvents] = useState([]);
  const [source, setSource] = useState(SIM);
  const t = useRef(0), impactUntil = useRef(-1), lastAlert = useRef(-10);

  useEffect(() => {
    if (!running || source !== SIM) return;
    const id = setInterval(() => {
      const batch = [];
      for (let i = 0; i < 4; i++) {
        t.current += 1 / HZ;
        const smp = sample(t.current, s.sp.spm, t.current < impactUntil.current);
        batch.push(smp);
        if (smp.anomaly && t.current - lastAlert.current > 3) {
          lastAlert.current = t.current;
          setEvents((e) => [{ at: new Date().toLocaleTimeString('en-IN'), jerk: smp.jerk.toFixed(1) }, ...e].slice(0, 8));
        }
      }
      setData((d) => [...d, ...batch].slice(-WINDOW));
    }, 200);
    return () => clearInterval(id);
  }, [running, source, s.sp.spm]);

  function loadCsv(file) {
    file.text().then((txt) => {
      const rows = txt.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
      const parsed = rows.filter((r) => r[1] !== '').map((r, i) => ({ t: i / HZ, z: +r[1], jerk: +r[2], anomaly: r[3] === 'TRUE' }));
      const flagged = rows.filter((r) => r[3] === 'TRUE').map((r) => ({ at: r[0], jerk: 'edge-flagged' }));
      setSource(`${file.name} · ${rows.length} rows`);
      setData(parsed.slice(-WINDOW));
      setEvents(flagged.slice(-8).reverse());
      setRunning(false);
    });
  }

  const anomalies = data.filter((d) => d.anomaly);
  const first = data[0]?.t ?? 0, last = data.at(-1)?.t ?? 0;

  return (
    <>
      <PageHeader
        title="Edge Telemetry"
        subtitle="A simulated polished-rod vibration stream, representative of an edge-mounted accelerometer. Spikes indicate rod impact or rod float. Load a CSV file recorded by arduino_bridge.py to replay measured sensor data."
        right={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setRunning((r) => !r)} disabled={source !== SIM} className="btn-ghost disabled:opacity-40">{running ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}</button>
            <button onClick={() => { impactUntil.current = t.current + 1.2; }} disabled={source !== SIM} className="btn-ghost disabled:opacity-40"><Zap size={15} /> Simulate Impact</button>
            <label className="btn-primary cursor-pointer">
              <Upload size={15} /> Load Sensor CSV
              <input type="file" accept=".csv" className="sr-only" onChange={(e) => e.target.files[0] && loadCsv(e.target.files[0])} />
            </label>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div data-tour="telemetry" className="space-y-4 lg:col-span-8">
        <Card title="Vertical Acceleration (g) and Jerk" icon={Radio} right={<Legend items={[['Vertical acceleration', VIZ.purple], ['Jerk', VIZ.pink]]} />}>
          <div className="h-44">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="t" type="number" domain={[first, last]} hide />
                <YAxis {...AXIS} width={40} domain={[0.3, 1.7]} />
                {anomalies.length > 0 && <ReferenceArea x1={anomalies[0].t} x2={anomalies.at(-1).t} fill={VIZ.pink} fillOpacity={0.08} />}
                <Line dataKey="z" stroke={VIZ.purple} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-44">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="t" type="number" domain={[first, last]} {...AXIS} tickFormatter={(v) => `${v.toFixed(0)}s`} />
                <YAxis {...AXIS} width={40} domain={[-10, 10]} />
                <Tooltip formatter={(v) => v.toFixed(2)} labelFormatter={(l) => `${l.toFixed(2)} s`} />
                <Line dataKey="jerk" stroke={VIZ.pink} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <RecordsUpload ctx={ctx} />
        </div>
        <div className="space-y-4 lg:col-span-4">
          <Card title="Edge Node" icon={Cpu}>
            <StatRow label="Source" value={<Badge tone={source === SIM ? 'info' : 'ok'}>{source}</Badge>} />
            <StatRow label="Sample rate" value={HZ} unit="Hz" />
            <StatRow label="Jerk alarm threshold" value={JERK_LIMIT} unit="g/s" />
            <StatRow label="SPM (digital twin setpoint)" value={s.sp.spm.toFixed(1)} />
            <StatRow label="Samples in window" value={data.length} />
            <p className="mt-3 flex items-start gap-2 text-xs text-ink-3"><WifiOff size={14} className="mt-0.5 shrink-0" /> The physics core, the Float Margin Index monitor and the safety envelope all run on the industrial PC at the well pad. Cloud services handle fleet analytics only.</p>
          </Card>
          <Card title="Edge Alerts: Rod Float and Impact">
            {events.length === 0 ? <p className="text-sm text-ink-2">No impacts detected. Select “Simulate Impact” to test the alert.</p> : (
              <ul className="space-y-2">
                {events.map((e, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="num text-ink-2">{e.at}</span>
                    <Badge tone="crit">Jerk {e.jerk}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {events.length > 0 && (
              <button onClick={() => ctx.submit({ spm: +(s.sp.spm * 0.9).toFixed(1), down: s.sp.down })} className="btn-primary mt-4 w-full justify-center">
                Request 10% SPM Reduction via Safety Envelope
              </button>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
