// Run: npm run check — fails loudly if the coupling chain stops behaving physically.
import assert from 'node:assert/strict';
import { WELLS, FIELD, viscosity, simulate, buildState, envelope, recommendations, designSpace, REQUIRED_FIELDS } from './twin.js';

const w = WELLS[0];
assert.ok(viscosity(FIELD.T_R) / viscosity(FIELD.T_s) > 100, 'μ swings ~2 orders between T_R and T_s');

const rows = simulate(w).rows;
for (let p = 1; p < rows.length; p++) assert.ok(rows[p].Tbar <= rows[p - 1].Tbar + 1e-9, `T̄ must not rise (day ${p})`);
assert.ok(rows[60].fmi < rows[10].fmi, 'FMI falls as the heated zone cools');

// (S·N)max ∝ 1/μ: slowing the pump restores float margin
const slow = buildState(w, 41, { spm: 4, down: 0.8 }), fast = buildState(w, 41);
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
console.log('twin checks passed');
