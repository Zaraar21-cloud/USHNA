import React from 'react';
import { EyeOff } from 'lucide-react';
import { PageHeader, Card, Badge } from '../components/ui';
import RecCard from '../components/RecCard';
import { REQUIRED_FIELDS } from '../data/twin';

export default function Recommendations({ ctx }) {
  const hidden = ctx.allRecs.filter((r) => !REQUIRED_FIELDS.every((k) => r[k]));
  return (
    <>
      <PageHeader
        title="Recommendations"
        subtitle="Recommended next actions for this well, with their justification. A recommendation that lacks its governing equation, supporting values or confidence level is never displayed."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {ctx.recs.length === 0 && <Card><p className="text-sm text-ink-2">No action required. {ctx.well.id} is operating within its safety envelope at the current setpoint.</p></Card>}
          {ctx.recs.map((r, i) => <div key={r.id} data-tour={i === 0 ? 'rec' : undefined} className="rounded-2xl"><RecCard rec={r} wellId={ctx.well.id} onApply={ctx.submit} /></div>)}
        </div>
        <div className="space-y-4">
          <Card title="Withheld: Incomplete Justification" icon={EyeOff}>
            {hidden.length === 0 ? <p className="text-sm text-ink-2">None.</p> : hidden.map((r) => (
              <div key={r.id} className="border-b border-line py-3 last:border-0">
                <div className="flex items-center gap-2"><Badge tone="grey">{r.kind}</Badge></div>
                <p className="mt-1.5 text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-xs text-ink-3">Missing: {REQUIRED_FIELDS.filter((k) => !r[k]).join(', ')}. It remains hidden until the inverse dynamometer-card solution identifies a mechanism.</p>
              </div>
            ))}
          </Card>
          <Card title="Explainability Approach">
            <p className="text-sm text-ink-2">Each recommendation states its governing equation and inputs instead of a feature-attribution (SHAP) plot, so an engineer can verify the arithmetic and challenge a specific value. This transparency is what allows a system to earn operator trust and remain in automatic mode.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
