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
        subtitle="What the twin says to do next on this well, and why. A card missing its equation, numbers or confidence is never shown."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {ctx.recs.length === 0 && <Card><p className="text-sm text-ink-2">No action needed. {ctx.well.id} is inside its envelope at the current setpoint.</p></Card>}
          {ctx.recs.map((r, i) => <div key={r.id} data-tour={i === 0 ? 'rec' : undefined} className="rounded-2xl"><RecCard rec={r} wellId={ctx.well.id} onApply={ctx.submit} /></div>)}
        </div>
        <div className="space-y-4">
          <Card title="Suppressed by the contract" icon={EyeOff}>
            {hidden.length === 0 ? <p className="text-sm text-ink-2">None.</p> : hidden.map((r) => (
              <div key={r.id} className="border-b border-line py-3 last:border-0">
                <div className="flex items-center gap-2"><Badge tone="grey">{r.kind}</Badge></div>
                <p className="mt-1.5 text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-xs text-ink-3">Missing: {REQUIRED_FIELDS.filter((k) => !r[k]).join(', ')}. It stays hidden until the inverse card solve supplies a mechanism.</p>
              </div>
            ))}
          </Card>
          <Card title="Why no SHAP plots">
            <p className="text-sm text-ink-2">An engineer can check the arithmetic on each card, disagree with a specific number, and say which one. That is how a system earns trust and stays switched on in automatic mode.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
