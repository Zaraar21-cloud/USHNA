import numpy as np
import pytest
from src.learning.pinn_surrogate import (
    AxisymmetricPINNSurrogate,
    EnergyAuditReport,
    EnergyAuditFailureError
)


def test_pinn_temperature_bounding():
    """Verifies that predicted temperatures strictly adhere to [T_R, T_s]."""
    pinn = AxisymmetricPINNSurrogate(r_w=0.1, r_max=50.0, h=12.0, T_R=320.0, T_s=550.0)

    # Grid of evaluation points
    r = np.array([0.1, 1.0, 10.0, 45.0])
    z = np.array([0.0, 3.0, 6.0, 12.0])
    t = np.array([100.0, 1000.0, 86400.0, 864000.0])

    T_pred = pinn.predict_temperature(r, z, t)

    assert len(T_pred) == 4
    assert np.all(T_pred >= 320.0), "Temperature cannot drop below initial reservoir temp"
    assert np.all(T_pred <= 550.0), "Temperature cannot exceed steam temperature"


def test_pinn_gradients_and_pde_residual():
    pinn = AxisymmetricPINNSurrogate()

    # Gradient check
    grads = pinn.compute_gradient(r=2.0, z=5.0, t_sec=3600.0)
    assert 'dT_dr' in grads
    assert 'dT_dz' in grads
    assert 'dT_dt' in grads
    assert not np.isnan(grads['dT_dr'])
    assert not np.isnan(grads['dT_dt'])

    # Collocation PDE residual check
    colloc = np.array([
        [1.0, 4.0, 1800.0],
        [3.0, 6.0, 7200.0],
        [5.0, 8.0, 14400.0]
    ])
    res = pinn.compute_pde_residual(colloc)
    assert res >= 0.0
    assert not np.isnan(res)


def test_pinn_energy_balance_audit_pass():
    """Verifies that a physically compliant surrogate passes the mandatory energy audit."""
    pinn = AxisymmetricPINNSurrogate()

    # Realistic injection parameters: 1 MW heat rate for 10 days, 3 days soak
    Q_steam = 1.0e6  # Watts
    t_inj = 10 * 86400.0
    t_soak = 3 * 86400.0

    report = pinn.audit_energy_balance(
        Q_steam_rate_watts=Q_steam,
        injection_time_sec=t_inj,
        soak_time_sec=t_soak,
        max_error_fraction=0.10
    )

    assert report.passed is True
    assert report.imbalance_percentage <= 10.0
    assert pinn.is_audited is True
    assert "PASSED" in report.audit_message


def test_pinn_energy_balance_audit_rejection():
    """
    MANDATORY AUDIT GATE TEST:
    Verifies that any surrogate violating the energy balance threshold
    is strictly rejected and raises EnergyAuditFailureError.
    """
    pinn = AxisymmetricPINNSurrogate()

    # Set strict threshold that cannot be satisfied by uncalibrated approximation
    with pytest.raises(EnergyAuditFailureError) as exc_info:
        pinn.audit_energy_balance(
            Q_steam_rate_watts=1.0e6,
            injection_time_sec=86400.0 * 5,
            soak_time_sec=86400.0 * 2,
            max_error_fraction=0.0001  # Absurdly tight 0.01% error limit
        )

    assert "REJECTED" in str(exc_info.value)
