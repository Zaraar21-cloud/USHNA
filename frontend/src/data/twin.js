// ============================================================================
// USHNA browser twin
// Closed-form versions of src/physics/* so the UI recomputes the whole coupling
// chain (T̄ → T_pump → μ(T_pump) → FMI → SPM) on every interaction.
// Synthetic, calibrated to published Baghewala / Rajasthan heavy-oil ranges.
// ============================================================================

export const FIELD = {
  field: 'Baghewala Heavy Oil Field',
  operator: 'Oil India Limited',
  formation: 'Jodhpur Sandstone',
  api: '17–19° API',
  T_R: 47, T_s: 250, T_surf: 30, gradGeo: 0.019, // °C, °C/m
  pay: 20, rw: 0.1, re: 60,                       // m
  pumpDepth: 900, stroke: 3.0,                    // m
  tInj: 8, tSoak: 5, horizon: 120,                // days
  T_onset: 58,                                    // °C asphaltene onset
  fmiLimit: 0.15, fillageLimit: 0.85, torqueRating: 51.5, // kN·m (API 456 gearbox)
  oilPrice: 6300, steamCost: 4200, powerCost: 8, opex: 16000, failCost: 1.2e6, // ₹
  rho: 0.95,
};

// Rod string: tapered 1" over 7/8" with sinker bars (API 11L style weights, N/m).
export const ROD = {
  sections: [
    { name: '1" steel', from: 0, to: 620, d: 0.0254, w: 40.9 },
    { name: '7/8" steel', from: 620, to: 840, d: 0.0222, w: 31.4 },
    { name: '1½" sinker', from: 840, to: 900, d: 0.0381, w: 90.0 },
  ],
  tubingID: 0.062, buoy: 0.88, coupling: 4.7, fric: 2.5, plunger: 250, plungerIn: 1.25,
};

const log10 = Math.log10;

// ── Viscosity: ASTM D341 / Walther, fitted to ν(47 °C)=2600 cSt, ν(250 °C)=14 cSt ──
export const WALTHER = { A: 6.0101, B: 2.1860 };
export function viscosity(tC) {
  const ll = WALTHER.A - WALTHER.B * log10(tC + 273.15);
  return (10 ** (10 ** ll) - 0.7) * FIELD.rho; // cP
}

// ── Marx–Langenheim heated radius ──
function erfcx(x) { // exp(x²)·erfc(x), x ≥ 0 (A&S 7.1.26)
  const t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
}
export function heatedRadius(steamT, day = FIELD.tInj, tInj = FIELD.tInj) {
  const MR = 2.5e6, kob = 1.7, aob = 8e-7, dT = FIELD.T_s - FIELD.T_R, h = FIELD.pay;
  const Q = (steamT * 1e3 * 2.33e6) / (tInj * 86400); // W, wet steam enthalpy above 30 °C
  const t = Math.max(day, 1e-3) * 86400;
  const tD = (4 * kob * kob * t) / (MR * MR * h * h * aob);
  const G = erfcx(Math.sqrt(tD)) + 2 * Math.sqrt(tD / Math.PI) - 1;
  const A = (Q * MR * h * aob * G) / (4 * kob * kob * dT);
  return Math.sqrt(A / Math.PI);
}

// ── Ramey: tubing fluid temperature above the pump ──
const DZ = 20;
export function tubingProfile(Tpump, gross) {
  const L = FIELD.pumpDepth, Ar = 900 + 6 * gross; // relaxation distance grows with rate
  const Tg = (z) => FIELD.T_surf + FIELD.gradGeo * z;
  const out = [];
  for (let z = 0; z <= L; z += DZ) {
    const e = Math.exp(-(L - z) / Ar);
    const T = Tg(z) + FIELD.gradGeo * Ar * (1 - e) + (Tpump - Tg(L)) * e;
    out.push({ z, T, Tgeo: Tg(z), mu: viscosity(T) });
  }
  return out;
}

const sectionAt = (z) => ROD.sections.find((s) => z < s.to) || ROD.sections.at(-1);
export const rodVelocity = (spm, down = 1) => (Math.PI * FIELD.stroke * spm / 60) * down; // peak downstroke, m/s

// ── Float Margin Index along the string (segment below z must fall against its own drag) ──
export function fmiProfile(profile, spm, down = 1) {
  const v = rodVelocity(spm, down);
  const out = new Array(profile.length);
  let W = 0, F = ROD.plunger * (profile.at(-1).mu / 1000) * v;
  for (let i = profile.length - 1; i >= 0; i--) {
    const { z, mu } = profile[i];
    const s = sectionAt(z);
    W += s.w * ROD.buoy * DZ;
    const fDrag = (ROD.coupling * 2 * Math.PI * (mu / 1000) * v) / Math.log(ROD.tubingID / Math.min(s.d, 0.05));
    F += (fDrag + ROD.fric) * DZ;
    out[i] = { z, fmi: (W - F) / W, W, F };
  }
  return out;
}
const minBy = (arr, k) => arr.reduce((m, r) => (r[k] < m[k] ? r : m));

// ── Surface loads, torque, power, Goodman ──
export function loads(fmiRows, spm, down, gross) {
  const top = fmiRows[0];
  const u = 1 / (2 - 1 / down); // upstroke speed-up that keeps the period
  const S_in = FIELD.stroke * 39.37;
  const accUp = (S_in * (spm * u) ** 2) / 70500, accDn = (S_in * (spm * down) ** 2) / 70500;
  const Wf = FIELD.rho * 1000 * 9.81 * FIELD.pumpDepth * Math.PI * (ROD.plungerIn * 0.0254) ** 2 / 4;
  const dragUp = top.F * u / Math.max(down, 1e-6) * 0.6;
  const PPRL = top.W * (1 + accUp) + Wf + dragUp;
  const MPRL = top.W * (1 - accDn) - top.F;
  const torque = ((PPRL - MPRL) / 2 * FIELD.stroke / 2) / 1000; // kN·m, counterbalance at optimum
  const area = Math.PI * 0.0254 ** 2 / 4;
  const sMax = PPRL / area / 1e6, sMin = MPRL / area / 1e6; // MPa
  const SA = (793 / 4 + 0.5625 * sMin) * 0.9; // modified Goodman, grade D
  const goodman = (sMax - sMin) / (SA - sMin);
  const hyd = (gross * 1.84e-6) * FIELD.rho * 1000 * 9.81 * FIELD.pumpDepth; // W
  const powerKW = (hyd + top.F * rodVelocity(spm, down) * 0.5) / 0.55 / 1000;
  return { PPRL, MPRL, torque, sMax, sMin, SA, goodman, powerKW, dragDown: top.F, Wf, accUp, accDn };
}

// ── Pump ──
export const displacement = (spm) => 0.1166 * FIELD.stroke * 39.37 * ROD.plungerIn ** 2 * spm; // bbl/d
const waterCut = (p) => 0.3 + 0.25 * Math.exp(-p / 8);

// ── Wells ──
export const WELLS = [
  { id: 'BGW-07', cycle: 4, day: 41, kh: 1.0, skin: 3.4, heatLoss: 1.0, steam: 2600, soak: 5, spm: 6.2, hue: '#7BD88F' },
  { id: 'BGW-04', cycle: 6, day: 12, kh: 1.15, skin: 2.1, heatLoss: 0.9, steam: 3000, soak: 6, spm: 6.8, hue: '#F5C542' },
  { id: 'BGW-11', cycle: 3, day: 63, kh: 0.85, skin: 4.2, heatLoss: 1.1, steam: 2400, soak: 5, spm: 5.4, hue: '#F59E42' },
  { id: 'BGW-02', cycle: 5, day: 27, kh: 1.05, skin: 2.8, heatLoss: 1.0, steam: 2800, soak: 4, spm: 6.5, hue: '#8AB4F8' },
  { id: 'BGW-15', cycle: 2, day: 49, kh: 0.95, skin: 3.0, heatLoss: 1.2, steam: 2500, soak: 5, spm: 5.0, hue: '#F2549B' },
  { id: 'BGW-09', cycle: 4, day: 5, kh: 1.1, skin: 2.5, heatLoss: 0.95, steam: 2700, soak: 6, spm: 6.0, hue: '#B39DFB' },
];

// ── Cycle simulation: Boberg–Lantz decline + radial composite inflow + δ coupling ──
const ALPHA_EFF = 0.9; // m²/day effective (conduction + convection), scaled by EnKF heat-loss coefficient
const J = 1.05e6;      // productivity constant (bbl/d · cP)
const K_DELTA = 1.4e-4; // fraction of heated-zone energy removed per bbl of hot fluid

export function simulate(well, { setpoint, fromDay = 0, withFmi = true, design } = {}) {
  const steam = design?.steam ?? well.steam, soak = design?.soak ?? well.soak;
  const eta = 1 - Math.exp(-soak / 2.5);                 // soak redistribution efficiency
  const rh = heatedRadius(steam) * (0.75 + 0.25 * eta);
  const soakLoss = 0.012 * soak;                         // conduction during shut-in
  const muC = viscosity(FIELD.T_R);
  const rows = [];
  let delta = soakLoss, cumOil = 0, cumGross = 0;
  for (let p = 0; p <= FIELD.horizon; p++) {
    const sp = p < fromDay || !setpoint ? { spm: well.spm, down: 1 } : setpoint;
    const t = p + soak;
    const tDr = (ALPHA_EFF * well.heatLoss * t) / (rh * rh);
    const tDv = (4 * ALPHA_EFF * well.heatLoss * t) / (FIELD.pay * FIELD.pay);
    const fHD = 1 / (1 + 5 * tDr), fVD = 1 / Math.sqrt(1 + 5 * tDv);
    const Tbar = FIELD.T_R + (FIELD.T_s - FIELD.T_R) * fHD * fVD * Math.max(0, 1 - delta);
    const Tpump = FIELD.T_R + (Tbar - FIELD.T_R) * 0.9;
    const muH = viscosity(Tbar), mu = viscosity(Tpump);
    const inflow = (J * well.kh) / (muH * (Math.log(rh / FIELD.rw) + well.skin) + muC * Math.log(FIELD.re / rh));
    const disp = displacement(sp.spm);
    const gross = Math.min(inflow, disp * 0.97);
    const fillage = Math.min(1, inflow / disp);
    const oil = gross * (1 - waterCut(p));
    cumOil += oil; cumGross += gross;
    const row = { p, Tbar, Tpump, muH, mu, inflow, gross, oil, fillage, cumOil, delta, rh, spm: sp.spm, down: sp.down, waterCut: waterCut(p) };
    if (withFmi) {
      const prof = tubingProfile(Tpump, gross);
      const fmiRows = fmiProfile(prof, sp.spm, sp.down);
      const m = minBy(fmiRows, 'fmi');
      const L = loads(fmiRows, sp.spm, sp.down, gross);
      row.fmi = m.fmi; row.fmiDepth = m.z; row.torque = L.torque; row.powerKW = L.powerKW; row.goodman = L.goodman;
    } else {
      row.powerKW = 2 + gross * 0.035;
    }
    const risk = withFmi ? 0.004 * Math.exp(-(row.fmi - FIELD.fmiLimit) / 0.05) + (fillage < FIELD.fillageLimit ? 0.002 : 0) : 0.002;
    row.risk = Math.min(risk, 0.05);
    row.profit = oil * FIELD.oilPrice - row.powerKW * 24 * FIELD.powerCost - FIELD.opex - row.risk * FIELD.failCost;
    rows.push(row);
    delta = Math.min(0.97, delta + K_DELTA * gross * ((Tbar - FIELD.T_R) / (FIELD.T_s - FIELD.T_R)) + 0.002);
  }
  return { rows, rh, steam, soak };
}

// ── Optimal stopping: stop when π(t) ≤ π̄* (renewal–reward) ──
export function cutoff(rows, steam) {
  const C0 = steam * FIELD.steamCost + (FIELD.tInj + 5) * FIELD.opex;
  let cum = -C0, best = -Infinity, rate = 0;
  rows.forEach((r, i) => {
    cum += r.profit;
    rate = cum / (i + 1 + FIELD.tInj + 5);
    if (rate > best) best = rate;
  });
  const peak = rows.reduce((m, r, i) => (r.profit > rows[m].profit ? i : m), 0);
  const hit = rows.find((r, i) => i > peak && r.profit <= best);
  return { piStar: best, day: hit ? hit.p : FIELD.horizon, rateToHorizon: rate };
}

export function cycleNpv(rows, steam, stopDay) {
  const r = 0.12 / 365;
  let npv = -steam * FIELD.steamCost - (FIELD.tInj + 5) * FIELD.opex;
  for (const row of rows) { if (row.p > stopDay) break; npv += row.profit / (1 + r) ** (row.p + 13); }
  return npv;
}

// ── MPC stand-in: grid search over (SPM, downstroke factor) at the Ramey-lag horizon ──
export function mpc(well, day, { horizon = 2 } = {}) {
  const base = simulate(well, { withFmi: false }).rows;
  const r = base[Math.min(day + horizon, FIELD.horizon)];
  const prof = tubingProfile(r.Tpump, r.gross);
  let best = null;
  for (let spm = 3; spm <= 8.001; spm += 0.1) {
    for (let down = 0.7; down <= 1.001; down += 0.05) {
      const disp = displacement(spm);
      const gross = Math.min(r.inflow, disp * 0.97);
      const fill = Math.min(1, r.inflow / disp);
      const fr = fmiProfile(prof, spm, down);
      const m = minBy(fr, 'fmi');
      const L = loads(fr, spm, down, gross);
      const feasible = m.fmi > FIELD.fmiLimit && fill >= FIELD.fillageLimit && L.torque <= FIELD.torqueRating && L.goodman <= 1;
      const obj = gross * (1 - r.waterCut) * FIELD.oilPrice - L.powerKW * 24 * FIELD.powerCost - L.goodman ** 4 * 150000; // amortised Goodman failure risk
      if (feasible && (!best || obj > best.obj)) best = { spm: +spm.toFixed(1), down: +down.toFixed(2), obj, fmi: m.fmi, fill, torque: L.torque, gross };
    }
  }
  return best || { spm: 3, down: 0.7, infeasible: true };
}

// ── Safety envelope: clamp a requested setpoint to hard physics bounds ──
export function envelope(well, day, req) {
  const r = simulate(well, { withFmi: false }).rows[day];
  const prof = tubingProfile(r.Tpump, r.gross);
  const check = (spm) => {
    const fr = fmiProfile(prof, spm, req.down);
    const L = loads(fr, spm, req.down, Math.min(r.inflow, displacement(spm)));
    if (minBy(fr, 'fmi').fmi <= FIELD.fmiLimit) return 'FMI(z) > 0.15';
    if (L.torque > FIELD.torqueRating) return 'Gearbox torque ≤ rating';
    return null;
  };
  const binding = check(req.spm);
  if (!binding) return { applied: req, binding: null };
  let spm = req.spm;
  while (spm > 2 && check(spm)) spm = +(spm - 0.1).toFixed(1);
  return { applied: { ...req, spm }, binding };
}

// ── Full state for one well ──
export function buildState(well, day, setpoint) {
  const sp = setpoint || { spm: well.spm, down: 1 };
  const sim = simulate(well, { setpoint: sp, fromDay: day });
  const base = setpoint ? simulate(well).rows : sim.rows;
  const rows = sim.rows;
  const now = rows[day], ago = rows[Math.max(0, day - 4)], ahead = rows[Math.min(day + 2, FIELD.horizon)];
  const prof = tubingProfile(now.Tpump, now.gross);
  const fmiZ = fmiProfile(prof, sp.spm, sp.down);
  const L = loads(fmiZ, sp.spm, sp.down, now.gross);
  const cut = cutoff(rows, sim.steam);
  const lo = cutoff(simulate({ ...well, kh: well.kh * 0.9 }, { setpoint: sp, fromDay: day, withFmi: false }).rows, sim.steam).day;
  const hi = cutoff(simulate({ ...well, kh: well.kh * 1.1 }, { setpoint: sp, fromDay: day, withFmi: false }).rows, sim.steam).day;
  const steamBbl = sim.steam * 6.29;
  const opt = mpc(well, day);
  const spmMax = (() => { let s = 9; const pr = tubingProfile(ahead.Tpump, ahead.gross); while (s > 2 && minBy(fmiProfile(pr, s, sp.down), 'fmi').fmi <= FIELD.fmiLimit) s -= 0.1; return +s.toFixed(1); })();
  return {
    well, day, sp, rows, base, now, ago, ahead, prof, fmiZ, loads: L, rh: sim.rh, steam: sim.steam,
    cut: { ...cut, band: Math.max(1, Math.round((hi - lo) / 2)) },
    sor: steamBbl / Math.max(now.cumOil, 1),
    sorAtCut: steamBbl / Math.max(rows[cut.day].cumOil, 1),
    npv: cycleNpv(rows, sim.steam, cut.day),
    mpc: opt, spmMax,
    fmiMin: minBy(fmiZ, 'fmi'),
    phase: 'Production',
    asphaltene: now.Tpump < FIELD.T_onset,
  };
}

// ── Explainability contract (Section 9): a card missing any field is never shown ──
export const REQUIRED_FIELDS = ['why', 'driver', 'relation', 'effect', 'confidence', 'cycle'];

const f0 = (x) => Math.round(x).toLocaleString('en-IN');
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);
const pct = (a, b) => `${a >= b ? '+' : '−'}${Math.abs(Math.round((a / b - 1) * 100))}%`;

export function recommendations(s, design) {
  const { well, now, ago, sp, mpc: m, cut } = s;
  const recs = [];
  const cycle = `Day ${s.day} of production. Cut-off threshold projected at day ${cut.day} ± ${cut.band}.`;
  const muSigma = Math.round(now.mu * 0.13 / 10) * 10;

  if (!m.infeasible && (Math.abs(m.spm - sp.spm) >= 0.2 || Math.abs(m.down - sp.down) >= 0.05)) {
    const after = buildLite(well, s.day, { spm: m.spm, down: m.down });
    const downChange = Math.round((1 - (m.spm * m.down) / (sp.spm * sp.down)) * 100);
    const lower = m.spm < sp.spm;
    const lifeX = (s.loads.goodman / after.goodman) ** 6;
    recs.push({
      id: 'mpc', kind: 'MPC · SRP', priority: s.fmiMin.fmi < FIELD.fmiLimit + 0.03 ? 'high' : 'medium',
      title: `${lower ? 'Reduce' : 'Raise'} SPM ${f1(sp.spm)} → ${f1(m.spm)}; downstroke velocity ${downChange >= 0 ? '−' : '+'}${Math.abs(downChange)}%`,
      why: s.fmiMin.fmi < FIELD.fmiLimit
        ? `Float Margin Index ${s.fmiMin.z ? `at ${s.fmiMin.z} m` : 'at the top of the rod string'} has fallen to ${f2(s.fmiMin.fmi)}, below the 0.15 operating limit.`
        : lower
          ? `Pump fillage ${Math.round(now.fillage * 100)}% and FMI ${f2(s.fmiMin.fmi)} at ${s.fmiMin.z} m are both closing on their limits within the ${2 * 24} h Ramey lag.`
          : `FMI ${f2(s.fmiMin.fmi)} leaves unused margin; the hot, thin fluid can be lifted faster without float.`,
      driver: `Pump-intake temperature ${f0(ago.Tpump)} °C → ${f0(now.Tpump)} °C over the last 96 hours; μ ${ago.mu < now.mu ? 'risen' : 'fallen'} ${f0(ago.mu)} → ${f0(now.mu)} cP.`,
      relation: '(S·N)max ∝ 1/μ(T_pump) — annular viscous drag versus buoyed rod weight.',
      effect: `${pct(after.gross, now.gross)} gross fluid; ${pct(after.dragDown, s.loads.dragDown)} peak downstroke drag; rod fatigue life ×${f1(Math.min(lifeX, 9.9))}; FMI → ${f2(after.fmi)}.`,
      confidence: `${Math.round(92 - muSigma / 40)}%. EnKF posterior on μ: ±${muSigma} cP.`,
      cycle,
      action: { spm: m.spm, down: m.down },
    });
  }

  if (cut.day - s.day <= 25) {
    recs.push({
      id: 'cutoff', kind: 'Optimal stopping', priority: cut.day - s.day <= 7 ? 'high' : 'medium',
      title: `Schedule re-injection for day ${cut.day}`,
      why: `Profit rate π(t) = ₹${f0(now.profit)}/d is projected to cross the fresh-cycle average π̄* = ₹${f0(cut.piStar)}/d at day ${cut.day}.`,
      driver: `Heated-zone T̄ ${f0(ago.Tbar)} → ${f0(now.Tbar)} °C in 4 days; δ (heat carried off by produced fluid) now ${f2(now.delta)}.`,
      relation: 'Stop producing and re-inject when π(t) ≤ π̄* (renewal–reward process).',
      effect: `Cycle-average profit ₹${f0(cut.piStar)}/d vs ₹${f0(cut.rateToHorizon)}/d if run to day ${FIELD.horizon} (${pct(cut.piStar, cut.rateToHorizon)}); SOR at cut-off ${f2(s.sorAtCut)}.`,
      confidence: `${80 - cut.band * 2}%. Band from EnKF kh ±10%: day ${cut.day - cut.band}–${cut.day + cut.band}.`,
      cycle,
    });
  }

  if (design) {
    recs.push({
      id: 'bo', kind: 'Bayesian optimization · CSS', priority: 'low',
      title: `Cycle ${well.cycle + 1}: ${f0(design.best.steam)} t steam, ${design.best.soak} d soak`,
      why: `Posterior NPV maximum over ${design.calls} physics-model calls; current design (${f0(well.steam)} t, ${well.soak} d) sits ${Math.round((1 - design.current.npv / design.best.npv) * 100)}% below it.`,
      driver: `EnKF updates this cycle: kh ×${f2(well.kh)}, skin ${f1(well.skin)}, heat-loss coefficient ×${f2(well.heatLoss)}.`,
      relation: 'max NPV = Σ (R·q_o − C_steam·V_s − C_energy·E − C_fail·λ)/(1+r)^t over (V_s, t_soak).',
      effect: `NPV ₹${f1(design.best.npv / 1e5)} L vs ₹${f1(design.current.npv / 1e5)} L; SOR ${f2(design.best.sor)} vs ${f2(design.current.sor)}.`,
      confidence: `${design.confidence}%. GP posterior σ at optimum ±₹${f1(design.sigma / 1e5)} L.`,
      cycle,
    });
  }

  if (well.skin > 3) {
    recs.push({
      id: 'skin', kind: 'EnKF diagnostic', priority: 'low',
      title: 'Plan near-wellbore solvent treatment before next injection',
      why: `Skin posterior has drifted 1.6 → ${f1(well.skin)} over ${well.cycle} cycles, outside its prior band.`,
      driver: 'Monotonic skin rise with Tpump below asphaltene onset (58 °C) for long tails of each cycle.',
      relation: 'q_o = 2πk·k_ro·h·ΔP / (μ_h[ln(r_h/r_w) + s] + μ_c·ln(r_e/r_h)).',
      effect: `Restoring s to 1.6 raises current inflow ${pct(inflowAt(s, 1.6), now.inflow)} at today's temperatures.`,
      confidence: '74%. Skin posterior ±0.6 (1σ).',
      cycle,
    });
  }

  // First-pass classifier screen (Section 5.5): no governing relation until the inverse solve confirms it.
  recs.push({
    id: 'gbm', kind: 'Classifier screen', priority: 'low',
    title: 'Possible gas interference on last 12 cards',
    why: 'Gradient-boosted screen flagged card shape.', driver: 'Card area −8%.', relation: '',
    effect: 'Unknown until inverse solve.', confidence: '61%.', cycle,
  });
  return recs;
}

function buildLite(well, day, sp) {
  const r = simulate(well, { withFmi: false }).rows[day];
  const prof = tubingProfile(r.Tpump, r.gross);
  const gross = Math.min(r.inflow, displacement(sp.spm) * 0.97);
  const fr = fmiProfile(prof, sp.spm, sp.down);
  const L = loads(fr, sp.spm, sp.down, gross);
  return { gross, fmi: minBy(fr, 'fmi').fmi, dragDown: L.dragDown, goodman: L.goodman };
}

function inflowAt(s, skin) {
  const muC = viscosity(FIELD.T_R);
  return (J * s.well.kh) / (s.now.muH * (Math.log(s.rh / FIELD.rw) + skin) + muC * Math.log(FIELD.re / s.rh));
}

// ── CSS design space for Bayesian optimization (evaluated grid = GP posterior mean stand-in) ──
export function designSpace(well) {
  const steams = [1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000, 4250, 4500];
  const soaks = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  const grid = [];
  for (const soak of soaks) for (const steam of steams) {
    const rows = simulate(well, { withFmi: false, design: { steam, soak } }).rows;
    const c = cutoff(rows, steam);
    const npv = cycleNpv(rows, steam, c.day);
    grid.push({ steam, soak, npv, cutDay: c.day, sor: (steam * 6.29) / rows[c.day].cumOil });
  }
  const best = grid.reduce((a, b) => (b.npv > a.npv ? b : a));
  const nearest = (v, arr) => arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const current = grid.find((g) => g.steam === nearest(well.steam, steams) && g.soak === nearest(well.soak, soaks));
  // deterministic "sampled" points: ~50 BO calls concentrated near the optimum
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const samples = grid.filter((g) => rnd() < 0.25 + 0.6 * Math.exp(-(((g.steam - best.steam) / 900) ** 2 + ((g.soak - best.soak) / 3) ** 2)));
  return { grid, steams, soaks, best, current, samples, calls: samples.length, confidence: 84, sigma: Math.abs(best.npv) * 0.06 };
}

// ── EnKF parameter table (Section 5.1) ──
export function enkfParams(well) {
  return [
    { key: 'kh', name: 'Permeability-thickness kh', unit: 'mD·m', prior: [4000, 1500], post: [4000 * well.kh * 1.02, 260], source: 'rate and pressure history' },
    { key: 'skin', name: 'Skin s', unit: '—', prior: [2.0, 1.5], post: [well.skin, 0.6], source: 'rate and pressure history', flag: well.skin > 3 ? 'Rising cycle over cycle → asphaltene deposition' : null },
    { key: 'U', name: 'Overburden heat-loss coefficient', unit: 'W/m²K', prior: [3.0, 1.2], post: [3.0 * well.heatLoss, 0.25], source: 'observed temperature decline' },
    { key: 'c', name: 'Rod damping coefficient c', unit: '1/s', prior: [0.5, 0.25], post: [0.42, 0.04], source: 'dynamometer card fit' },
    { key: 'A', name: 'Walther coefficient A', unit: '—', prior: [6.2, 0.4], post: [WALTHER.A, 0.03], source: 'card, rate and temperature jointly' },
    { key: 'B', name: 'Walther coefficient B', unit: '—', prior: [2.3, 0.3], post: [WALTHER.B, 0.02], source: 'card, rate and temperature jointly' },
    { key: 'slip', name: 'Pump slippage / leakage', unit: 'fraction', prior: [0.05, 0.03], post: [0.03, 0.006], source: 'fillage versus measured rate' },
  ];
}

// Assimilation steps: posterior mean walks from prior to truth while the band collapses.
export function enkfTrace(param, steps = 40) {
  const [m0, s0] = param.prior, [m1, s1] = param.post;
  let seed = param.key.length * 97 + 13; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  return Array.from({ length: steps }, (_, i) => {
    const k = 1 - Math.exp(-i / 8);
    const mean = m0 + (m1 - m0) * k + rnd() * s1 * 0.6 * (1 - k * 0.5);
    const sd = s0 + (s1 - s0) * k;
    return { step: i, mean, band: [mean - 2 * sd, mean + 2 * sd], truth: m1 };
  });
}
