import numpy as np
import pytest

from src.learning.pinn_training import (
    solve_cooling, enthalpy_gj, theta0, train_pinn, TrainConfig, TrainedPINN, energy_audit, HALF_PAY,
)


def test_solver_conserves_enthalpy_and_cools():
    sol = solve_cooling(16.0, nr=60, nz=40)
    E = [enthalpy_gj(th.astype(float), sol.cell_vol) for th in sol.theta]
    assert max(abs(e / E[0] - 1.0) for e in E) < 1e-6, "insulated boundaries: enthalpy is conserved"
    core = sol.theta[:, 0, 0]
    assert np.all(np.diff(core) <= 1e-7), "the hot core only cools"
    assert core[-1] < core[0] - 0.2


def test_short_training_learns_and_keeps_exact_initial_condition(tmp_path):
    pytest.importorskip("torch")
    cfg = TrainConfig(hidden=16, layers=2, iterations=150, n_colloc=256, n_bc=64,
                      train_rh=(12.0, 18.0), holdout_rh=(15.0,), log_every=50, val_every=150)
    res = train_pinn(cfg, verbose=False)
    model, hist = res['model'], res['model'].history
    assert hist[-1]['data'] < hist[0]['data'], "fitting the sensor data must reduce its loss"

    # Hard-constrained IC: at t = 0 the network returns theta0 exactly
    r = np.linspace(0.5, 50, 20)
    np.testing.assert_allclose(model.theta(r, 2.0, 0.0, 15.0), theta0(r, 2.0, 15.0), atol=1e-12)

    # Round trip through the saved weights
    path = str(tmp_path / "w.npz")
    model.save(path)
    again = TrainedPINN.load(path)
    np.testing.assert_allclose(again.theta(r, 3.0, 40.0, 15.0), model.theta(r, 3.0, 40.0, 15.0))

    # The audit is computed on the network's own field and reports a verdict
    audit = energy_audit(model, 15.0, res['holdout'][15.0])
    assert audit['days'][0] == 0 and abs(audit['pinn_imbalance_pct'][0]) < 1e-6
    assert isinstance(audit['passed'], bool)


def test_initial_condition_is_the_heated_cylinder():
    assert theta0(0.0, 0.0, 16.0) > 0.99
    assert theta0(40.0, 0.0, 16.0) < 1e-6
    assert theta0(0.0, HALF_PAY + 10, 16.0) < 1e-3
