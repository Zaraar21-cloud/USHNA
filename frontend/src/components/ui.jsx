import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export const VIZ = { pink: '#F2549B', green: '#3FB16B', lightGreen: '#7BD88F', orange: '#F59E42', yellow: '#F5C542', blue: '#6C9BF5', purple: '#7B4DFF', grey: '#C9C9D3' };
export const AXIS = { tickLine: false, axisLine: { stroke: '#E9E9EF' } };
export const GRID = { stroke: '#F0F0F4', vertical: false };

export const fmt = {
  n0: (x) => Math.round(x).toLocaleString('en-IN'),
  n1: (x) => x.toFixed(1),
  n2: (x) => x.toFixed(2),
  lakh: (x) => `₹${(x / 1e5).toFixed(1)} L`,
  pct: (x) => `${Math.round(x * 100)}%`,
};

export function PageHeader({ title, subtitle, tabs, tab, onTab, right }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-2 max-w-3xl">{subtitle}</p>}
        </div>
        {right}
      </div>
      {tabs && (
        <div role="tablist" className="mt-5 flex gap-6 border-b border-line overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
              className={`-mb-px whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${
                tab === t ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Card({ title, icon: Icon, right, children, className = '', pad = 'p-5' }) {
  return (
    <section className={`card ${pad} ${className}`}>
      {(title || right) && (
        <header className={`flex items-center justify-between gap-3 ${pad === 'p-0' ? 'px-5 py-4' : 'mb-4'}`}>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {Icon && <Icon size={16} className="text-ink-3" />}
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

// Quick-stats list row (icon · label · value)
export function StatRow({ icon: Icon, label, value, unit, tone }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-line last:border-0">
      <span className="flex items-center gap-2.5 label">
        {Icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-canvas border border-line">
            <Icon size={14} className="text-ink-2" />
          </span>
        )}
        {label}
      </span>
      <span className={`num text-sm font-semibold ${tone ? TONE_TEXT[tone] : ''}`}>
        {value}
        {unit && <span className="ml-1 font-normal text-ink-3">{unit}</span>}
      </span>
    </div>
  );
}

const TONE_TEXT = { ok: 'text-emerald-600', warn: 'text-amber-600', crit: 'text-red-600' };
const TONE_BADGE = {
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  crit: 'bg-red-50 text-red-700',
  info: 'bg-brand-50 text-brand-700',
  grey: 'bg-canvas text-ink-2 border border-line',
};
export const toneOf = (value, limit, warnBand = 0.05) => (value <= limit ? 'crit' : value <= limit + warnBand ? 'warn' : 'ok');

export function Badge({ tone = 'grey', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[tone]} ${className}`}>{children}</span>;
}

export function Status({ tone, children }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : XCircle;
  return (
    <Badge tone={tone}>
      <Icon size={12} aria-hidden /> {children}
    </Badge>
  );
}

export function Bar({ value, color = VIZ.pink, max = 1, marker }) {
  return (
    <div className="relative h-2 w-full rounded-full bg-[#F1F1F5]">
      <div className="h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }} />
      {marker != null && <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${(marker / max) * 100}%` }} />}
    </div>
  );
}

export function Avatar({ text, color, size = 28 }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-ink" style={{ width: size, height: size, background: color }}>
      {text}
    </span>
  );
}

export function Eq({ children, note }) {
  return (
    <div className="rounded-xl bg-canvas border border-line px-4 py-3">
      <div className="eq">{children}</div>
      {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
    </div>
  );
}

export function Toggle({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-full border border-line p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={`rounded-full px-3 py-1 transition-colors ${value === o ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map(([label, color, dashed]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: dashed ? 'none' : color, borderTop: dashed ? `2px dashed ${color}` : 'none' }} />
          {label}
        </span>
      ))}
    </div>
  );
}
