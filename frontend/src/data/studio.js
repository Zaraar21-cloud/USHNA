// Model Test (Learning Layers → "Model Test"): the CSS design search re-run on a well whose
// crude, reservoir temperature, boiler and economics the viewer sets. A test environment: nothing here
// persists, reaches the audit log, or leaves FIELD / WALTHER changed.
import { FIELD, WALTHER, viscosity, simulate, cutoff, cycleNpv, designSpace, tubingProfile, fmiProfile, designSteams, DESIGN_SOAKS } from './twin.js';

export const MID_DAY = 41; // mid-cycle check day for pump viscosity and max safe SPM

// What the physics accepts, not a typical range. μ and T_R match the calibration editor's bounds;
// the boiler floor is the smallest steam volume on the design grid.
export const BOUNDS = {
  mu: [1000, 100000],     // cP at reservoir temperature
  T_R: [30, 80],          // °C
  boiler: [1500, 10000],  // t
  oilPrice: [500, 20000], // ₹/bbl
  steamCost: [100, 10000], // ₹/t
};

// Read at call time: the field calibration (About this data) moves T_R and the Walther fit.
export const studioDefaults = () => ({
  mu: viscosity(FIELD.T_R), T_R: FIELD.T_R, boiler: designSteams().at(-1), oilPrice: FIELD.oilPrice, steamCost: FIELD.steamCost,
});

export const PRESETS = {
  'Heavier Crude Scenario': { mu: 20000 },
  'Low Steam Cost Scenario': { steamCost: 1200 },
};

// Shift the Walther curve (B held) so it passes through the viewer's μ at reservoir temperature.
export function refitWalther(mu, T_R) {
  const nu = mu / FIELD.rho; // cP → cSt
  return { A: Math.log10(Math.log10(nu + 0.7)) + WALTHER.B * Math.log10(T_R + 273.15), B: WALTHER.B };
}

// ponytail: swaps FIELD for one synchronous run and restores it; thread a field object through twin.js if runs ever go async
function withField(over, fn) {
  const saved = { ...FIELD };
  Object.assign(FIELD, over);
  try { return fn(); } finally { Object.assign(FIELD, saved); }
}

// One CSS design, scored the way designSpace scores it, plus the oil and rod-float view.
function evaluate(w, steam, soak) {
  const { rows, rh } = simulate(w, { withFmi: false, design: { steam, soak } });
  const cutDay = cutoff(rows, steam).day;
  const oil = rows[cutDay].cumOil;
  // FMI is linear in rod speed at every depth: FMI(z) = still(z) − SPM·slope(z). So FMI = limit solves
  // exactly for S·N (stroke fixed → SPM), and the well's own SPM gives the day's minimum over depth.
  const r = rows[MID_DAY];
  const prof = tubingProfile(r.Tpump, r.gross, w.walther);
  const still = fmiProfile(prof, 0).map((z) => z.fmi);
  const slope = fmiProfile(prof, 1).map((z, i) => still[i] - z.fmi);
  return {
    steam, soak, cutDay, reinject: cutDay + FIELD.tInj + soak, rh,
    mu: rows.map((x) => x.mu), oil, sor: (steam * 6.29) / oil, npv: cycleNpv(rows, steam, cutDay),
    spmMax: Math.min(...still.map((s, i) => (s - FIELD.fmiLimit) / slope[i])),
    fmiMin: Math.min(...still.map((s, i) => s - w.spm * slope[i])),
  };
}

export function studio(well, inp) {
  return withField({ T_R: inp.T_R, oilPrice: inp.oilPrice, steamCost: inp.steamCost }, () => {
    const w = { ...well, walther: refitWalther(inp.mu, inp.T_R) };
    const t0 = performance.now();
    const space = designSpace(w, { maxSteam: inp.boiler });
    const ms = performance.now() - t0;
    const { best } = space;
    // Diminishing returns: every steam volume on the grid at the optimum's soak.
    const curve = space.steams.map((steam) => ({
      steam,
      mu: simulate(w, { withFmi: false, design: { steam, soak: best.soak } }).rows[MID_DAY].mu,
      sor: space.grid.find((g) => g.steam === steam && g.soak === best.soak).sor,
    }));
    return {
      muRes: viscosity(inp.T_R, w.walther),
      design: evaluate(w, best.steam, best.soak),
      current: evaluate(w, well.steam, well.soak),
      curve, designs: space.grid.length, ms,
    };
  });
}

// Grid size for a boiler cap, for the "searching N designs…" line before the search runs.
export const designCount = (boiler) => designSteams(boiler).length * DESIGN_SOAKS.length;
