// Run: npm run check — the Model Test tab against the live twin.
import assert from 'node:assert/strict';
import { WELLS, FIELD, WALTHER, designSpace, buildState } from './twin.js';
import { studio, studioDefaults, PRESETS, BOUNDS } from './studio.js';

const field = JSON.stringify(FIELD), walther = JSON.stringify(WALTHER);
const d = studioDefaults();
assert.ok(Math.abs(d.mu - 14435) < 1, 'default μ is the Walther curve at 47 °C');

for (const w of WELLS) {
  const base = studio(w, d);
  const app = designSpace(w).best;
  assert.deepEqual([base.design.steam, base.design.soak, base.design.cutDay], [app.steam, app.soak, app.cutDay], `${w.id}: untouched inputs reproduce the Cycle design tab`);

  const thick = studio(w, { ...d, mu: 20000 });
  assert.ok(Math.abs(thick.muRes - 20000) < 1e-6, `${w.id}: refit Walther passes through the viewer's μ`);

  const gas = studio(w, { ...d, ...PRESETS['Low Steam Cost Scenario'] });
  assert.ok(gas.design.steam > base.design.steam && gas.design.oil > base.design.oil && gas.design.sor > base.design.sor,
    `${w.id}: cheap steam buys more steam and oil at a higher SOR`);

  for (const boiler of [1500, 2600, 3000, 7000]) assert.ok(studio(w, { ...d, boiler }).design.steam <= boiler, `${w.id}: boiler ${boiler} t caps the optimum`);

  // Every corner of the input bounds gives a finite, producing answer.
  const keys = Object.keys(BOUNDS);
  for (let m = 0; m < 2 ** keys.length; m++) {
    const inp = { ...d };
    keys.forEach((k, i) => { inp[k] = BOUNDS[k][(m >> i) & 1]; });
    const r = studio(w, inp), x = r.design;
    const vals = [r.muRes, x.steam, x.cutDay, x.oil, x.sor, x.npv, x.spmMax, x.fmiMin, x.rh, ...x.mu, ...r.curve.flatMap((c) => [c.mu, c.sor])];
    assert.ok(vals.every(Number.isFinite) && x.oil > 0, `${w.id}: finite at ${JSON.stringify(inp)}`);
  }
}
assert.equal(studio(WELLS[0], { ...d, boiler: 7000 }).designs, 23 * 9, 'a bigger boiler extends the steam grid in 250 t steps');

// The exact linear FMI solve agrees with the dashboard's own state at day 41.
const w = WELLS[0], cur = studio(w, d).current;
assert.ok(Math.abs(cur.fmiMin - buildState(w, 41).fmiMin.fmi) < 1e-9, 'min FMI matches buildState at the well\'s SPM');
assert.equal(cur.spmMax > w.spm, cur.fmiMin > FIELD.fmiLimit, 'max safe SPM sits on the right side of today\'s SPM');

assert.equal(JSON.stringify(FIELD), field, 'sandbox leaves FIELD untouched');
assert.equal(JSON.stringify(WALTHER), walther, 'sandbox leaves WALTHER untouched');
console.log('studio checks passed');
