import numpy as np
import pytest
from src.learning.enkf import EnsembleKalmanFilter, PARAM_SPECS


def test_enkf_initialization():
    enkf = EnsembleKalmanFilter(n_ensemble=30, seed=123)
    assert enkf.ensemble.shape == (len(PARAM_SPECS), 30)

    summary = enkf.get_state_summary()
    assert 'kh' in summary
    assert 'skin' in summary
    assert 'k_ob' in summary
    assert 'c_rod' in summary
    assert 'A_visc' in summary
    assert 'B_visc' in summary
    assert 'eta_slip' in summary

    # Check that initial ensemble respects bounds
    for name, spec in PARAM_SPECS.items():
        assert summary[name]['min'] >= spec.min_val
        assert summary[name]['max'] <= spec.max_val


def test_enkf_forward_operator():
    enkf = EnsembleKalmanFilter(n_ensemble=20)
    param_vec = np.array([15000.0, 2.0, 2.0, 0.1, 7.0393, 2.5617, 0.05])
    context = {'t_days': 15.0}

    y_pred = enkf.forward_observation_operator(param_vec, context)
    assert len(y_pred) == 2
    T_res, q_oil = y_pred

    # Check physical plausibility
    assert 320.0 <= T_res <= 550.0, "Heated zone temp must stay within reservoir-steam bounds"
    assert q_oil > 0.0, "Production rate should be positive"


def test_enkf_assimilation_convergence():
    """
    Simulates a 15-step synthetic assimilation history.
    Verifies that uncertainty (std) collapses as evidence accumulates,
    and estimated parameters remain strictly bounded.
    """
    enkf = EnsembleKalmanFilter(n_ensemble=40, seed=42)

    # True synthetic well state: higher skin, lower permeability
    true_params = np.array([12000.0, 4.5, 2.2, 0.15, 9.4, 3.55, 0.08])
    R_cov = np.diag([1.0**2, 0.4**2])

    initial_std_kh = enkf.get_state_summary()['kh']['std']

    for day in range(1, 16):
        well_context = {'t_days': float(day)}
        # Ground truth observation with small measurement noise
        y_true = enkf.forward_observation_operator(true_params, well_context)
        y_obs = y_true + np.random.normal(0, [0.5, 0.2])

        summary = enkf.update(y_obs, R_cov, well_context, t_current=float(day))

    final_std_kh = summary['kh']['std']

    # Uncertainty should reduce
    assert final_std_kh < initial_std_kh, "Uncertainty band should collapse after assimilation"

    # Strict boundary satisfaction
    for name, spec in PARAM_SPECS.items():
        assert summary[name]['min'] >= spec.min_val
        assert summary[name]['max'] <= spec.max_val


def test_enkf_asphaltene_drift_detection():
    """
    Tests that a drifting skin factor triggers the asphaltene alert.
    """
    enkf = EnsembleKalmanFilter(n_ensemble=30, seed=42)
    R_cov = np.diag([1.0, 0.5])

    # Feed data with artificially increasing skin (from day 1 to day 10)
    for day in range(1, 11):
        context = {'t_days': float(day)}
        # Artificially shift ensemble skin to mimic asphaltene buildup
        enkf.ensemble[1, :] += 0.6
        y_obs = np.array([420.0, 15.0])
        enkf.update(y_obs, R_cov, context, t_current=float(day))

    diag = enkf.diagnose_well_health()
    assert 'asphaltene_alert' in diag
    assert "asphaltene" in diag['asphaltene_alert'].lower()


def test_enkf_twin_experiment_matches_observed_rate():
    """
    Twin experiment: with observations from the forward model itself, the posterior
    ensemble must reproduce the observed rate. Guards against unobserved Walther A/B
    spread swamping the rate statistics.
    """
    enkf = EnsembleKalmanFilter(n_ensemble=40, seed=42)
    rng = np.random.default_rng(0)
    true_params = np.array([22000.0, 5.0, 2.4, 0.1, 7.0393, 2.5617, 0.08])
    obs_std = np.array([1.5, 0.02])
    ia, ib = enkf.param_names.index('A_visc'), enkf.param_names.index('B_visc')
    prior_A_std = enkf.ensemble[ia].std()

    for day in range(1, 41):
        ctx = {'t_days': float(day)}
        y_obs = enkf.forward_observation_operator(true_params, ctx) + rng.normal(0, obs_std)
        enkf.update(y_obs, np.diag(obs_std**2), ctx, t_current=float(day))

    ctx = {'t_days': 40.0}
    q_true = enkf.forward_observation_operator(true_params, ctx)[1]
    q_ens = np.mean([enkf.forward_observation_operator(enkf.ensemble[:, j], ctx)[1]
                     for j in range(enkf.n_ensemble)])
    assert abs(q_ens - q_true) / q_true < 0.05, f"Posterior rate {q_ens:.3f} vs truth {q_true:.3f}"
    # Localized parameters get no process noise, so their spread must not grow
    assert enkf.ensemble[ia].std() <= prior_A_std + 1e-12
