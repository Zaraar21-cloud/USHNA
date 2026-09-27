"""
USHNA Standalone ML Pipeline Training & Calibration Runner.
Executes training, parameter discovery, and energy audits across all components:
1. Bounded Gaussian Process Residual Fitting (discrepancy calibration)
2. Symbolic Regression Equation Discovery (auditable field correlations)
3. PINN training (PyTorch): heated-zone T(r, z, t; r_h), validated on unseen designs + energy audit
4. EnKF 80-day Continuous Assimilation & Uncertainty Collapse Trace
5. Mechanistic Fault Diagnosis Benchmark

Saves all trained weights, discovered formulas, and audit traces into trained_models/.
"""

import os
import sys

for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1" if _v == "OPENBLAS_NUM_THREADS" else "4")
import json
from pathlib import Path
from datetime import datetime

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np

from src.data.synthetic_generator import SyntheticDataGenerator
from src.learning.enkf import EnsembleKalmanFilter
from src.learning.gp_residual import BoundedGPResidualModel
from src.learning.symbolic_regression import SymbolicEquationDiscoverer
from src.learning.pinn_training import train_pinn, TrainConfig, report
from src.learning.inverse_diagnosis import InverseFaultDiagnosis, synthesize_pump_card
from src.physics.reservoir import boberg_lantz_temperature
from src.physics.viscosity import WaltherViscosityModel


def run_training_pipeline(output_dir: str = "trained_models", seed: int = 42, pinn_iterations: int = 4000):
    os.makedirs(output_dir, exist_ok=True)
    rng = np.random.default_rng(seed)
    print("=" * 75)
    print(">> USHNA DIGITAL TWIN: ML LAYER TRAINING & CALIBRATION PIPELINE")
    print(f"   Target Directory: {os.path.abspath(output_dir)}")
    print(f"   Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 75)

    # ---------------------------------------------------------
    # Phase 2: Ingest Synthetic Field Telemetry
    # ---------------------------------------------------------
    print("\n[1/5] Ingesting Synthetic Field Data (80-day CSS Cycle)...")
    generator = SyntheticDataGenerator(seed=seed)
    synthetic_data = generator.generate_css_cycle(days=80)
    time_days = synthetic_data['time_days']
    T_res_true = synthetic_data['T_res_true']
    T_res_meas = synthetic_data['T_res_measured']
    mu_true = synthetic_data['viscosity_true']
    q_meas = synthetic_data['production_rate_measured']
    print(f"      Generated 80 days of telemetry.")
    print(f"      Day 1  -> Temp: {T_res_meas[0]:.1f} K, Rate: {q_meas[0]:.1f} m3/d, Visc: {mu_true[0]:.1f} cSt")
    print(f"      Day 80 -> Temp: {T_res_meas[-1]:.1f} K, Rate: {q_meas[-1]:.1f} m3/d, Visc: {mu_true[-1]:.1f} cSt")

    # ---------------------------------------------------------
    # Component 1: Fit Bounded Gaussian Process Residual Model
    # ---------------------------------------------------------
    print("\n[2/5] Training Bounded Gaussian Process Residual Model (Discrepancy Calibration)...")
    # Base physics model predictions
    base_rate = 50.0
    q_physics = base_rate * (mu_true[0] / mu_true)

    # The "field" carries an effect the physics does not model: asphaltene skin growth that
    # costs up to 10% of rate by day 80. The GP has to find it, inside its +/-15% bound.
    unmodelled = 0.10 * time_days / time_days[-1]
    q_field = q_meas * (1.0 - unmodelled)

    # Features: [time_days, T_measured]. The rate spans 50 -> ~0.1 m3/d, so the GP learns the
    # discrepancy as a fraction of the physics prediction (the same basis as its +/-15% bound).
    X_train = np.column_stack([time_days, T_res_meas])
    ratio = q_field / q_physics
    gp_model = BoundedGPResidualModel(max_residual_fraction=0.15)
    gp_model.fit(X_train, ratio, np.ones_like(ratio))

    gp_path = os.path.join(output_dir, "gp_residual.npz")
    gp_model.save(gp_path)
    gp_mu, gp_sd = gp_model.predict_discrepancy(X_train)
    pct = lambda x: (100.0 * np.asarray(x)).round(3).tolist()
    gp_report = {
        'experiment': 'Physics rate model misses a growing skin-damage loss (true: -10% by day 80)',
        'bound_pct': 15.0,
        'lengthscale': np.atleast_1d(gp_model.lengthscale).round(3).tolist(),
        'sigma_f': float(gp_model.sigma_f),
        'day': time_days.astype(float).tolist(),
        'observed_residual_pct': pct(ratio - 1.0),
        'gp_mean_pct': pct(gp_mu),
        'gp_lo_pct': pct(gp_mu - 1.96 * gp_sd),
        'gp_hi_pct': pct(gp_mu + 1.96 * gp_sd),
        'true_unmodelled_pct': (-100.0 * unmodelled).round(3).tolist(),
        'rmse_vs_truth_pct': float(np.sqrt(np.mean((100.0 * gp_mu + 100.0 * unmodelled) ** 2))),
    }
    with open(os.path.join(output_dir, "gp_residual_report.json"), 'w') as f:
        json.dump(gp_report, f, indent=1)
    print(f"      GP fitted successfully (hyperparameters: lengthscale={gp_model.lengthscale}, sigma_f={gp_model.sigma_f:.3f})")
    print(f"      Recovered unmodelled loss: day 80 GP {gp_report['gp_mean_pct'][-1]:.1f}% vs true {gp_report['true_unmodelled_pct'][-1]:.1f}%")
    print(f"      Saved GP residual model -> {gp_path}")

    # ---------------------------------------------------------
    # Component 2: Symbolic Regression Equation Discovery
    # ---------------------------------------------------------
    print("\n[3/5] Running Symbolic Regression for Baghewala Closed-Form Equations...")
    symbolic = SymbolicEquationDiscoverer(random_state=seed)

    # Lab-style data with measurement noise, so the fit quality is a real number, not 1.0000.
    # 2a. Viscosity Law (Walther refit to Oil India's 10,000-13,000 cP @ 50 C, plus asphaltene)
    T_pvt = np.linspace(320.0, 520.0, 50)
    asp_pvt = rng.uniform(5.0, 22.0, 50)
    rhs_pvt = 7.0393 - 2.5617 * np.log10(T_pvt) + 0.004 * (asp_pvt ** 1.1)
    mu_pvt = 0.95 * (10.0 ** (10.0 ** rhs_pvt) - 0.7) * (1.0 + rng.normal(0.0, 0.03, 50))
    eq_visc = symbolic.discover_viscosity_law(T_pvt, asp_pvt, mu_pvt)

    # 2b. Soak Thermal Retention
    t_soak = np.linspace(1.0, 14.0, 30)
    v_steam = np.linspace(800.0, 3000.0, 30)
    eta_true = (1.0 - np.exp(-0.85 * (v_steam / 1000.0)**1.05)) * np.exp(-0.045 * t_soak)
    eq_soak = symbolic.discover_soak_efficiency_relation(t_soak, v_steam, eta_true * (1.0 + rng.normal(0.0, 0.01, 30)))

    # 2c. Rod Failure Hazard
    dF = np.linspace(20.0, 90.0, 30)
    tc = np.linspace(0.5, 4.0, 30)
    hazard_true = 0.045 * (dF / 100.0)**2.15 * (1.0 + 0.35 * tc)
    eq_rod = symbolic.discover_rod_hazard_relation(dF, tc, hazard_true * (1.0 + rng.normal(0.0, 0.03, 30)))

    equations_dict = {
        'viscosity_law': {
            'equation': eq_visc.equation_str,
            'latex': eq_visc.latex_str,
            'r2_score': eq_visc.r2_score,
            'rmse': eq_visc.rmse,
            'signoff': eq_visc.signoff_statement
        },
        'soak_efficiency': {
            'equation': eq_soak.equation_str,
            'latex': eq_soak.latex_str,
            'r2_score': eq_soak.r2_score,
            'rmse': eq_soak.rmse,
            'signoff': eq_soak.signoff_statement
        },
        'rod_hazard': {
            'equation': eq_rod.equation_str,
            'latex': eq_rod.latex_str,
            'r2_score': eq_rod.r2_score,
            'rmse': eq_rod.rmse,
            'signoff': eq_rod.signoff_statement
        }
    }

    eq_json_path = os.path.join(output_dir, "discovered_equations.json")
    with open(eq_json_path, 'w') as f:
        json.dump(equations_dict, f, indent=2)

    # Create Operating Manual Markdown
    manual_md_path = os.path.join(output_dir, "BAGHEWALA_OPERATING_MANUAL_EQUATIONS.md")
    with open(manual_md_path, 'w') as f:
        f.write("# Baghewala Heavy Oil Field: Closed-Form Correlation Templates (Synthetic Check)\n\n")
        f.write("Generated by USHNA Symbolic Regression Tier (Anti-Black-Box Layer)\n\n")
        f.write(
            "> **Not field-validated.** Each fit below uses synthetic data generated from the same "
            "equation form, so R^2 = 1 only confirms the fitting code recovers known coefficients. "
            "Refit on measured Baghewala PVT, soak and rod-failure data before operational use.\n\n"
        )
        f.write("## 1. Field-Specific Viscosity Law $\\mu(T, \\text{asphaltene})$\n")
        f.write(f"- **Formula**: `{eq_visc.equation_str}`\n")
        f.write(f"- **LaTeX**: $${eq_visc.latex_str}$$\n")
        f.write(f"- **Validation Fit**: $R^2 = {eq_visc.r2_score:.4f}$, $\\text{{RMSE}} = {eq_visc.rmse:.3f}\\,\\text{{cP}}$\n")
        f.write(f"- **Sign-off**: *{eq_visc.signoff_statement}*\n\n")

        f.write("## 2. Soak-Time Thermal Retention Efficiency $\\eta(t_{\\text{soak}}, V_{\\text{steam}})$\n")
        f.write(f"- **Formula**: `{eq_soak.equation_str}`\n")
        f.write(f"- **LaTeX**: $${eq_soak.latex_str}$$\n")
        f.write(f"- **Validation Fit**: $R^2 = {eq_soak.r2_score:.4f}$\n")
        f.write(f"- **Sign-off**: *{eq_soak.signoff_statement}*\n\n")

        f.write("## 3. Rod Fatigue & Compression Buckling Hazard $H(\\Delta F, t_{\\text{comp}})$\n")
        f.write(f"- **Formula**: `{eq_rod.equation_str}`\n")
        f.write(f"- **LaTeX**: $${eq_rod.latex_str}$$\n")
        f.write(f"- **Validation Fit**: $R^2 = {eq_rod.r2_score:.4f}$\n")
        f.write(f"- **Sign-off**: *{eq_rod.signoff_statement}*\n")

    print(f"      Viscosity Equation Discovered: R^2 = {eq_visc.r2_score:.4f}")
    print(f"      Soak Retention Discovered:     R^2 = {eq_soak.r2_score:.4f}")
    print(f"      Rod Hazard Discovered:         R^2 = {eq_rod.r2_score:.4f}")
    print(f"      Saved Operating Manual Document -> {manual_md_path}")

    # ---------------------------------------------------------
    # Component 3: PINN — train, validate on unseen designs, energy-audit
    # ---------------------------------------------------------
    print("\n[4/5] Training the heated-zone PINN (2-D axisymmetric conduction, PyTorch)...")
    pinn_weights_path = os.path.join(output_dir, "pinn_thermal_weights.npz")
    pinn_json_path = os.path.join(output_dir, "pinn_training.json")
    if pinn_iterations > 0:
        pinn_result = train_pinn(TrainConfig(iterations=pinn_iterations, seed=seed))
        pinn_report = report(pinn_result)
        pinn_result['model'].save(pinn_weights_path)
        with open(pinn_json_path, 'w') as f:
            json.dump(pinn_report, f, indent=1)
    else:
        print("      --pinn-iterations 0: keeping the existing trained PINN")
        with open(pinn_json_path) as f:
            pinn_report = json.load(f)
    audit = pinn_report['energy_audit']
    print(f"      Held-out designs RMSE: {pinn_report['validation']['val_rmse_c']:.2f} C "
          f"(max {pinn_report['validation']['val_max_c']:.1f} C)")
    print(f"      Energy audit: worst imbalance {audit['max_imbalance_pct']:.2f}% "
          f"(limit {audit['limit_pct']}%) -> {'PASSED' if audit['passed'] else 'REJECTED'}")
    print(f"      Speed: {pinn_report['speed']['speedup']}x faster than the solver")
    print(f"      Saved PINN Weights -> {pinn_weights_path}")

    # ---------------------------------------------------------
    # Component 4: EnKF 80-Day Assimilation & Uncertainty Collapse
    # ---------------------------------------------------------
    print("\n[5/5] Running EnKF 80-Day Twin Experiment & Tracking Uncertainty Collapse...")
    # Twin experiment: observations come from the EnKF's own forward model with known
    # true parameters, so recovery error is measurable. (SyntheticDataGenerator uses a
    # different rate model, q ~ 1/mu, that the forward operator cannot reproduce.)
    enkf = EnsembleKalmanFilter(n_ensemble=40, seed=seed)
    true_params = {'kh': 22000.0, 'skin': 5.0, 'k_ob': 2.4, 'c_rod': 0.1,
                   'A_visc': 7.0393, 'B_visc': 2.5617, 'eta_slip': 0.08}
    true_vec = np.array([true_params[n] for n in enkf.param_names])
    initial_summary = enkf.get_state_summary()
    initial_std_kh = initial_summary['kh']['std']
    obs_std = np.array([1.5, 0.02])  # T (K), q (m3/day)
    R_cov = np.diag(obs_std**2)

    assimilation_trace = []
    prior = {n: [initial_summary[n]['mean'], initial_summary[n]['std']] for n in enkf.param_names}
    daily_trace = []
    for day_idx in range(len(time_days)):
        day = float(time_days[day_idx])
        context = {'t_days': day}
        y_obs = enkf.forward_observation_operator(true_vec, context) + rng.normal(0.0, obs_std)
        step_summary = enkf.update(y_obs, R_cov, context, t_current=day)

        daily_trace.append({'day': day, **{n: [round(step_summary[n]['mean'], 5), round(step_summary[n]['std'], 5)]
                                          for n in enkf.param_names}})
        if day_idx % 10 == 0 or day_idx == len(time_days) - 1:
            assimilation_trace.append({
                'day': day,
                'kh_mean': step_summary['kh']['mean'],
                'kh_std': step_summary['kh']['std'],
                'skin_mean': step_summary['skin']['mean'],
                'skin_std': step_summary['skin']['std'],
                'k_ob_mean': step_summary['k_ob']['mean']
            })

    final_summary = enkf.get_state_summary()
    final_std_kh = final_summary['kh']['std']
    collapse_pct = ((initial_std_kh - final_std_kh) / initial_std_kh) * 100.0
    recovery = {
        name: {'true': true_params[name], 'estimated': final_summary[name]['mean'],
               'posterior_std': final_summary[name]['std']}
        for name in enkf.param_names
    }

    trace_json_path = os.path.join(output_dir, "enkf_assimilation_trace.json")
    with open(trace_json_path, 'w') as f:
        json.dump({
            'experiment': 'twin (observations from forward model with known true parameters)',
            'initial_std_kh': initial_std_kh,
            'final_std_kh': final_std_kh,
            'uncertainty_reduction_pct': collapse_pct,
            'parameter_recovery': recovery,
            'trace_milestones': assimilation_trace,
            'true_params': true_params,
            'prior': prior,
            'units': {n: enkf.specs[n].unit for n in enkf.param_names},
            'descriptions': {n: enkf.specs[n].description for n in enkf.param_names},
            'daily_trace': daily_trace
        }, f, indent=2)

    print(f"      Initial kh uncertainty: +/- {initial_std_kh:.1f} mD*m")
    print(f"      Final kh uncertainty:   +/- {final_std_kh:.1f} mD*m")
    print(f"      Uncertainty Collapse:   {collapse_pct:.1f}% reduction")
    for name, rec in recovery.items():
        print(f"      {name:>8}: true {rec['true']:.3g}, estimated {rec['estimated']:.3g} +/- {rec['posterior_std']:.2g}")
    print(f"      Saved EnKF Trace -> {trace_json_path}")

    print("\n" + "=" * 75)
    print("[OK] TRAINING & CALIBRATION COMPLETE! ALL ARTIFACTS SAVED:")
    print(f"   1. GP Residual Model:         {gp_path}")
    print(f"   2. Discovered Equations JSON: {eq_json_path}")
    print(f"   3. Operating Manual Markdown: {manual_md_path}")
    print(f"   4. Trained PINN Weights:      {pinn_weights_path}")
    print(f"   5. PINN Training Report:      {pinn_json_path}")
    print(f"   6. EnKF Assimilation Trace:   {trace_json_path}")
    print("=" * 75)


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument('--pinn-iterations', type=int, default=4000, help='0 keeps the existing trained PINN')
    run_training_pipeline(pinn_iterations=ap.parse_args().pinn_iterations)
