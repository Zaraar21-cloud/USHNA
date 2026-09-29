import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Tex } from './ui';

const ROWS = [
  ['why', 'Rationale'],
  ['driver', 'Primary driver'],
  ['relation', 'Governing relation'],
  ['effect', 'Expected effect'],
  ['confidence', 'Confidence'],
  ['cycle', 'Cycle status'],
];
const PRIORITY = { high: 'crit', medium: 'warn', low: 'grey' };

// Section 9 explainability card. Rendering is gated upstream on REQUIRED_FIELDS.
export default function RecCard({ rec, wellId, onApply }) {
  const [result, setResult] = useState(null);
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Recommendation · Well {wellId} · {time}</span>
        <Badge tone="info">{rec.kind}</Badge>
        <Badge tone={PRIORITY[rec.priority]}>{rec.priority[0].toUpperCase() + rec.priority.slice(1)} priority</Badge>
      </header>
      <div className="px-5 py-4">
        <h3 className="text-[17px] font-semibold">{rec.title}</h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-[150px_1fr]">
          {ROWS.map(([k, label]) => (
            <React.Fragment key={k}>
              <dt className="pt-2.5 text-[13px] font-medium text-brand-700">{label}</dt>
              <dd className={`border-b border-line py-2.5 text-sm text-ink last:border-0 sm:border-b ${k === 'relation' ? 'overflow-x-auto' : ''}`}>{k === 'relation' ? <Tex>{String.raw`\displaystyle ` + rec[k]}</Tex> : rec[k]}</dd>
            </React.Fragment>
          ))}
        </dl>
        {rec.action && onApply && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={() => setResult(onApply(rec.action))} className="btn-primary">
              Submit via Safety Envelope
            </button>
            {result && (
              <span className="flex items-center gap-1.5 text-sm text-ink-2">
                <Check size={15} className="text-emerald-600" />
                {result.binding
                  ? `Limited to SPM ${result.applied.spm.toFixed(1)}; binding constraint: ${result.binding}`
                  : `Applied SPM ${result.applied.spm.toFixed(1)}, downstroke ${Math.round(result.applied.down * 100)}%`}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
