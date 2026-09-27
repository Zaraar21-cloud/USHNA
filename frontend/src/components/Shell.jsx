import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid, Flame, Sparkles, Brain,
  ChevronDown, ChevronRight, Bell, Menu, X, Play, Pause, Compass, Wrench,
} from 'lucide-react';
import { Avatar, Badge, sub, PhaseBadge, PhaseTimeline } from './ui';
import { FIELD, SOURCES, getPhase } from '../data/twin';
import { AI } from '../data/ml';

// Ordered by the story a first-time visitor follows, not by architecture.
const NAV = [
  { id: 'Overview', label: 'Dashboard', icon: LayoutGrid },
  { group: 'Well twin', icon: Flame, items: [
    { id: 'Reservoir', label: 'Reservoir & CSS' },
    { id: 'Wellbore', label: 'Wellbore' },
    { id: 'RodString', label: 'Rod string' },
  ] },
  { id: 'Learning', label: 'AI models', icon: Brain, badge: 'AI' },
  { group: 'Decisions', icon: Sparkles, items: [
    { id: 'Recommendations', label: 'Recommendations' },
    { id: 'SrpControl', label: 'SRP control' },
    { id: 'CssDesign', label: 'CSS design' },
  ] },
  { group: 'Under the hood', icon: Wrench, items: [
    { id: 'Telemetry', label: 'Edge telemetry' },
    { id: 'Traceability', label: 'Traceability' },
  ] },
];

const n0 = (x) => Math.round(x).toLocaleString('en-IN');
const TOUR = [
  { page: 'Reservoir', target: 'thermal', title: 'The problem',
    text: (s) => `After each steam job the heated zone cools. Oil at the pump thickens from ${n0(s.rows[0].mu)} cP on day 0 to ${n0(s.rows[s.cut.day].mu)} cP by the cut-off on day ${s.cut.day}.` },
  { page: 'Wellbore', target: 'ramey', title: 'The coupling',
    text: () => `Physics computes the viscosity at the pump, ${FIELD.pumpDepth} m down. No sensor can measure it; the twin infers it from temperature.` },
  { page: 'Learning', tab: 'PINN surrogate', target: 'pinn', title: 'The AI: a physics-informed neural network',
    text: () => `A neural network trained on the heat equation plus sparse sensor data learned how the heated zone cools. On steam designs it never saw it is within ${AI.pinn.rmse.toFixed(1)} °C of the full solver, ${Math.round(AI.pinn.speedup)}× faster, and it passed an energy-conservation audit before the optimizer may use it.` },
  { page: 'Learning', tab: 'EnKF assimilation', target: 'enkf', title: 'The AI keeps the twin honest',
    text: () => `Every day an ensemble Kalman filter re-estimates the well's hidden physics from temperature and rate. In ${AI.enkf.days} days it cut the uncertainty on permeability-thickness by ${Math.round(AI.enkf.collapse)}%, so the twin matches its own well, not a textbook one.` },
  { page: 'RodString', target: 'fmi', title: 'The risk',
    text: () => 'The Float Margin Index falls toward 0.15 as the oil thickens. Below that the rods cannot fall fast enough on the downstroke: they float, buckle and break.' },
  { page: 'Recommendations', target: 'rec', title: 'The decision',
    text: () => 'The controller cuts pumping speed before the limit is reached. Every card shows the governing equation, the numbers behind it and a confidence.' },
  { page: 'SrpControl', target: 'envelope', title: 'The guard',
    text: () => 'Every setpoint, from the optimizer or a person, passes a rule-based safety envelope. Unsafe requests are clamped and every veto is logged. Try SPM 9 and submit.' },
];

const SEEN_KEY = 'ushna.aboutSeen';
const firstVisit = () => { try { return !localStorage.getItem(SEEN_KEY); } catch { return true; } };

function useClickAway(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => ref.current && !ref.current.contains(e.target) && close();
    const k = (e) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, close]);
  return ref;
}

function Popover({ button, children, align = 'left', width = 'w-72' }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`absolute top-full z-40 mt-2 ${width} ${align === 'right' ? 'right-0' : 'left-0'} card p-3 shadow-xl`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function alertsFor(fleet) {
  const out = [];
  for (const st of fleet) {
    if (st.fmiMin.fmi <= FIELD.fmiLimit) out.push({ tone: 'crit', well: st.well.id, text: `FMI ${st.fmiMin.fmi.toFixed(2)} below 0.15 — rod float risk` });
    if (st.now.fillage < FIELD.fillageLimit) out.push({ tone: 'warn', well: st.well.id, text: `Pump fillage ${Math.round(st.now.fillage * 100)}% < 85% — fluid pound risk` });
    if (st.cut.day - st.day <= 7 && st.cut.day >= st.day) out.push({ tone: 'warn', well: st.well.id, text: `Cut-off in ${st.cut.day - st.day} d — book boiler` });
    if (st.asphaltene) out.push({ tone: 'info', well: st.well.id, text: `T_pump ${Math.round(st.now.Tpump)} °C below asphaltene onset` });
  }
  return out;
}

export default function Shell({ page, go, ctx, children }) {
  const { s, well, day, fleet, recs } = ctx;
  const [mobileNav, setMobileNav] = useState(false);
  const alerts = alertsFor(fleet);
  const progress = Math.min(1, day / Math.max(s.cut.day, 1));
  const [about, setAbout] = useState(firstVisit);
  const closeAbout = () => { setAbout(false); try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ } };
  const [tourStep, setTourStep] = useState(null);
  const step = tourStep == null ? null : TOUR[tourStep];

  // Tour: navigate to the step's page, then spotlight its panel.
  useEffect(() => {
    if (!step) return;
    if (step.tab && ctx.learnTab !== step.tab) { ctx.setLearnTab(step.tab); return; }
    if (page !== step.page) { go(step.page); return; }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.classList.add('tour-focus');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return () => el.classList.remove('tour-focus');
  }, [step, page, ctx.learnTab]); // eslint-disable-line react-hooks/exhaustive-deps -- go is recreated every render
  const startTour = () => { closeAbout(); setTourStep(0); };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top navigation ── */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-3 border-b border-line bg-white px-4 lg:px-6">
        <button className="lg:hidden p-2 -ml-2" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
          <Menu size={20} />
        </button>
        <button onClick={() => go('Overview')} className="shrink-0 text-[22px] font-extrabold tracking-tight">
          ushna<span className="text-brand-500">.</span>
        </button>

        <Popover
          button={({ toggle, open }) => (
            <button onClick={toggle} aria-expanded={open} className="ml-1 flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line pl-1 pr-3 text-sm font-medium hover:bg-canvas sm:ml-2">
              <Avatar text={well.id.slice(-2)} color={well.hue} size={26} />
              {well.id}
              <ChevronDown size={14} className="text-ink-3" />
            </button>
          )}
        >
          {(close) => (
            <ul>
              <li className="px-2 pb-2 text-xs text-ink-3">{FIELD.field}</li>
              {fleet.map((st) => (
                <li key={st.well.id}>
                  <button
                    onClick={() => { ctx.selectWell(st.well.id); close(); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-canvas ${st.well.id === well.id ? 'bg-brand-50' : ''}`}
                  >
                    <Avatar text={st.well.id.slice(-2)} color={st.well.hue} size={24} />
                    <span className="font-medium">{st.well.id}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <PhaseBadge phase={getPhase(st.well, st.day).phase} size="sm" />
                      <span className="text-xs text-ink-3 num">C{st.well.cycle} · d{st.day}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>

        <ProvenanceBadge onClick={() => setAbout(true)} className="hidden md:flex" />

        {/* Cycle control: run the cycle, or scrub it */}
        <div className="hidden lg:flex min-w-0 flex-1 justify-center">
          <div className="flex items-center rounded-full bg-white ring-1 ring-line">
          <RunButton ctx={ctx} className="rounded-l-full border-r border-line pl-3 pr-3 hover:bg-canvas" />
          <Popover
            width="w-80"
            button={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} className={`${PILL} rounded-r-full px-3 hover:bg-canvas`} title="Scrub the production cycle">
                <span className="font-semibold num">Day {day}</span>
                <span className="text-ink-3">· cut-off {s.cut.day}</span>
                <PhaseBadge phase={s.phaseInfo?.phase} size="sm" />
                <span className="h-1.5 w-16 rounded-full bg-[#F1F1F5]">
                  <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${progress * 100}%` }} />
                </span>
                <ChevronDown size={14} className="text-ink-3" />
              </button>
            )}
          >
            {() => (
              <div className="p-1">
                <p className="text-sm font-semibold">Scrub the production cycle</p>
                <p className="mt-1 text-xs text-ink-2">Every page recomputes from the physics chain as the heated zone cools.</p>
                <div className="mt-3 mb-1">
                  <PhaseTimeline phaseInfo={s.phaseInfo} />
                </div>
                <input
                  type="range" min={0} max={FIELD.horizon} value={day}
                  onChange={(e) => ctx.setDay(+e.target.value)}
                  className="mt-3 w-full accent-brand-500" aria-label="Production day"
                />
                <div className="mt-1 flex justify-between text-xs text-ink-3 num"><span>day 0</span><span>day {FIELD.horizon}</span></div>
                <button onClick={ctx.resetDay} className="mt-3 text-xs font-medium text-brand-600 hover:underline">Back to live (day {well.day})</button>
              </div>
            )}
          </Popover>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <RunButton ctx={ctx} className="w-9 justify-center rounded-full border border-line hover:bg-canvas lg:hidden" iconOnly />
          <button onClick={startTour} className={`${PILL} w-9 justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 sm:w-auto sm:px-3.5`} aria-label="Start the 60-second guided tour">
            <Compass size={16} />
            <span className="hidden sm:inline xl:hidden">Tour</span>
            <span className="hidden xl:inline">60-second tour</span>
          </button>
          <Popover
            align="right" width="w-80"
            button={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} className={`${PILL} relative hidden w-9 justify-center rounded-full text-ink-2 hover:bg-canvas hover:text-ink sm:inline-flex`} aria-label={`${alerts.length} alerts`}>
                <Bell size={18} />
                {alerts.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-viz-pink" />}
              </button>
            )}
          >
            {(close) => (
              <div>
                <p className="px-1 pb-2 text-sm font-semibold">Fleet alerts</p>
                <ul className="max-h-80 overflow-y-auto">
                  {alerts.map((a, i) => (
                    <li key={i}>
                      <button onClick={() => { ctx.selectWell(a.well); close(); }} className="flex w-full items-start gap-2 rounded-lg px-1 py-2 text-left text-sm hover:bg-canvas">
                        <Badge tone={a.tone}>{a.well}</Badge>
                        <span className="text-ink-2">{sub(a.text)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Popover>
          <button onClick={() => go('Recommendations')} className={`${PILL} hidden rounded-full border border-line px-3.5 hover:bg-canvas xl:inline-flex`}>
            Recommendations
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white num">{recs.length}</span>
          </button>
        </div>
      </header>
      <ProvenanceBadge onClick={() => setAbout(true)} strip className="md:hidden" />

      <div className="flex flex-1">
        {/* ── Sidebar ── */}
        {mobileNav && <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setMobileNav(false)} />}
        <aside
          className={`${mobileNav ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'} lg:sticky lg:top-16 lg:flex h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] w-64 shrink-0 flex-col border-r border-line bg-white max-lg:h-full`}
        >
          <div className="flex items-center justify-between p-4 lg:hidden">
            <span className="text-lg font-extrabold">ushna<span className="text-brand-500">.</span></span>
            <button onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto py-3">
            {NAV.map((n) => (n.group ? <NavGroup key={n.group} n={n} page={page} go={(p) => { go(p); setMobileNav(false); }} /> : (
              <NavItem key={n.id} n={n} active={page === n.id} go={() => { go(n.id); setMobileNav(false); }} />
            )))}
          </nav>
          <button onClick={() => setAbout(true)} className="px-5 py-4 text-left text-[11px] text-ink-3 hover:text-ink-2">Synthetic wells · 6 of 35 modelled · about this data</button>
        </aside>

        <main className="min-w-0 flex-1 bg-white">
          <div className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</div>
          <footer className="border-t border-line px-4 py-5 text-center text-[11px] text-ink-3 lg:px-8">
            Prototype for SIH PS 26120 (Oil India Limited). All values come from the USHNA physics model running on synthetic data and are not operational advice.
            Every setpoint shown traces to a governing equation — see <button onClick={() => go('Traceability')} className="underline">Traceability</button>.
          </footer>
        </main>
      </div>
      {about && (
        <AboutData
          onClose={closeAbout}
          onStart={() => { ctx.selectWell('BGW-07'); go('Overview'); closeAbout(); }}
          onTour={() => { ctx.selectWell('BGW-07'); startTour(); }}
        />
      )}
      {step && (
        <TourPanel
          step={step} i={tourStep} n={TOUR.length} s={s}
          onPrev={() => setTourStep((i) => Math.max(0, i - 1))}
          onNext={() => setTourStep((i) => (i + 1 < TOUR.length ? i + 1 : null))}
          onClose={() => setTourStep(null)}
        />
      )}
    </div>
  );
}

// Shared header control: 36px pill, never wraps or shrinks.
const PILL = 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors';

function RunButton({ ctx, className = '', iconOnly }) {
  const label = ctx.playing ? 'Pause' : 'Run cycle';
  return (
    <button
      onClick={ctx.runCycle}
      className={`${PILL} ${className}`}
      aria-label={ctx.playing ? 'Pause the cycle' : `Run the production cycle, day 0 to ${FIELD.horizon}`}
      title={ctx.playing ? 'Pause' : `Animate day 0 → ${FIELD.horizon} in 15 s`}
    >
      {ctx.playing ? <Pause size={15} className="text-brand-600" /> : <Play size={15} className="fill-brand-500 text-brand-500" />}
      {!iconOnly && <span className="hidden xl:inline">{label}</span>}
    </button>
  );
}

function ProvenanceBadge({ onClick, strip, className = '' }) {
  const full = 'calibrated to published Baghewala parameters';
  return (
    <button
      onClick={onClick}
      title={strip ? undefined : `Synthetic data, ${full}. Click for sources.`}
      className={`${className} items-center gap-1.5 text-xs text-amber-900 ${strip
        ? 'flex w-full justify-center border-b border-amber-200 bg-amber-50 px-4 py-1.5'
        : `${PILL} h-8 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs hover:bg-amber-100`}`}
      aria-label={`Synthetic data, ${full}. Open details.`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      <b className="font-semibold tracking-wide">SYNTHETIC DATA</b>
      {strip && <span>· {full}</span>}
    </button>
  );
}

function AboutData({ onClose, onStart, onTour }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="about-title" className="card relative max-h-[90vh] w-full max-w-xl overflow-y-auto p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-ink-3 hover:text-ink" aria-label="Close"><X size={18} /></button>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> SYNTHETIC DATA
        </span>
        <h2 id="about-title" className="mt-3 text-xl font-bold tracking-tight">This is a working physics model, not live field data.</h2>
        <p className="mt-3 text-sm text-ink-2">
          Oil India's Baghewala field does not publish per-well telemetry. Every number here is computed live in your browser by the USHNA physics engine
          (the Marx–Langenheim, Ramey, Walther and Gibbs equations described in our solution) running on synthetic wells calibrated to published Baghewala parameters.
        </p>
        <table className="mt-4 w-full text-left text-xs">
          <thead><tr className="text-ink-3"><th className="pb-1 font-medium">Calibrated to</th><th className="pb-1 font-medium">Value</th><th className="pb-1 font-medium">Source</th></tr></thead>
          <tbody>
            {SOURCES.map(([k, v, src]) => (
              <tr key={k} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 text-ink-2">{k}</td><td className="py-1.5 pr-2 font-medium">{v}</td><td className="py-1.5 text-ink-2">{src}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <p className="rounded-xl bg-emerald-50 p-3 text-emerald-900"><b>What is real:</b> the equations, the coupling, the solver, the trained AI models, the safety logic.</p>
          <p className="rounded-xl bg-amber-50 p-3 text-amber-900"><b>What is synthetic:</b> the six wells (of 35 in the field) and their sensor streams.</p>
        </div>
        <p className="mt-4 text-sm font-medium">Connected to a live SCADA feed, only the data source changes. The model does not.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button autoFocus onClick={onStart} className="btn-primary">Start with BGW-07</button>
          <button onClick={onTour} className="btn-ghost"><Compass size={15} /> Show me the physics</button>
        </div>
      </div>
    </div>
  );
}

function TourPanel({ step, i, n, s, onPrev, onNext, onClose }) {
  return (
    <div role="dialog" aria-label="Guided tour" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-2xl bg-ink p-5 text-white shadow-2xl">
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>Step {i + 1} of {n}</span>
        <button onClick={onClose} className="hover:text-white" aria-label="End tour"><X size={16} /></button>
      </div>
      <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
      <p className="mt-1 text-sm text-white/85">{step.text(s)}</p>
      <div className="mt-4 flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: n }, (_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-brand-500' : 'bg-white/20'}`} />)}
        </div>
        {i > 0 && <button onClick={onPrev} className="rounded-full px-3 py-1.5 text-sm text-white/80 hover:text-white">Back</button>}
        <button onClick={onNext} className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-ink hover:bg-white/90">{i + 1 < n ? 'Next' : 'Done'}</button>
      </div>
    </div>
  );
}

function NavItem({ n, active, go, child }) {
  const Icon = n.icon;
  return (
    <button
      onClick={go}
      aria-current={active ? 'page' : undefined}
      className={`relative flex w-full items-center gap-3 py-2 pr-4 text-sm transition-colors ${child ? 'pl-12' : 'pl-5'} ${
        active ? 'bg-brand-50 font-medium text-ink' : 'text-ink-2 hover:bg-canvas hover:text-ink'
      }`}
    >
      {active && <span className="absolute left-0 top-0 h-full w-[3px] bg-brand-500" />}
      {Icon && <Icon size={17} className={active ? 'text-brand-600' : 'text-ink-3'} />}
      {n.label}
      {n.badge && <span className="ml-1 rounded bg-viz-blue px-1.5 py-px text-[10px] font-bold text-white">{n.badge}</span>}
    </button>
  );
}

function NavGroup({ n, page, go }) {
  const hasActive = n.items.some((i) => i.id === page);
  const [open, setOpen] = useState(true);
  const Icon = n.icon;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex w-full items-center gap-3 py-2 pl-5 pr-4 text-sm hover:bg-canvas ${hasActive ? 'text-ink font-medium' : 'text-ink-2'}`}>
        <Icon size={17} className="text-ink-3" />
        {n.group}
        {open ? <ChevronDown size={15} className="ml-auto text-ink-3" /> : <ChevronRight size={15} className="ml-auto text-ink-3" />}
      </button>
      {open && n.items.map((i) => <NavItem key={i.id} n={i} child active={page === i.id} go={() => go(i.id)} />)}
    </div>
  );
}
