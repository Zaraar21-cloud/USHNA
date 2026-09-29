import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid, Flame, Sparkles, Brain,
  ChevronDown, ChevronRight, Bell, Menu, X, Play, Pause, Compass, Wrench, Pencil, RotateCcw, Check,
} from 'lucide-react';
import { Avatar, Badge, Toggle, sub } from './ui';
import { FIELD, CALIBRATION, SOURCE_NOTES, calibDefaults, fmtCalib, mid, heatedRadius, viscosity } from '../data/twin';
import { AI } from '../data/ml';
import { WellRecords } from './Records';
import { CSS_TABS } from '../pages/CssDesign';

// Ordered by the story a first-time visitor follows, not by architecture.
const NAV = [
  { id: 'Overview', label: 'Dashboard', icon: LayoutGrid },
  { group: 'Well Digital Twin', icon: Flame, items: [
    { id: 'Reservoir', label: 'Reservoir & Cyclic Steam' },
    { id: 'Wellbore', label: 'Wellbore' },
    { id: 'RodString', label: 'Rod String' },
  ] },
  { id: 'Learning', label: 'Learning Layers', icon: Brain },
  { group: 'Decision Support', icon: Sparkles, items: [
    { id: 'Recommendations', label: 'Recommendations' },
    { id: 'SrpControl', label: 'Sucker Rod Pump Control' },
    { id: 'CssDesign', label: 'Cyclic Steam Design' },
  ] },
  { group: 'Data & Audit', icon: Wrench, items: [
    { id: 'Telemetry', label: 'Edge Telemetry' },
    { id: 'Traceability', label: 'Traceability' },
  ] },
];

const n0 = (x) => Math.round(x).toLocaleString('en-IN');
// Ordered by the architecture diagram (Traceability page), so each step's layer badge maps to a box on the slide.
const TOUR = [
  { layer: 'Observation layer', page: 'Telemetry', target: 'telemetry', title: 'Data Acquisition',
    text: () => 'The digital twin uses data the well pad already records: Supervisory Control and Data Acquisition (SCADA), Variable Frequency Drive (VFD), surface dynamometer, wellhead pressure and steam flow. Shown here is a simulated polished-rod vibration stream, in which spikes indicate rod impact. The twin also ingests the pad\'s historical cycle records: upload a spreadsheet or PDF below, or load the sample file.' },
  { layer: 'Physics core · reservoir', page: 'Reservoir', target: 'thermal', title: 'Problem Statement: Heated-Zone Cooling',
    text: ({ s }) => `After each steam injection the heated zone cools. Crude viscosity at the pump rises from ${n0(s.rows[0].mu)} cP on day 0 to ${n0(s.rows[s.cut.day].mu)} cP by the economic cut-off on day ${s.cut.day}.` },
  { layer: 'Physics core · wellbore', page: 'Wellbore', target: 'ramey', title: 'Thermal–Mechanical Coupling',
    text: () => `The physics model computes crude viscosity at the pump, ${FIELD.pumpDepth} m below surface. No sensor measures it directly; the digital twin infers it from temperature.` },
  { layer: 'Physics core · rod string', page: 'RodString', target: 'fmi', title: 'Rod Float Risk',
    text: () => 'The Float Margin Index (FMI) falls toward its 0.15 limit as crude viscosity rises. Below that limit the rods cannot descend fast enough on the downstroke; they float, buckle and eventually fail.' },
  { layer: 'Self-calibration', page: 'Learning', tab: 'Ensemble Kalman Filter', target: 'enkf', title: 'Self-Calibration by Data Assimilation',
    text: () => `Each day an Ensemble Kalman Filter (EnKF) re-estimates the well's unobserved reservoir parameters from temperature and rate data. Over ${AI.enkf.days} days it reduced the uncertainty in permeability-thickness by ${Math.round(AI.enkf.collapse)}%, so the twin represents this specific well rather than a generic one.` },
  { layer: 'Machine learning acceleration', page: 'Learning', tab: 'Physics-Informed Neural Network', target: 'pinn', title: 'Physics-Informed Neural Network Surrogate',
    text: () => `A Physics-Informed Neural Network (PINN), trained on the heat equation and sparse sensor data, models how the heated zone cools. On steam designs excluded from training it is within ${AI.pinn.rmse.toFixed(1)} °C of the full solver and ${Math.round(AI.pinn.speedup)}× faster, and it passed an energy-conservation audit before being released to the optimizer.`,
    more: 'This section also contains a Gaussian Process residual model, which quantifies effects the physics does not capture, and symbolic regression, which proposes closed-form field correlations, including one for viscosity.' },
  { layer: 'Optimization layer', page: 'CssDesign', target: 'cutoff', title: 'Steam Cycle Design',
    text: ({ s, design }) => `${s.well.id} should be re-injected with steam around day ${s.cut.day}, when daily profit falls below the average of a new cycle. For the next cycle, a Net Present Value (NPV) search over steam volume and soak time selects ${n0(design.best.steam)} t and ${design.best.soak} days (Cycle Design tab).` },
  { layer: 'Optimization layer', page: 'Recommendations', target: 'rec', title: 'Operational Recommendations',
    text: () => 'The controller reduces pumping speed before the limit is reached. Each recommendation states its governing equation, the supporting values and a confidence level.' },
  { layer: 'Safety envelope', page: 'Overview', target: 'controls', title: 'Safety Envelope Demonstration',
    text: () => 'Set strokes per minute (SPM) to 9 and observe the Float Margin Index become negative. The safety envelope rejects the setpoint before it reaches the well.' },
  { layer: 'Safety envelope', page: 'SrpControl', target: 'envelope', title: 'Setpoint Audit Log',
    text: () => 'Every setpoint, whether from the optimizer or an operator, passes through this rule-based safety envelope. Unsafe requests are limited, and each intervention is logged with the constraint that triggered it.' },
  { layer: 'Closed loop', end: true, title: 'End-to-End Traceability',
    text: () => 'Every setpoint shown in this tour is logged with its equation, its inputs and its approver. The Traceability page holds that record: any value on this site can be traced back to the physics that produced it.' },
];

// Where the numbers come from: the in-browser twin (default, works as a static site) or the FastAPI edge service.
function SourceToggle({ ctx, className = '' }) {
  const opt = (id, label) => (
    <button
      onClick={() => ctx.setSource(id)} aria-pressed={ctx.source === id}
      className={`rounded-full px-2.5 py-1 ${ctx.source === id ? 'bg-brand-500 text-white' : 'text-ink-2 hover:text-ink'}`}
    >{label}</button>
  );
  return (
    <div
      className={`${className} items-center gap-0.5 rounded-full p-0.5 text-xs font-medium ring-1 ${ctx.apiError ? 'ring-red-300' : 'ring-line'}`}
      title={ctx.apiError ? `Edge service unreachable (${ctx.apiError}); showing in-browser results` : 'Data source: physics computed in the browser, or the FastAPI edge service'}
    >
      {opt('local', 'Browser')}
      {opt('api', ctx.apiError ? 'Edge API ⚠' : 'Edge API')}
    </div>
  );
}

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
    if (st.fmiMin.fmi <= FIELD.fmiLimit) out.push({ tone: 'crit', well: st.well.id, text: `Float Margin Index ${st.fmiMin.fmi.toFixed(2)} below the 0.15 limit: rod float risk` });
    if (st.now.fillage < FIELD.fillageLimit) out.push({ tone: 'warn', well: st.well.id, text: `Pump fillage ${Math.round(st.now.fillage * 100)}% below 85%: fluid pound risk` });
    if (st.cut.day - st.day <= 7 && st.cut.day >= st.day) out.push({ tone: 'warn', well: st.well.id, text: `Economic cut-off in ${st.cut.day - st.day} days: schedule the boiler` });
    if (st.asphaltene) out.push({ tone: 'info', well: st.well.id, text: `T_pump ${Math.round(st.now.Tpump)} °C, below the asphaltene onset temperature` });
  }
  return out;
}

export default function Shell({ page, go, ctx, children }) {
  const { s, well, day, fleet, recs } = ctx;
  const [mobileNav, setMobileNav] = useState(false);
  const alerts = alertsFor(fleet);
  const progress = Math.min(1, day / Math.max(s.cut.day, 1));
  // 'welcome' = the first-visit modal, read-only: show the judge something before asking them to configure it.
  const [about, setAbout] = useState(() => (firstVisit() ? 'welcome' : false));
  const closeAbout = () => { setAbout(false); try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ } };
  const [tourStep, setTourStep] = useState(null);
  const [tips, setTips] = useState(false);
  const step = tourStep == null ? null : TOUR[tourStep];
  const pickWell = ctx.pickWell;
  useEffect(() => { if (step && ctx.wellInfo) ctx.closeWellInfo(); }, [step, ctx.wellInfo]); // eslint-disable-line react-hooks/exhaustive-deps -- no pop-up over (or queued behind) the tour

  // First visit: the cycle is already running, slowly, behind the welcome modal.
  useEffect(() => {
    if (about !== 'welcome') return;
    ctx.setPace(0.5);
    ctx.runCycle({ stay: true }); // stays on the Dashboard behind the modal
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  // Tour: navigate to the step's page, then spotlight its panel.
  useEffect(() => {
    if (!step?.page) return;
    if (step.tab && ctx.learnTab !== step.tab) { ctx.setLearnTab(step.tab); return; }
    if (page !== step.page) { go(step.page); return; }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' }); // top of the card below the header, clear of the tour panel on phones
    el.classList.add('tour-focus');
    return () => el.classList.remove('tour-focus');
  }, [step, page, ctx.learnTab]); // eslint-disable-line react-hooks/exhaustive-deps -- go is recreated every render
  const startTour = () => {
    closeAbout(); setTips(false); setTourStep(0);
    ctx.setCssTab(CSS_TABS[0]); // the CSS step spotlights the cut-off card on the first tab
    ctx.resetDay(); // end the demo, back to the live day: the tour's text and spotlights assume a still well state
  };
  const endTour = (to) => { setTourStep(null); setTips(true); if (to) go(to); };

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
                    onClick={() => { pickWell(st.well.id); close(); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-canvas ${st.well.id === well.id ? 'bg-brand-50' : ''}`}
                  >
                    <Avatar text={st.well.id.slice(-2)} color={st.well.hue} size={24} />
                    <span className="font-medium">{st.well.id}</span>
                    <span className="ml-auto text-xs text-ink-3 num">Cycle {st.well.cycle} · day {st.day}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>

        <ProvenanceBadge onClick={() => setAbout(true)} className="hidden md:flex" />

        {/* Cycle control: run the cycle, or scrub it */}
        <div className="hidden lg:flex min-w-0 flex-1 justify-center">
          <div className="relative flex items-center rounded-full bg-white ring-1 ring-line">
          {ctx.demoT != null && !ctx.demoOpen && <DemoChip ctx={ctx} className="absolute left-0 top-full mt-1.5 flex" />}
          <RunButton ctx={ctx} className="rounded-l-full border-r border-line pl-3 pr-3 hover:bg-canvas" />
          <Popover
            width="w-80"
            button={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} className={`${PILL} rounded-r-full px-3 hover:bg-canvas`} title="Select a production day">
                <span className="font-semibold num">Day {day}</span>
                <span className="text-ink-3">· cut-off {s.cut.day}</span>
                <span className="h-1.5 w-16 rounded-full bg-[#F1F1F5]">
                  <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${progress * 100}%` }} />
                </span>
                <ChevronDown size={14} className="text-ink-3" />
              </button>
            )}
          >
            {() => (
              <div className="p-1">
                <p className="text-sm font-semibold">Production Day Selector</p>
                <p className="mt-1 text-xs text-ink-2">All pages recompute from the physics model as the heated zone cools.</p>
                <input
                  type="range" min={0} max={FIELD.horizon} value={day}
                  onChange={(e) => ctx.setDay(+e.target.value)}
                  className="mt-4 w-full accent-brand-500" aria-label="Production day"
                />
                <div className="mt-1 flex justify-between text-xs text-ink-3 num"><span>day 0</span><span>day {FIELD.horizon}</span></div>
                <button onClick={ctx.resetDay} className="mt-3 text-xs font-medium text-brand-600 hover:underline">Return to current day (day {well.day})</button>
              </div>
            )}
          </Popover>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <SourceToggle ctx={ctx} className="hidden md:flex" />
          <RunButton ctx={ctx} className="w-9 justify-center rounded-full border border-line hover:bg-canvas lg:hidden" iconOnly />
          <button onClick={startTour} className={`${PILL} w-9 justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 sm:w-auto sm:px-3.5`} aria-label="Start the guided tour, about 2 minutes">
            <Compass size={16} />
            <span className="hidden sm:inline xl:hidden">Tour</span>
            <span className="hidden xl:inline">Guided Tour (2 min)</span>
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
                <p className="px-1 pb-2 text-sm font-semibold">Fleet Alerts</p>
                <ul className="max-h-80 overflow-y-auto">
                  {alerts.map((a, i) => (
                    <li key={i}>
                      <button onClick={() => { pickWell(a.well); close(); }} className="flex w-full items-start gap-2 rounded-lg px-1 py-2 text-left text-sm hover:bg-canvas">
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
          <button onClick={() => setAbout(true)} className="px-5 py-4 text-left text-[11px] text-ink-3 hover:text-ink-2">Synthetic data: 6 of 35 wells modelled · Data sources</button>
        </aside>

        <main className={`min-w-0 flex-1 bg-white ${step || tips ? 'pb-72' : ''}`}>{/* room to scroll the last card above the bottom panel */}
          <div className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</div>
          <footer className="border-t border-line px-4 py-5 text-center text-[11px] text-ink-3 lg:px-8">
            Prototype for SIH PS 26120 (Oil India Limited). All values come from the USHNA physics model running on synthetic data and are not operational advice.
            Every setpoint shown traces to a governing equation; see <button onClick={() => go('Traceability')} className="underline">Traceability</button>.
          </footer>
        </main>
      </div>
      {ctx.demoT != null && (ctx.demoOpen
        ? <CyclePanel ctx={ctx} />
        : <DemoChip ctx={ctx} className="fixed right-3 top-[6rem] z-30 flex md:top-[4.5rem] lg:hidden" />)}
      {about && (
        <AboutData
          ctx={ctx}
          editable={about !== 'welcome'}
          onClose={closeAbout}
          onStart={closeAbout}
          onTour={() => { if (well.id !== 'BGW-07') ctx.selectWell('BGW-07'); startTour(); }} // selectWell would stop the demo
        />
      )}
      {ctx.wellInfo && !step && <WellRecords ctx={ctx} go={go} onClose={ctx.closeWellInfo} />}
      {step && (
        <TourPanel
          step={step} i={tourStep} n={TOUR.length} ctx={ctx}
          onPrev={() => setTourStep((i) => Math.max(0, i - 1))}
          onNext={() => setTourStep((i) => i + 1)}
          onEnd={endTour}
          onClose={() => setTourStep(null)}
        />
      )}
      {tips && !step && <TourTips ctx={ctx} go={go} onClose={() => setTips(false)} />}
    </div>
  );
}

// Shared header control: 36px pill, never wraps or shrinks.
const PILL = 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors';

function RunButton({ ctx, className = '', iconOnly }) {
  const paused = !ctx.playing && ctx.demoT != null && ctx.demoT < FIELD.horizon;
  const label = ctx.playing ? 'Pause' : paused ? 'Resume' : 'Run Cycle';
  return (
    <button
      onClick={ctx.runCycle}
      className={`${PILL} ${className}`}
      aria-label={ctx.playing ? 'Pause the demo cycle' : `${label} demo: steam injection, soak, then production day 0 to ${FIELD.horizon}`}
      title={ctx.playing ? 'Pause' : 'Demonstration: a full steam cycle, time-compressed to about 20 seconds'}
    >
      {ctx.playing ? <Pause size={15} className="text-brand-600" /> : <Play size={15} className="fill-brand-500 text-brand-500" />}
      {!iconOnly && <span className="hidden xl:inline">{label}</span>}
      {!iconOnly && <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-amber-900">DEMO</span>}
    </button>
  );
}

// What is happening in the well at demo time t (t < 0: injection/soak pre-roll, t ≥ 0: production day).
function cyclePhase(t, s) {
  const { well, now, cut } = s;
  const tInj = FIELD.tInj, soak = well.soak;
  if (t < -soak) {
    const d = t + tInj + soak + 1;
    return {
      name: 'Steam injection', color: '#F2549B', steam: true, well: 'Injecting', pump: 'Off',
      text: `Steam at ${FIELD.T_s} °C is injected down the well to heat the surrounding heavy crude. No oil is produced during injection.`,
      stats: [['Steam injected', `${n0(well.steam * d / tInj)} / ${n0(well.steam)} t`], ['Heated-zone radius', `${heatedRadius(well.steam, d).toFixed(1)} m`], ['Injection day', `${d} of ${tInj}`]],
    };
  }
  if (t < 0) {
    return {
      name: 'Soak (Shut-in)', color: '#F59E42', steam: false, well: 'Shut in', pump: 'Off',
      text: 'Steam injection has stopped and the well is shut in. Heat transfers from the steam into the crude, reducing its viscosity enough to flow.',
      stats: [['Soak day', `${t + soak + 1} of ${soak}`], ['Unheated crude viscosity', `${n0(viscosity(FIELD.T_R))} cP`], ['Heated crude viscosity', `${n0(s.rows[0].muH)} cP`]],
    };
  }
  const stats = [['Oil rate', `${n0(now.oil)} bbl/d`], ['Oil temperature at pump', `${Math.round(now.Tpump)} °C`], ['Oil viscosity', `${n0(now.mu)} cP`],
    ['Float Margin Index', `${s.fmiMin.fmi.toFixed(2)} (limit ${FIELD.fmiLimit})`], ['Oil produced', `${n0(now.cumOil)} bbl`], ['Economic cut-off', `day ${cut.day}`]];
  const base = { steam: false, well: 'Producing', pump: `${s.sp.spm.toFixed(1)} SPM`, stats };
  if (t >= FIELD.horizon) return { ...base, name: 'Demonstration Complete', color: '#8C8C9A',
    text: `Re-injecting steam on day ${cut.day} gives the highest average daily profit. Continuing to day ${FIELD.horizon} only produces cooler, more viscous crude.` };
  if (t > cut.day) return { ...base, name: 'Past Economic Cut-off: Re-inject Steam', color: '#8C8C9A',
    text: 'The heated zone is depleted. Each further production day earns less than a new steam cycle would, so the digital twin recommends re-injection.' };
  if (cut.day - t <= 7) return { ...base, name: 'Approaching Economic Cut-off', color: '#F5C542',
    text: `Daily profit is declining toward the economic cut-off on day ${cut.day}. Schedule the boiler for the next steam injection.` };
  return { ...base, name: 'Oil Production', color: '#3FB16B',
    text: 'The pump lifts heated, lower-viscosity crude. As the heated zone cools, viscosity rises, so the controller reduces pump speed to prevent rod float.' };
}

const PACES = [0.25, 0.5, 1, 2];

function CyclePanel({ ctx }) {
  const { s, well, demoT: t, playing } = ctx;
  const ph = cyclePhase(t, s);
  const done = t >= FIELD.horizon;
  const tInj = FIELD.tInj, soak = well.soak;
  const frac = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const segs = [
    ['Injection', '#F2549B', 1, frac(-tInj - soak, -soak)],
    ['Soak', '#F59E42', 1, frac(-soak, 0)],
    ['Production', '#3FB16B', 4, frac(0, FIELD.horizon)],
  ];
  const chip = (on, label, value) => (
    <span className={`flex flex-1 flex-col rounded-lg px-2 py-1.5 ${on ? 'bg-brand-50' : 'bg-canvas'}`}>
      <span className="text-[10px] uppercase tracking-wide text-ink-3">{label}</span>
      <span className={`text-xs font-semibold ${on ? 'text-brand-700' : 'text-ink-2'}`}>{value}</span>
    </span>
  );
  return (
    <div role="status" aria-live="polite" className="card fixed left-1/2 top-[4.5rem] z-40 w-[min(27rem,calc(100vw-2rem))] -translate-x-1/2 p-4 shadow-xl">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-amber-900">DEMONSTRATION</span>
        <span>{well.id} · cycle {well.cycle} · time-compressed</span>
        {!playing && t < FIELD.horizon && <span className="font-medium text-ink-2">· paused</span>}
        <button onClick={() => ctx.setDemoOpen(false)} className="ml-auto text-ink-3 hover:text-ink" aria-label="Minimise demonstration panel" title="Minimise (the demonstration continues)"><X size={16} /></button>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${playing ? 'animate-pulse' : ''}`} style={{ background: ph.color }} />
        <h3 className="text-lg font-bold tracking-tight">{ph.name}</h3>
        <span className="ml-auto text-xs text-ink-3 num">{t < 0 ? 'before production' : `production day ${Math.min(t, FIELD.horizon)}`}</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">{ph.text}</p>
      <div className="mt-3 flex gap-1">
        {segs.map(([label, color, w, f]) => (
          <div key={label} style={{ flex: w }}>
            <div className="relative h-1.5 rounded-full bg-[#F1F1F5]">
              <span className="block h-1.5 rounded-full" style={{ width: `${f * 100}%`, background: color }} />
              {label === 'Production' && <span className="absolute -top-1 h-3.5 w-0.5 bg-ink" style={{ left: `${(s.cut.day / FIELD.horizon) * 100}%` }} title={`Cut-off day ${s.cut.day}`} />}
            </div>
            <span className="mt-1 block text-[10px] text-ink-3">{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-1.5">
        {chip(ph.steam, 'Steam injection', ph.steam ? 'On' : 'Off')}
        {chip(ph.well === 'Producing', 'Well', ph.well)}
        {chip(ph.pump !== 'Off', 'Pump', ph.pump)}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
        {ph.stats.map(([k, v]) => (
          <div key={k}><dt className="text-[10px] text-ink-3">{k}</dt><dd className="text-sm font-semibold num">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button onClick={ctx.runCycle} className={`${PILL} h-8 rounded-full border border-line px-3 text-xs hover:bg-canvas`}>
          {playing ? <Pause size={13} /> : done ? <RotateCcw size={13} /> : <Play size={13} className="fill-current" />}
          {playing ? 'Pause' : done ? 'Replay' : 'Resume'}
        </button>
        <span className="ml-auto text-xs text-ink-3">Playback speed</span>
        <Toggle options={PACES.map((p) => `${p}×`)} value={`${ctx.pace}×`} onChange={(o) => ctx.setPace(parseFloat(o))} />
        <span className="w-full text-right text-[10px] text-ink-3 num">
          {(FIELD.horizon / 15) * ctx.pace} production days per second
        </span>
      </div>
    </div>
  );
}

// Minimised demo panel: current phase at a glance; click to reopen, ✕ ends the demo.
function DemoChip({ ctx, className = '' }) {
  const t = ctx.demoT, ph = cyclePhase(t, ctx.s);
  const paused = !ctx.playing && t < FIELD.horizon;
  return (
    <div className={`${className} items-center gap-0.5 whitespace-nowrap rounded-full bg-white py-0.5 pl-2 pr-0.5 text-[11px] shadow-md ring-1 ring-line`}>
      <button onClick={() => ctx.setDemoOpen(true)} className="flex items-center gap-1.5 hover:text-brand-600" aria-label={`Demo: ${ph.name}. Open the demo panel`} title="Open the demo panel">
        <span className={`h-2 w-2 rounded-full ${ctx.playing ? 'animate-pulse' : ''}`} style={{ background: ph.color }} />
        <b className="font-semibold">{ph.name}</b>
        {(t >= 0 || paused) && <span className="text-ink-3 num">{t >= 0 && `· day ${Math.min(t, FIELD.horizon)}`}{paused && ' · paused'}</span>}
        <ChevronDown size={12} className="text-ink-3" />
      </button>
      <button onClick={ctx.stopDemo} className="grid h-5 w-5 place-items-center rounded-full text-ink-3 hover:bg-canvas hover:text-ink" aria-label="End the demo" title="End the demo">
        <X size={11} />
      </button>
    </div>
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

const same = (a, b) => a.join() === b.join();
const nIN = (x) => x.toLocaleString('en-IN');

// Pencil → number inputs. Enter or ✓ saves, Esc or ✕ cancels. Bounds keep the physics in its valid range.
function ParamEditor({ c, value, onSave, onCancel }) {
  const [v, setV] = useState(value.map(String));
  const nums = v.map(Number);
  const [lo, hi] = c.bounds;
  const err = v.some((x) => x.trim() === '' || !Number.isFinite(+x)) ? 'Enter a number'
    : nums.some((x) => x < lo || x > hi) ? `Must be ${nIN(lo)}–${nIN(hi)}`
    : nums[0] > nums.at(-1) ? 'Low must not exceed high' : null;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!err) onSave(nums); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} // don't close the dialog
    >
      <div className="flex items-center gap-1">
        {v.map((x, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-ink-3">–</span>}
            <input
              autoFocus={i === 0} type="number" step="any" value={x}
              onChange={(e) => setV((p) => p.map((y, j) => (j === i ? e.target.value : y)))}
              aria-label={`${c.label}${v.length > 1 ? (i ? ' high' : ' low') : ''}`}
              className={`w-[4.5rem] rounded border px-1 py-0.5 font-medium outline-none ${err ? 'border-red-400' : 'border-brand-500'}`}
            />
          </React.Fragment>
        ))}
        <button type="submit" disabled={!!err} className="text-brand-600 disabled:text-ink-3" aria-label="Save"><Check size={14} /></button>
        <button type="button" onClick={onCancel} className="text-ink-3 hover:text-ink" aria-label="Cancel"><X size={14} /></button>
      </div>
      {err && <p className="mt-0.5 text-[10px] text-red-600">{err}</p>}
    </form>
  );
}

function AboutData({ ctx, editable, onClose, onStart, onTour }) {
  const [draft, setDraft] = useState(ctx.calib);
  const [editing, setEditing] = useState(null);
  const [review, setReview] = useState(null); // the exit action waiting on Accept / Discard
  const changes = CALIBRATION.filter((c) => !same(draft[c.key], ctx.calib[c.key]));
  const leave = (action) => (changes.length ? setReview(() => action) : action());
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && (review ? setReview(null) : leave(onClose));
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [review, draft, onClose]); // eslint-disable-line react-hooks/exhaustive-deps -- leave only reads draft
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && leave(onClose)}>
      <div role="dialog" aria-modal="true" aria-labelledby="about-title" className="card relative max-h-[90vh] w-full max-w-xl overflow-y-auto p-6 shadow-2xl">
        <button onClick={() => leave(onClose)} className="absolute right-4 top-4 text-ink-3 hover:text-ink" aria-label="Close"><X size={18} /></button>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> SYNTHETIC DATA
        </span>
        <h2 id="about-title" className="mt-3 text-xl font-bold tracking-tight">This is a working physics model, not live field data.</h2>
        <p className="mt-3 text-sm text-ink-2">
          Oil India's Baghewala field does not publish per-well telemetry. Every number here is computed live in your browser by the USHNA physics engine
          (the Marx–Langenheim, Ramey, Walther and Gibbs equations described in our solution) running on synthetic wells calibrated to published Baghewala parameters.
        </p>
        <table className="mt-4 w-full text-left text-xs">
          <thead><tr className="text-ink"><th className="pb-1 font-bold">Calibrated to</th><th className="pb-1 font-bold">Value</th><th className="pb-1 font-bold">Source</th></tr></thead>
          <tbody>
            {CALIBRATION.map((c) => {
              const v = draft[c.key], pending = !same(v, ctx.calib[c.key]), edited = !same(v, c.range);
              return (
                <tr key={c.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-ink-2">{c.label}</td>
                  <td className="py-1.5 pr-2 font-medium">
                    {editing === c.key ? (
                      <ParamEditor c={c} value={v} onSave={(x) => { setDraft((d) => ({ ...d, [c.key]: x })); setEditing(null); }} onCancel={() => setEditing(null)} />
                    ) : (
                      <span className="inline-flex items-start gap-1">
                        <span>
                          {fmtCalib(c, v)}
                          {pending ? <span className="ml-1 text-[10px] font-normal text-amber-700">unsaved</span>
                            : edited && <span className="ml-1 text-[10px] font-normal text-brand-600">edited</span>}
                        </span>
                        {editable && (
                          <button onClick={() => setEditing(c.key)} className="shrink-0 text-ink-3 hover:text-brand-600" aria-label={`Edit ${c.label}`} title="Edit">
                            <Pencil size={12} />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-ink-2">{c.src}</td>
                </tr>
              );
            })}
            {SOURCE_NOTES.map(([k, v, src]) => (
              <tr key={k} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 text-ink-2">{k}</td><td className="py-1.5 pr-2 font-medium">{v}</td><td className="py-1.5 text-ink-2">{src}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          {editable
            ? <span>Values with a <Pencil size={10} className="inline" /> feed the physics model (it uses each range's midpoint).</span>
            : <span>To test the model with different parameters, reopen this dialog from the SYNTHETIC DATA badge and edit these values.</span>}
          {CALIBRATION.some((c) => !same(draft[c.key], c.range)) && (
            <button onClick={() => setDraft(calibDefaults())} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
              <RotateCcw size={11} /> Reset to published values
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <p className="rounded-xl bg-emerald-50 p-3 text-emerald-900"><b>Genuine components:</b> the governing equations, the physical coupling, the solver, the trained machine learning models and the safety logic.</p>
          <p className="rounded-xl bg-amber-50 p-3 text-amber-900"><b>Synthetic components:</b> the six modelled wells (of 35 in the field) and their sensor data streams.</p>
        </div>
        <p className="mt-4 text-sm font-medium">When connected to a live Supervisory Control and Data Acquisition (SCADA) feed, only the data source changes; the model remains the same.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button autoFocus onClick={() => leave(onTour)} className="btn-primary"><Compass size={15} /> Guided Tour (2 min)</button>
          <button onClick={() => leave(onStart)} className="btn-ghost">Explore Independently</button>
        </div>
      </div>
      {review && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="review-title" className="card w-full max-w-md p-5 shadow-2xl">
            <h3 id="review-title" className="text-lg font-bold tracking-tight">Apply calibration changes?</h3>
            <p className="mt-1 text-sm text-ink-2">Accepted values recalibrate the physics model and every page recomputes from them.</p>
            <ul className="mt-3 divide-y divide-line text-sm">
              {changes.map((c) => (
                <li key={c.key} className="py-2">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-ink-2"><s>{fmtCalib(c, ctx.calib[c.key])}</s> → <b className="text-ink">{fmtCalib(c, draft[c.key])}</b></p>
                  {c.range.length > 1 && (
                    <p className="text-xs text-ink-3">model uses {nIN(mid(ctx.calib[c.key]))} → {nIN(mid(draft[c.key]))}{c.unit}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2">
              <button onClick={() => setReview(null)} className="mr-auto text-sm text-ink-2 hover:text-ink">Continue editing</button>
              <button onClick={review} className="btn-ghost">Discard</button>
              <button autoFocus onClick={() => { ctx.acceptCalib(draft); review(); }} className="btn-primary">Accept</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TourPanel({ step, i, n, ctx, onPrev, onNext, onEnd, onClose }) {
  const btn = 'rounded-full px-4 py-1.5 text-sm font-medium';
  return (
    <div role="dialog" aria-label="Guided tour" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg rounded-2xl bg-ink p-4 text-white shadow-2xl sm:p-5">
      <div className="flex items-center gap-2 text-xs text-white/60">
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-200">{step.layer}</span>
        <span className="ml-auto">Step {i + 1} of {n}</span>
        <button onClick={onClose} className="hover:text-white" aria-label="End tour"><X size={16} /></button>
      </div>
      <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
      <p className="mt-1 text-sm text-white/85">{step.text(ctx)}</p>
      {step.more && <p className="mt-2 text-xs text-white/60">{step.more}</p>}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: n }, (_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-brand-500' : 'bg-white/20'}`} />)}
        </div>
        {i > 0 && <button onClick={onPrev} className="rounded-full px-3 py-1.5 text-sm text-white/80 hover:text-white">Back</button>}
        {!step.end && <button onClick={onNext} className={`${btn} bg-white text-ink hover:bg-white/90`}>Next</button>}
      </div>
      {step.end && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button onClick={() => onEnd()} className={`${btn} border border-white/30 text-white hover:bg-white/10`}>Explore Independently</button>
          <button autoFocus onClick={() => onEnd('Traceability')} className={`${btn} bg-white text-ink hover:bg-white/90`}>Open Traceability</button>
        </div>
      )}
    </div>
  );
}

// After the tour: suggested next steps, each one a click away.
function TourTips({ ctx, go, onClose }) {
  const tips = [
    ['Run the cycle and observe viscosity and the Float Margin Index change together', () => { go('Overview'); if (!ctx.playing) ctx.runCycle({ stay: true }); }],
    ['Set SPM to 9 on the Dashboard, apply it, then review the safety envelope log', () => go('Overview')],
    ['Select BGW-11: past its economic cut-off and already limited by the rod float constraint', () => { ctx.selectWell('BGW-11'); go('Overview'); }],
    ['Open Traceability to trace any value back to its governing equation', () => go('Traceability')],
  ];
  return (
    <div role="dialog" aria-label="Suggested next steps" className="card fixed inset-x-3 bottom-3 z-50 mx-auto max-w-lg p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Tour complete. Suggested next steps:</p>
        <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Dismiss"><X size={16} /></button>
      </div>
      <ul className="mt-2 space-y-0.5">
        {tips.map(([text, act]) => (
          <li key={text}>
            <button onClick={act} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-canvas hover:text-ink">
              <ChevronRight size={14} className="shrink-0 text-brand-500" /> {text}
            </button>
          </li>
        ))}
      </ul>
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
