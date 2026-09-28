import React, { useEffect, useMemo, useState } from 'react';
import Shell from './components/Shell';
import { WELLS, FIELD, buildState, envelope, recommendations, designSpace, REQUIRED_FIELDS, applyCalibration, calibDefaults, sourceRows } from './data/twin';
import Overview from './pages/Overview';
import Reservoir from './pages/Reservoir';
import Wellbore from './pages/Wellbore';
import RodString from './pages/RodString';
import Learning, { LEARN_TABS } from './pages/Learning';
import Recommendations from './pages/Recommendations';
import SrpControl from './pages/SrpControl';
import CssDesign from './pages/CssDesign';
import Telemetry from './pages/Telemetry';
import Traceability from './pages/Traceability';
import { fetchState, submitSetpoint } from './data/api';

class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }); }
  render() {
    return this.state.error
      ? <p className="card p-5 text-sm text-red-700">This view failed to render: {String(this.state.error.message)}</p>
      : this.props.children;
  }
}

const PAGES = { Overview, Reservoir, Wellbore, RodString, Learning, Recommendations, SrpControl, CssDesign, Telemetry, Traceability };

// Wells not being animated/scrubbed keep their state, so Run cycle only recomputes one well per frame.
const stateCache = new Map();
const cachedState = (w, day, sp) => {
  const k = `${w.id}|${day}|${sp ? `${sp.spm}|${sp.down}` : ''}`;
  if (!stateCache.has(k)) stateCache.set(k, buildState(w, day, sp));
  return stateCache.get(k);
};

const clock = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

const SEED_LOG = [
  { time: '09:12', well: 'BGW-11', requested: 'SPM 5.4 · down 100%', applied: 'SPM 3.5 · down 100%', binding: 'FMI(z) > 0.15', action: 'clamped' },
  { time: '07:40', well: 'BGW-15', requested: 'SPM 5.6 · down 100%', applied: 'SPM 4.4 · down 100%', binding: 'FMI(z) > 0.15', action: 'clamped' },
  { time: '06:05', well: 'BGW-04', requested: 'SPM 7.2 · down 90%', applied: 'SPM 7.2 · down 90%', binding: null, action: 'accepted' },
];

export default function App() {
  const fromHash = () => (PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'Overview');
  const [page, setPage] = useState(fromHash);
  useEffect(() => {
    const onHash = () => { setPage(fromHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (p) => { location.hash = p; };
  const [wellId, setWellId] = useState('BGW-07');
  const [days, setDays] = useState({});
  const [setpoints, setSetpoints] = useState({});
  const [log, setLog] = useState(SEED_LOG);
  const [playing, setPlaying] = useState(false);
  const [learnTab, setLearnTab] = useState(LEARN_TABS[0]);
  // Accepted field calibration (About this data). Applying it rewrites the twin's constants, so every derived value recomputes.
  const [calib, setCalib] = useState(calibDefaults);
  const acceptCalib = (next) => { applyCalibration(next); stateCache.clear(); setCalib(next); };

  const well = WELLS.find((w) => w.id === wellId);
  const day = days[wellId] ?? well.day;
  const setpoint = setpoints[wellId];

  const local = useMemo(() => buildState(well, day, setpoint), [well, day, setpoint, calib]); // eslint-disable-line react-hooks/exhaustive-deps -- calib changes the twin's constants

  // Data source: 'local' (twin.js in the browser, default) or 'api' (FastAPI edge service).
  // In API mode the local state stays on screen until the server answers, and if it fails.
  const [source, setSource] = useState('local');
  const [remote, setRemote] = useState({ state: null, error: null });
  useEffect(() => {
    if (source !== 'api') return;
    let live = true;
    fetchState(well.id, day, setpoint)
      .then((st) => live && setRemote({ state: { ...st, well }, error: null }))
      .catch((e) => live && setRemote((r) => ({ ...r, error: e.message })));
    return () => { live = false; };
  }, [source, well, day, setpoint]);
  const fresh = remote.state && remote.state.well.id === well.id && remote.state.day === day;
  const s = source === 'api' && fresh ? remote.state : local;
  const design = useMemo(() => designSpace(well), [well, calib]); // eslint-disable-line react-hooks/exhaustive-deps
  const recs = useMemo(() => recommendations(s, design), [s, design]);
  const shown = recs.filter((r) => REQUIRED_FIELDS.every((k) => r[k]));
  const fleet = useMemo(
    () => WELLS.map((w) => (w.id === wellId ? s : cachedState(w, days[w.id] ?? w.day, setpoints[w.id]))),
    [s, wellId, days, setpoints],
  );

  // Run cycle (demo): injection + soak pre-roll (demoT < 0), then production day 0 → horizon in ~15 s.
  const [demoT, setDemoT] = useState(null);
  const [pace, setPace] = useState(1);
  const [demoOpen, setDemoOpen] = useState(true); // panel expanded, or minimised to a chip while the demo keeps running
  useEffect(() => {
    if (!playing) return;
    if (demoT >= FIELD.horizon) { setPlaying(false); return; }
    const id = setTimeout(() => {
      const t = demoT + 1;
      setDemoT(t);
      if (t >= 0) setDays((p) => ({ ...p, [wellId]: t }));
    }, (demoT < 0 ? 400 : 15000 / FIELD.horizon) / pace); // pre-roll ticks slower so injection and soak stay readable
    return () => clearTimeout(id);
  }, [playing, demoT, wellId, pace]);
  const stopDemo = () => { setPlaying(false); setDemoT(null); };


  // Every setpoint goes through the safety envelope; every outcome is logged.
  // In API mode the server's envelope decides (callers await the result either way).
  function record(req, { applied, binding }) {
    setSetpoints((p) => ({ ...p, [wellId]: applied }));
    const label = (x) => `SPM ${x.spm.toFixed(1)} · down ${Math.round(x.down * 100)}%`;
    setLog((l) => [{ time: clock(), well: wellId, requested: label(req), applied: label(applied), binding, action: binding ? 'clamped' : 'accepted' }, ...l]);
    return { applied, binding };
  }
  function submit(req) {
    if (source !== 'api') return record(req, envelope(well, day, req));
    return submitSetpoint(wellId, day, req).then((r) => record(req, r), (e) => {
      setRemote((r) => ({ ...r, error: e.message }));
      return record(req, envelope(well, day, req)); // server unreachable: the local envelope still guards
    });
  }

  const ctx = {
    s, well, day, design, recs: shown, suppressed: recs.length - shown.length, allRecs: recs, fleet, log,
    setDay: (d) => { stopDemo(); setDays((p) => ({ ...p, [wellId]: d })); },
    resetDay: () => { stopDemo(); setDays((p) => { const { [wellId]: _, ...rest } = p; return rest; }); },
    selectWell: (id) => { stopDemo(); setWellId(id); },
    playing,
    demoT,
    stopDemo,
    pace,
    setPace,
    demoOpen,
    setDemoOpen,
    calib,
    acceptCalib,
    sources: sourceRows(calib),
    learnTab,
    setLearnTab,
    runCycle: () => {
      if (playing) return setPlaying(false);
      if (demoT != null && demoT < FIELD.horizon) return setPlaying(true); // resume
      setDays((p) => ({ ...p, [wellId]: 0 }));
      setDemoT(-(FIELD.tInj + well.soak));
      setDemoOpen(true);
      setPlaying(true);
    },
    submit,
    go,
    source,
    setSource,
    apiError: source === 'api' ? remote.error : null,
  };
  const Page = PAGES[page];

  return (
    <Shell page={page} go={go} ctx={ctx}>
      {/* keyed on calibration so pages' own memoised physics recompute */}
      <Boundary page={page}><Page key={JSON.stringify(calib)} ctx={ctx} /></Boundary>
    </Shell>
  );
}
