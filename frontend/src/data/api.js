// Client for the FastAPI edge service (api/main.py). Used only when the viewer switches
// the data source to "API"; the local twin (twin.js) stays the default so a static
// deploy with no backend keeps working.
// Same origin when served by the edge container; localhost:8000 under `npm run dev`.
export const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '');

async function call(path, init) {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Full twin state, same shape as buildState() in twin.js.
export function fetchState(wellId, day, sp) {
  const q = new URLSearchParams({ day });
  if (sp) { q.set('spm', sp.spm); q.set('down', sp.down); }
  return call(`/state/${wellId}/full?${q}`);
}

// Runs the server-side safety envelope; resolves to { applied, binding }.
export async function submitSetpoint(wellId, day, req) {
  const r = await call(`/submit/${wellId}?day=${day}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
  });
  return { applied: r.applied, binding: r.binding };
}
