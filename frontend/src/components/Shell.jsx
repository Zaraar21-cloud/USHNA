import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid, Flame, Thermometer, Activity, Brain, Sparkles, SlidersHorizontal, CalendarClock,
  Radio, GitBranch, ChevronDown, ChevronRight, HelpCircle, Bell, Menu, X, Wifi,
} from 'lucide-react';
import { Avatar, Badge } from './ui';
import { FIELD, WELLS } from '../data/twin';

const NAV = [
  { id: 'Overview', label: 'Dashboard', icon: LayoutGrid },
  { group: 'Well twin', icon: Flame, items: [
    { id: 'Reservoir', label: 'Reservoir & CSS' },
    { id: 'Wellbore', label: 'Wellbore' },
    { id: 'RodString', label: 'Rod string & SRP' },
  ] },
  { id: 'Learning', label: 'Learning layer', icon: Brain, badge: 'NEW' },
  { group: 'Optimization', icon: Sparkles, items: [
    { id: 'Recommendations', label: 'Recommendations' },
    { id: 'SrpControl', label: 'SRP control & safety' },
    { id: 'CssDesign', label: 'CSS design & cut-off' },
  ] },
  { id: 'Telemetry', label: 'Edge telemetry', icon: Radio },
  { id: 'Traceability', label: 'Traceability', icon: GitBranch },
];

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

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top navigation ── */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white px-4 lg:px-6">
        <button className="lg:hidden p-2 -ml-2" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
          <Menu size={20} />
        </button>
        <button onClick={() => go('Overview')} className="text-[22px] font-extrabold tracking-tight">
          ushna<span className="text-brand-500">.</span>
        </button>

        <Popover
          button={({ toggle, open }) => (
            <button onClick={toggle} aria-expanded={open} className="ml-2 flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-sm font-medium hover:bg-canvas">
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
                    <span className="ml-auto text-xs text-ink-3 num">Cycle {st.well.cycle} · day {st.day}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>

        {/* Cycle progress (scrubbable) */}
        <div className="hidden md:flex flex-1 justify-center">
          <Popover
            width="w-80"
            button={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} className="flex items-center gap-3 rounded-full px-3 py-1.5 hover:bg-canvas">
                <span className="text-sm">
                  <span className="text-ink-2">Cycle {well.cycle} · </span>
                  <span className="font-semibold num">day {day}</span>
                  <span className="text-ink-2"> of production · cut-off ≈ {s.cut.day}</span>
                </span>
                <span className="h-1.5 w-24 rounded-full bg-[#F1F1F5]">
                  <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${progress * 100}%` }} />
                </span>
                <span className="text-sm font-semibold num">{Math.round(progress * 100)}%</span>
                <ChevronDown size={14} className="text-ink-3" />
              </button>
            )}
          >
            {() => (
              <div className="p-1">
                <p className="text-sm font-semibold">Scrub the production cycle</p>
                <p className="mt-1 text-xs text-ink-2">Every page recomputes from the physics chain as the heated zone cools.</p>
                <input
                  type="range" min={0} max={FIELD.horizon} value={day}
                  onChange={(e) => ctx.setDay(+e.target.value)}
                  className="mt-4 w-full accent-brand-500" aria-label="Production day"
                />
                <div className="mt-1 flex justify-between text-xs text-ink-3 num"><span>day 0</span><span>day {FIELD.horizon}</span></div>
                <button onClick={ctx.resetDay} className="mt-3 text-xs font-medium text-brand-600 hover:underline">Back to live (day {well.day})</button>
              </div>
            )}
          </Popover>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button onClick={() => go('Traceability')} className="p-2 text-ink-2 hover:text-ink" aria-label="How this twin works">
            <HelpCircle size={19} />
          </button>
          <Popover
            align="right" width="w-80"
            button={({ toggle, open }) => (
              <button onClick={toggle} aria-expanded={open} className="relative p-2 text-ink-2 hover:text-ink" aria-label={`${alerts.length} alerts`}>
                <Bell size={19} />
                {alerts.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-viz-pink" />}
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
                        <span className="text-ink-2">{a.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Popover>
          <span className="hidden xl:flex items-center gap-1.5 px-2 text-sm text-ink-2">
            <Wifi size={15} className="text-emerald-600" /> Edge twin online
          </span>
          <button onClick={() => go('Recommendations')} className="btn-primary hidden sm:inline-flex">
            Recommendations <span className="rounded-full bg-white/20 px-1.5 text-xs num">{recs.length}</span>
          </button>
          <Avatar text="FE" color="#F5C542" size={32} />
        </div>
      </header>

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
          <p className="px-5 py-4 text-[11px] text-ink-3">twin: cd1aa14 · synthetic data</p>
        </aside>

        <main className="min-w-0 flex-1 bg-white">
          <div className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</div>
          <footer className="border-t border-line px-4 py-5 text-center text-[11px] text-ink-3 lg:px-8">
            Prototype for SIH PS 26120 (Oil India Limited). All values come from the USHNA physics model running on synthetic data and are not operational advice.
            Every setpoint shown traces to a governing equation — see <button onClick={() => go('Traceability')} className="underline">Traceability</button>.
          </footer>
        </main>
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
