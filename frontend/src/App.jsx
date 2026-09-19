import React, { useEffect, useMemo, useState } from 'react';
import Shell from './components/Shell';
import { WELLS, buildState, envelope, recommendations, designSpace, REQUIRED_FIELDS } from './data/twin';
import Overview from './pages/Overview';
import Reservoir from './pages/Reservoir';
import Wellbore from './pages/Wellbore';
import RodString from './pages/RodString';
import Learning from './pages/Learning';
import Recommendations from './pages/Recommendations';
import SrpControl from './pages/SrpControl';
import CssDesign from './pages/CssDesign';
import Telemetry from './pages/Telemetry';
import Traceability from './pages/Traceability';

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

const clock = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

const SEED_LOG = [
  { time: '09:12', well: 'BGW-11', requested: 'SPM 5.4 · down 100%', applied: 'SPM 3.9 · down 100%', binding: 'FMI(z) > 0.15', action: 'clamped' },
  { time: '07:40', well: 'BGW-15', requested: 'SPM 5.6 · down 100%', applied: 'SPM 5.0 · down 100%', binding: 'FMI(z) > 0.15', action: 'clamped' },
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

  const well = WELLS.find((w) => w.id === wellId);
  const day = days[wellId] ?? well.day;
  const setpoint = setpoints[wellId];

  const s = useMemo(() => buildState(well, day, setpoint), [well, day, setpoint]);
  const design = useMemo(() => designSpace(well), [well]);
  const recs = useMemo(() => recommendations(s, design), [s, design]);
  const shown = recs.filter((r) => REQUIRED_FIELDS.every((k) => r[k]));
  const fleet = useMemo(
    () => WELLS.map((w) => buildState(w, days[w.id] ?? w.day, setpoints[w.id])),
    [days, setpoints],
  );

  // Every setpoint goes through the safety envelope; every outcome is logged.
  function submit(req) {
    const { applied, binding } = envelope(well, day, req);
    setSetpoints((p) => ({ ...p, [wellId]: applied }));
    const label = (x) => `SPM ${x.spm.toFixed(1)} · down ${Math.round(x.down * 100)}%`;
    setLog((l) => [{ time: clock(), well: wellId, requested: label(req), applied: label(applied), binding, action: binding ? 'clamped' : 'accepted' }, ...l]);
    return { applied, binding };
  }

  const ctx = {
    s, well, day, design, recs: shown, suppressed: recs.length - shown.length, allRecs: recs, fleet, log,
    setDay: (d) => setDays((p) => ({ ...p, [wellId]: d })),
    resetDay: () => setDays((p) => { const { [wellId]: _, ...rest } = p; return rest; }),
    selectWell: setWellId,
    submit,
    go,
  };
  const Page = PAGES[page];

  return (
    <Shell page={page} go={go} ctx={ctx}>
      <Boundary page={page}><Page ctx={ctx} /></Boundary>
    </Shell>
  );
}
