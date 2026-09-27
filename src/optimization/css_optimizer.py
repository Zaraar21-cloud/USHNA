"""
USHNA — CSS Steam Injection Volume Optimizer
=============================================
Physics-based optimization of steam volume V_s (metric tonnes) and injection
duration for Cyclic Steam Stimulation at Baghewala Heavy Oil Field.

Integrates:
  - Marx–Langenheim heated-zone model  (Section 4.1.1)
  - Boberg–Lantz thermal decline       (Section 4.1.2)
  - Walther viscosity coupling law      (Section 4.2)
  - Radial composite inflow            (Section 4.1.3)
  - Cycle NPV objective                (Section 6.2)
  - Safety envelope constraints         (Section 6.4)

References: USHNA_Digital_Twin_PS26120.pdf, Sections 4.1, 6.2, 9.
"""

from __future__ import annotations

import sys
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy.optimize import minimize

# ── Ensure project root is on sys.path so we can import sibling packages ──
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from src.physics.reservoir import (
    marx_langenheim_heated_volume,
    boberg_lantz_temperature,
    radial_composite_inflow,
)
from src.physics.viscosity import WaltherViscosityModel


# ============================================================================
# 1. Field & Well Parameters
# ============================================================================

@dataclass
class FieldParams:
    """Baghewala Heavy Oil Field constants (matches FIELD in twin.js)."""

    # Reservoir
    T_R: float = 47.0           # Original reservoir temperature (°C)
    T_s: float = 250.0          # Steam temperature (°C)
    T_surf: float = 30.0        # Surface temperature (°C)
    grad_geo: float = 0.019     # Geothermal gradient (°C/m)
    pay: float = 20.0           # Net pay thickness (m)
    rw: float = 0.1             # Wellbore radius (m)
    re: float = 60.0            # External drainage radius (m)
    pump_depth: float = 900.0   # Pump setting depth (m)

    # Thermal properties
    M_R: float = 2.5e6          # Volumetric heat capacity of reservoir (J/m³·K)
    k_ob: float = 1.7           # Overburden thermal conductivity (W/m·K)
    alpha_ob: float = 8e-7      # Overburden thermal diffusivity (m²/s)
    alpha_eff: float = 0.9      # Effective thermal diffusivity (m²/day) — conduction + convection
    enthalpy_factor: float = 2.33e6  # Wet steam enthalpy above 30 °C (J/kg)

    # Timing defaults
    t_inj_default: float = 8.0  # Default injection duration (days)
    t_soak_default: float = 5.0 # Default soak duration (days)
    horizon: int = 120          # Production horizon (days)

    # Economic
    oil_price: float = 6300.0   # ₹/bbl
    steam_cost: float = 4200.0  # ₹/tonne of steam
    power_cost: float = 8.0     # ₹/kWh
    opex: float = 16000.0       # ₹/day fixed operating cost
    fail_cost: float = 1.2e6    # ₹ per rod failure event
    discount_rate: float = 0.12 # Annual discount rate (12%)

    # Oil properties
    rho: float = 0.95           # Oil density (g/cm³ or specific gravity)
    api: str = '17–19° API'
    T_onset: float = 58.0       # Asphaltene onset temperature (°C)

    # Viscosity model (Walther, fitted to Baghewala PVT)
    walther_A: float = 6.0101
    walther_B: float = 2.1860

    # Physics constraints
    P_frac: float = 18.0        # Formation fracture pressure (MPa)
    V_max: float = 5000.0       # Boiler mass delivery limit (tonnes)
    T_limit: float = 300.0      # Casing/cement thermal safety ceiling (°C)
    P_inj_per_tonne: float = 0.004  # Approx injection pressure per tonne steam (MPa)

    # Permeability (base)
    k: float = 200.0            # Absolute permeability (mD)
    k_ro: float = 0.6           # Relative permeability to oil


@dataclass
class WellParams:
    """Per-well parameters (matches WELLS entries in twin.js)."""

    well_id: str = 'BGW-07'
    cycle: int = 4
    day: int = 41
    kh: float = 1.0             # Permeability-thickness multiplier
    skin: float = 3.4           # Skin factor
    heat_loss: float = 1.0      # Heat-loss coefficient multiplier
    steam: float = 2600.0       # Injected steam (tonnes) — current design
    soak: int = 5               # Soak duration (days) — current design
    spm: float = 6.2            # Current SPM setting


# ============================================================================
# 2. Viscosity Helper
# ============================================================================

def _make_visc_model(fp: FieldParams) -> WaltherViscosityModel:
    """Create a Walther viscosity model instance from field params."""
    return WaltherViscosityModel(A=fp.walther_A, B=fp.walther_B, T_onset=fp.T_onset)


def viscosity_cP(T_celsius: float, fp: FieldParams) -> float:
    """Dynamic viscosity in cP from temperature in °C.

    Matches the browser twin's ``viscosity(tC)`` function exactly.
    """
    T_kelvin = T_celsius + 273.15
    model = _make_visc_model(fp)
    nu_cSt = model.kinematic_viscosity(T_kelvin)
    return float(nu_cSt * fp.rho)


# ============================================================================
# 3. Heated Radius (Marx–Langenheim, Section 4.1.1)
# ============================================================================

def heated_radius(steam_tonnes: float, t_inj_days: float, fp: FieldParams) -> float:
    """Compute heated-zone radius using Marx–Langenheim.

    Uses the existing ``marx_langenheim_heated_volume`` from ``reservoir.py``.
    """
    # Heat injection rate Q (W)
    Q = (steam_tonnes * 1e3 * fp.enthalpy_factor) / (t_inj_days * 86400.0)
    delta_T = fp.T_s - fp.T_R
    t_seconds = t_inj_days * 86400.0

    _, r_h = marx_langenheim_heated_volume(
        Q_i=Q,
        M_R=fp.M_R,
        delta_T=delta_T,
        k_ob=fp.k_ob,
        alpha_ob=fp.alpha_ob,
        h=fp.pay,
        t=t_seconds,
    )
    return float(r_h)


# ============================================================================
# 4. Cycle Simulation (Boberg–Lantz + Walther + Inflow, Section 4.1.2)
# ============================================================================

def simulate_cycle(
    steam_tonnes: float,
    t_inj_days: float,
    t_soak_days: float,
    wp: WellParams,
    fp: FieldParams,
) -> dict:
    """Simulate a full production cycle for given (V_s, t_inj, t_soak).

    Returns a dict with day-by-day time-series and summary statistics.
    """
    r_h = heated_radius(steam_tonnes, t_inj_days, fp)

    # Soak redistribution efficiency
    eta = 1.0 - np.exp(-t_soak_days / 2.5)
    r_h_eff = r_h * (0.75 + 0.25 * eta)
    soak_loss = 0.012 * t_soak_days

    # Cold zone viscosity
    mu_cold = viscosity_cP(fp.T_R, fp)

    # Water cut model: declines from ~55% early to ~30% late
    water_cut = lambda p: 0.3 + 0.25 * np.exp(-p / 8.0)

    # Day-by-day simulation
    rows = []
    delta = soak_loss
    cum_oil = 0.0
    cum_gross = 0.0

    for p in range(fp.horizon + 1):
        t = p + t_soak_days

        # Boberg–Lantz thermal decline factors
        tDr = (fp.alpha_eff * wp.heat_loss * t) / (r_h_eff ** 2)
        tDv = (4.0 * fp.alpha_eff * wp.heat_loss * t) / (fp.pay ** 2)
        f_HD = 1.0 / (1.0 + 5.0 * tDr)
        f_VD = 1.0 / np.sqrt(1.0 + 5.0 * tDv)

        # Average heated zone temperature via Boberg–Lantz
        T_bar = boberg_lantz_temperature(fp.T_R, fp.T_s, f_VD, f_HD, max(0.0, delta))
        T_pump = fp.T_R + (T_bar - fp.T_R) * 0.9

        # Viscosity
        mu_hot = viscosity_cP(T_bar, fp)
        mu_pump = viscosity_cP(T_pump, fp)

        # Radial composite inflow (Section 4.1.3)
        # Using existing reservoir.py function
        # Note: the function expects absolute permeability × thickness, pressure drop, etc.
        # We use a simplified productivity-constant approach consistent with twin.js:
        # q = J * kh / [mu_h * (ln(r_h/r_w) + skin) + mu_c * ln(r_e/r_h)]
        J_const = 1.05e6  # productivity constant (bbl/d · cP), from twin.js
        denom = mu_hot * (np.log(r_h_eff / fp.rw) + wp.skin) + mu_cold * np.log(fp.re / r_h_eff)
        inflow = (J_const * wp.kh) / max(denom, 1e-6)

        # Pump displacement (from twin.js: displacement = 0.1166 * S_in * plunger_in^2 * spm)
        stroke_in = 3.0 * 39.37  # 3 m stroke in inches
        plunger_in = 1.25
        disp = 0.1166 * stroke_in * plunger_in ** 2 * wp.spm  # bbl/d

        gross = min(inflow, disp * 0.97)
        fillage = min(1.0, inflow / max(disp, 1e-6))
        wc = water_cut(p)
        oil = gross * (1.0 - wc)
        cum_oil += oil
        cum_gross += gross

        # Power (approximate)
        power_kW = 2.0 + gross * 0.035

        # Risk (simplified)
        risk = 0.002

        # Daily profit
        profit = (
            oil * fp.oil_price
            - power_kW * 24.0 * fp.power_cost
            - fp.opex
            - risk * fp.fail_cost
        )

        rows.append({
            'p': p,
            'T_bar': T_bar,
            'T_pump': T_pump,
            'mu_hot': mu_hot,
            'mu_pump': mu_pump,
            'inflow': inflow,
            'gross': gross,
            'oil': oil,
            'fillage': fillage,
            'water_cut': wc,
            'cum_oil': cum_oil,
            'delta': delta,
            'power_kW': power_kW,
            'risk': risk,
            'profit': profit,
        })

        # Update delta (energy carried away by produced fluid)
        K_DELTA = 1.4e-4
        delta = min(0.97, delta + K_DELTA * gross * ((T_bar - fp.T_R) / (fp.T_s - fp.T_R)) + 0.002)

    return {
        'rows': rows,
        'r_h': r_h,
        'r_h_eff': r_h_eff,
        'steam_tonnes': steam_tonnes,
        't_inj_days': t_inj_days,
        't_soak_days': t_soak_days,
        'cum_oil_bbl': cum_oil,
        'cum_gross_bbl': cum_gross,
    }


# ============================================================================
# 5. Cycle NPV (Section 6.2)
# ============================================================================

def cycle_npv(
    sim_result: dict,
    fp: FieldParams,
    stop_day: Optional[int] = None,
) -> float:
    """Compute discounted NPV for a simulated cycle.

    NPV(V_s, t_inj, t_soak) = Σ_t [ R_o·q_o(t) − C_energy·E(t) ] / (1+r)^t − C_steam·V_s
    """
    r = fp.discount_rate / 365.0  # daily discount rate
    steam = sim_result['steam_tonnes']
    t_inj = sim_result['t_inj_days']
    t_soak = sim_result['t_soak_days']
    rows = sim_result['rows']

    npv = -steam * fp.steam_cost - (t_inj + t_soak) * fp.opex

    for row in rows:
        if stop_day is not None and row['p'] > stop_day:
            break
        discount = (1.0 + r) ** (row['p'] + t_inj + t_soak)
        npv += row['profit'] / discount

    return float(npv)


# ============================================================================
# 6. Optimal Cut-off (renewal–reward, Section 6.3)
# ============================================================================

def find_cutoff(rows: list[dict], steam_tonnes: float, fp: FieldParams) -> dict:
    """Find the optimal stopping day using the renewal–reward criterion.

    Stop when daily profit π(t) ≤ π̄* (cycle-average rate).
    """
    C0 = steam_tonnes * fp.steam_cost + (fp.t_inj_default + 5) * fp.opex
    cum = -C0
    best_rate = -np.inf

    for i, r in enumerate(rows):
        cum += r['profit']
        rate = cum / (i + 1 + fp.t_inj_default + 5)
        if rate > best_rate:
            best_rate = rate

    peak_idx = max(range(len(rows)), key=lambda i: rows[i]['profit'])
    hit_day = fp.horizon
    for i in range(peak_idx + 1, len(rows)):
        if rows[i]['profit'] <= best_rate:
            hit_day = rows[i]['p']
            break

    return {'pi_star': best_rate, 'day': hit_day}


# ============================================================================
# 7. Constraint Checking (Section 6.4 — Safety Envelope)
# ============================================================================

@dataclass
class ConstraintResult:
    """Result of evaluating a physics constraint."""
    name: str
    limit: float
    actual: float
    unit: str
    satisfied: bool
    binding: bool = False

    @property
    def status(self) -> str:
        if not self.satisfied:
            return 'violated'
        if self.binding:
            return 'binding'
        return 'ok'


def check_constraints(
    steam_tonnes: float,
    t_inj_days: float,
    fp: FieldParams,
) -> list[ConstraintResult]:
    """Evaluate all physics constraints for a given steam volume.

    Returns a list of ConstraintResult objects.
    """
    constraints = []

    # 1. Injection pressure ≤ fracture pressure
    P_inj = steam_tonnes * fp.P_inj_per_tonne
    binding_threshold = 0.9  # within 90% of limit is "binding"
    constraints.append(ConstraintResult(
        name='Injection pressure ≤ P_frac',
        limit=fp.P_frac,
        actual=P_inj,
        unit='MPa',
        satisfied=P_inj <= fp.P_frac,
        binding=P_inj >= fp.P_frac * binding_threshold and P_inj <= fp.P_frac,
    ))

    # 2. Steam volume ≤ boiler capacity
    constraints.append(ConstraintResult(
        name='Steam volume ≤ boiler capacity',
        limit=fp.V_max,
        actual=steam_tonnes,
        unit='tonnes',
        satisfied=steam_tonnes <= fp.V_max,
        binding=steam_tonnes >= fp.V_max * binding_threshold and steam_tonnes <= fp.V_max,
    ))

    # 3. Steam temperature ≤ casing thermal limit
    # Higher injection pressure → higher saturation temperature
    # Approximate: T_sat(P) ≈ 180 + 5 * P (simplified for range 5–20 MPa)
    T_sat = 180.0 + 5.0 * P_inj
    constraints.append(ConstraintResult(
        name='Casing temperature T_s(P) ≤ T_limit',
        limit=fp.T_limit,
        actual=T_sat,
        unit='°C',
        satisfied=T_sat <= fp.T_limit,
        binding=T_sat >= fp.T_limit * 0.95 and T_sat <= fp.T_limit,
    ))

    return constraints


# ============================================================================
# 8. Main Optimizer (Section 6.2 — Bayesian Optimization Stand-in)
# ============================================================================

def optimize_steam_volume(
    wp: WellParams,
    fp: FieldParams | None = None,
    steam_range: tuple[float, float] = (1500.0, 4500.0),
    soak_range: tuple[int, int] = (2, 10),
) -> dict:
    """Find optimal steam volume V_s* and soak time that maximizes cycle NPV.

    Uses scipy.optimize.minimize (bounded L-BFGS-B) on the negative NPV surface.
    Falls back to grid search if gradient-based method fails.

    Returns the structured result dictionary per Section 9 explainability contract.
    """
    if fp is None:
        fp = FieldParams()

    best = None
    best_npv = -np.inf
    grid_results = []

    # Grid search over (steam, soak) — robust for this 2D problem
    steams = np.linspace(steam_range[0], steam_range[1], 25)
    soaks = range(soak_range[0], soak_range[1] + 1)

    for soak in soaks:
        for steam in steams:
            # Check constraints first
            cons = check_constraints(steam, fp.t_inj_default, fp)
            feasible = all(c.satisfied for c in cons)
            if not feasible:
                continue

            sim = simulate_cycle(steam, fp.t_inj_default, float(soak), wp, fp)
            cut = find_cutoff(sim['rows'], steam, fp)
            npv = cycle_npv(sim, fp, stop_day=cut['day'])
            sor = (steam * 6.29) / max(sim['cum_oil_bbl'], 1.0)

            result = {
                'steam': steam,
                'soak': soak,
                'npv': npv,
                'sor': sor,
                'cum_oil': sim['cum_oil_bbl'],
                'cut_day': cut['day'],
                'r_h': sim['r_h'],
                'constraints': cons,
            }
            grid_results.append(result)

            if npv > best_npv:
                best_npv = npv
                best = result

    if best is None:
        return {
            'optimal_steam_volume_tonnes': 0.0,
            'recommended_injection_days': fp.t_inj_default,
            'recommended_soak_days': fp.t_soak_default,
            'projected_cum_oil_bbl': 0.0,
            'projected_sor': float('inf'),
            'expected_cycle_npv': 0.0,
            'binding_constraint': 'All infeasible',
            'confidence': 0.0,
            'grid_results': [],
            'optimal_cut_day': 0,
            'heated_radius_m': 0.0,
        }

    # Refine with scipy around the grid optimum
    def neg_npv(x):
        steam, soak = x[0], int(round(x[1]))
        soak = max(soak_range[0], min(soak_range[1], soak))
        cons = check_constraints(steam, fp.t_inj_default, fp)
        if not all(c.satisfied for c in cons):
            return 1e12  # infeasible penalty
        sim = simulate_cycle(steam, fp.t_inj_default, float(soak), wp, fp)
        cut = find_cutoff(sim['rows'], steam, fp)
        return -cycle_npv(sim, fp, stop_day=cut['day'])

    try:
        x0 = [best['steam'], best['soak']]
        bounds = [steam_range, soak_range]
        opt = minimize(neg_npv, x0, method='L-BFGS-B', bounds=bounds,
                       options={'maxiter': 50, 'ftol': 1e-6})
        if opt.fun < -best_npv:
            refined_steam = opt.x[0]
            refined_soak = int(round(opt.x[1]))
            refined_soak = max(soak_range[0], min(soak_range[1], refined_soak))
            sim = simulate_cycle(refined_steam, fp.t_inj_default, float(refined_soak), wp, fp)
            cut = find_cutoff(sim['rows'], refined_steam, fp)
            npv = cycle_npv(sim, fp, stop_day=cut['day'])
            sor = (refined_steam * 6.29) / max(sim['cum_oil_bbl'], 1.0)
            cons = check_constraints(refined_steam, fp.t_inj_default, fp)
            best = {
                'steam': refined_steam,
                'soak': refined_soak,
                'npv': npv,
                'sor': sor,
                'cum_oil': sim['cum_oil_bbl'],
                'cut_day': cut['day'],
                'r_h': sim['r_h'],
                'constraints': cons,
            }
            best_npv = npv
    except Exception:
        pass  # stick with grid result

    # Identify binding constraint
    binding = 'None'
    for c in best['constraints']:
        if c.binding:
            binding = c.name
            break
        if not c.satisfied:
            binding = f'{c.name} (violated)'
            break

    # Confidence: based on how peaked the NPV surface is around the optimum
    if len(grid_results) > 1:
        npvs = [r['npv'] for r in grid_results]
        npv_std = float(np.std(npvs))
        confidence = min(95.0, max(60.0, 84.0 + 10.0 * (best_npv - np.mean(npvs)) / max(npv_std, 1e-6)))
    else:
        confidence = 60.0

    return {
        'optimal_steam_volume_tonnes': round(float(best['steam']), 1),
        'recommended_injection_days': fp.t_inj_default,
        'recommended_soak_days': best['soak'],
        'projected_cum_oil_bbl': round(float(best['cum_oil']), 0),
        'projected_sor': round(float(best['sor']), 3),
        'expected_cycle_npv': round(float(best_npv), 0),
        'binding_constraint': binding,
        'confidence': round(float(min(confidence, 95.0)), 1),
        'grid_results': grid_results,
        'optimal_cut_day': best['cut_day'],
        'heated_radius_m': round(float(best['r_h']), 2),
    }


# ============================================================================
# 9. Sensitivity Analysis
# ============================================================================

def sensitivity_analysis(
    wp: WellParams,
    fp: FieldParams | None = None,
    steam_range: tuple[float, float] = (1500.0, 4500.0),
    n_points: int = 30,
    soak: int | None = None,
) -> list[dict]:
    """Sweep steam volumes at a fixed soak time to produce chart data.

    Returns a list of dicts with {steam, npv, sor, cum_oil, feasible}.
    """
    if fp is None:
        fp = FieldParams()
    if soak is None:
        soak = wp.soak

    steams = np.linspace(steam_range[0], steam_range[1], n_points)
    results = []

    for steam in steams:
        cons = check_constraints(steam, fp.t_inj_default, fp)
        feasible = all(c.satisfied for c in cons)

        sim = simulate_cycle(steam, fp.t_inj_default, float(soak), wp, fp)
        cut = find_cutoff(sim['rows'], steam, fp)
        npv = cycle_npv(sim, fp, stop_day=cut['day'])
        sor = (steam * 6.29) / max(sim['cum_oil_bbl'], 1.0)

        results.append({
            'steam': round(float(steam), 0),
            'npv': round(float(npv), 0),
            'sor': round(float(sor), 3),
            'cum_oil': round(float(sim['cum_oil_bbl']), 0),
            'cut_day': cut['day'],
            'r_h': round(float(sim['r_h']), 2),
            'feasible': feasible,
        })

    return results


# ============================================================================
# 10. CLI Test Harness
# ============================================================================

if __name__ == '__main__':
    import sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    print('=' * 72)
    print('USHNA CSS Steam Volume Optimizer -- Test Run')
    print('=' * 72)

    fp = FieldParams()

    # Test with all six Baghewala wells from twin.js
    wells = [
        WellParams('BGW-07', cycle=4, day=41, kh=1.0,  skin=3.4, heat_loss=1.0,  steam=2600, soak=5, spm=6.2),
        WellParams('BGW-04', cycle=6, day=12, kh=1.15, skin=2.1, heat_loss=0.9,  steam=3000, soak=6, spm=6.8),
        WellParams('BGW-11', cycle=3, day=63, kh=0.85, skin=4.2, heat_loss=1.1,  steam=2400, soak=5, spm=5.4),
        WellParams('BGW-02', cycle=5, day=27, kh=1.05, skin=2.8, heat_loss=1.0,  steam=2800, soak=4, spm=6.5),
        WellParams('BGW-15', cycle=2, day=49, kh=0.95, skin=3.0, heat_loss=1.2,  steam=2500, soak=5, spm=5.0),
        WellParams('BGW-09', cycle=4, day=5,  kh=1.1,  skin=2.5, heat_loss=0.95, steam=2700, soak=6, spm=6.0),
    ]

    for wp in wells:
        print(f'\n-- {wp.well_id} (Cycle {wp.cycle}, current design: {wp.steam} t, {wp.soak} d soak) --')
        result = optimize_steam_volume(wp, fp)

        print(f'  Optimal steam volume:     {result["optimal_steam_volume_tonnes"]:,.0f} tonnes')
        print(f'  Recommended injection:    {result["recommended_injection_days"]} days')
        print(f'  Recommended soak:         {result["recommended_soak_days"]} days')
        print(f'  Projected cumulative oil: {result["projected_cum_oil_bbl"]:,.0f} bbl')
        print(f'  Projected SOR:            {result["projected_sor"]:.3f}')
        print(f'  Expected cycle NPV:       Rs {result["expected_cycle_npv"]:,.0f}')
        print(f'  Heated radius:            {result["heated_radius_m"]:.2f} m')
        print(f'  Optimal cut-off day:      {result["optimal_cut_day"]}')
        print(f'  Binding constraint:       {result["binding_constraint"]}')
        print(f'  Confidence:               {result["confidence"]}%')

    print('\n' + '=' * 72)
    print('Sensitivity analysis for BGW-07...')
    sens = sensitivity_analysis(wells[0], fp, n_points=10)
    print(f'  {"Steam (t)":>10}  {"NPV (Rs)":>14}  {"SOR":>6}  {"Oil (bbl)":>10}  {"Feasible":>8}')
    for s in sens:
        feas = 'Y' if s['feasible'] else 'N'
        print(f'  {s["steam"]:>10,.0f}  {s["npv"]:>14,.0f}  {s["sor"]:>6.3f}  {s["cum_oil"]:>10,.0f}  {feas:>8}')

    print('\nDone.')

