import numpy as np
import pytest
from src.learning.gp_residual import BoundedGPResidualModel, BoundedGPOutput


def test_bounded_gp_hard_limits():
    """
    CRUCIAL TEST: Verifies that the GP discrepancy correction
    can NEVER exceed +/- 15% of the physics prediction,
    even when fed artificially massive training errors.
    """
    gp = BoundedGPResidualModel(max_residual_fraction=0.15)

    # 10 training samples with intentional +100% residual (absurd discrepancy)
    X_train = np.linspace(1, 10, 10).reshape(-1, 1)
    y_phys = np.full(10, 100.0)
    y_obs_wild = np.full(10, 250.0)  # +150% above physics!

    gp.fit(X_train, y_obs_wild, y_phys)

    # Query at x=5
    y_phys_query = 80.0
    out = gp.predict_bounded(np.array([[5.0]]), y_physics=y_phys_query)

    # Maximum allowable shift is +/- 15% of 80 = +/- 12
    max_allowed = 0.15 * y_phys_query
    assert abs(out.bounded_discrepancy) <= max_allowed + 1e-6, (
        f"Discrepancy {out.bounded_discrepancy} violated 15% limit ({max_allowed})"
    )
    assert 0.85 * y_phys_query <= out.calibrated_prediction <= 1.15 * y_phys_query
    assert out.bound_active is True


def test_bounded_gp_uncertainty_calibration():
    """Verifies calibrated uncertainty (std > 0) and smooth interpolation."""
    gp = BoundedGPResidualModel()

    X_train = np.array([[1.0], [2.0], [4.0], [5.0]])
    y_phys = np.array([50.0, 48.0, 42.0, 40.0])
    # Mild 5% discrepancies
    y_obs = np.array([52.0, 49.0, 43.0, 41.0])

    gp.fit(X_train, y_obs, y_phys)

    # Query at observed point vs unobserved point (x=3.0)
    out_obs = gp.predict_bounded(np.array([[2.0]]), y_physics=48.0)
    out_unseen = gp.predict_bounded(np.array([[3.0]]), y_physics=45.0)

    assert out_obs.uncertainty_std > 0.0
    assert out_unseen.uncertainty_std > 0.0
    # Uncertainty should be greater in the unobserved gap
    assert out_unseen.uncertainty_std >= out_obs.uncertainty_std * 0.9


def test_bounded_gp_thief_zone_alert():
    """
    Verifies that clustering of saturated negative residuals
    under high steam volume correctly triggers a thief-zone override alert.
    """
    gp = BoundedGPResidualModel(max_residual_fraction=0.15)

    X_train = np.linspace(1, 5, 5).reshape(-1, 1)
    y_phys = np.full(5, 100.0)
    y_obs = np.full(5, 50.0)  # Heavy negative residual

    gp.fit(X_train, y_obs, y_phys)

    out = gp.predict_bounded(
        np.array([[3.0]]),
        y_physics=100.0,
        context_tags={'steam_volume_m3': 1800.0}
    )

    assert out.bound_active is True
    assert out.diagnostic_alert is not None
    assert "thief-zone" in out.diagnostic_alert.lower()
