// Run: npm run check — fails loudly if the coupling chain stops behaving physically.
import assert from 'node:assert/strict';
import { WELLS, FIELD, viscosity, simulate, buildState, envelope, recommendations, designSpace, REQUIRED_FIELDS, applyCalibration, calibDefaults } from './twin.js';

const w = WELLS[0];
assert.ok(viscosity(FIELD.T_R) / viscosity(FIELD.T_s) > 100, 'μ swings ~2 orders between T_R and T_s');
assert.ok(viscosity(50) > 10000 && viscosity(50) < 13000, 'μ(50 °C) inside Oil India published 10,000–13,000 cP');

const rows = simulate(w).rows;
for (let p = 1; p < rows.length; p++) assert.ok(rows[p].Tbar <= rows[p - 1].Tbar + 1e-9, `T̄ must not rise (day ${p})`);
assert.ok(rows[60].fmi < rows[10].fmi, 'FMI falls as the heated zone cools');

// (S·N)max ∝ 1/μ: slowing the pump restores float margin
const slow = buildState(w, 41, { spm: 4, down: 0.8 }), fast = buildState(w, 41);
assert.ok(fast.fmiMin.fmi > FIELD.fmiLimit, 'BGW-07 baseline SPM is feasible at day 41, not already floating');
assert.ok(slow.fmiMin.fmi > fast.fmiMin.fmi, 'lower SPM raises FMI');

// Producing faster spends the thermal asset (δ coupling)
assert.ok(simulate(w, { setpoint: { spm: 8, down: 1 } }).rows[60].Tbar < simulate(w, { setpoint: { spm: 4, down: 1 } }).rows[60].Tbar, 'faster pumping cools faster');

// Safety envelope clamps an unsafe request to a setpoint that satisfies FMI
const env = envelope(w, 41, { spm: 9, down: 1 });
assert.equal(env.binding, 'FMI(z) > 0.15');
assert.ok(env.applied.spm < 9 && buildState(w, 41, env.applied).fmiMin.fmi > FIELD.fmiLimit);

// Explainability contract: the incomplete classifier card is filtered out
const recs = recommendations(buildState(w, 41), designSpace(w));
assert.ok(recs.some((r) => !REQUIRED_FIELDS.every((k) => r[k])), 'fixture: one incomplete card exists');
for (const r of recs.filter((r) => REQUIRED_FIELDS.every((k) => r[k]))) assert.ok(!/NaN|undefined|Infinity/.test(Object.values(r).join(' ')), r.id);

const s = buildState(w, 41);
assert.ok(s.cut.day > 41 && s.cut.day < FIELD.horizon, 'cut-off is an interior crossing');

// Edited calibration drives the physics; reset restores the baseline exactly
const base = { mu: viscosity(50), fmi: s.fmiMin.fmi };
applyCalibration({ ...calibDefaults(), mu50: [14000, 16000], pumpDepth: [1300] });
assert.ok(Math.abs(viscosity(50) - 15000) < 1, 'μ(50 °C) follows the edited anchor');
assert.ok(buildState(w, 41).fmiMin.fmi < base.fmi, 'thicker oil, deeper pump → less float margin');
for (const c of [{ api: [10, 10], T_R: [80, 80], pumpDepth: [600] }, { api: [25, 25], T_R: [30, 30], mu50: [1000, 1000], pumpDepth: [1600] }]) {
  applyCalibration({ ...calibDefaults(), ...c });
  const e = buildState(w, 41);
  assert.ok(Number.isFinite(e.fmiMin.fmi) && Number.isFinite(e.cut.day) && Number.isFinite(e.npv), `finite at bounds ${JSON.stringify(c)}`);
}
applyCalibration(calibDefaults());
assert.ok(Math.abs(viscosity(50) - base.mu) < 1e-6 && buildState(w, 41).fmiMin.fmi === base.fmi, 'reset restores baseline');
console.log('twin checks passed');
