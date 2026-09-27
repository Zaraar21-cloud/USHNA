import numpy as np
import pytest
from src.learning.symbolic_regression import (
    SymbolicEquationDiscoverer,
    safe_div,
    safe_log,
    safe_exp,
    safe_pow
)


def test_safe_math_operators():
    """Verifies that protected operators do not raise ZeroDivisionError or domain errors."""
    zero_arr = np.zeros(5)
    ones_arr = np.ones(5)
    neg_arr = np.array([-1.0, -5.0, 0.0])

    div_res = safe_div(ones_arr, zero_arr)
    assert not np.isnan(div_res).any()
    assert not np.isinf(div_res).any()

    log_res = safe_log(neg_arr)
    assert not np.isnan(log_res).any()
    assert not np.isinf(log_res).any()

    exp_res = safe_exp(np.array([1000.0, -1000.0]))
    assert not np.isnan(exp_res).any()
    assert not np.isinf(exp_res).any()


def test_viscosity_law_discovery():
    """
    Tests discovering a closed-form viscosity correlation mu(T, asphaltene)
    from synthetic heavy-oil PVT data.
    """
    discoverer = SymbolicEquationDiscoverer(random_state=42)

    # Generate synthetic data with Walther law + asphaltene effect
    T = np.linspace(320.0, 500.0, 30)
    asp = np.random.uniform(5.0, 20.0, 30)
    # Synthetic viscosity
    rhs = 7.0393 - 2.5617 * np.log10(T) + 0.02 * asp
    mu_true = 0.95 * (10.0 ** (10.0 ** rhs) - 0.7)

    eq = discoverer.discover_viscosity_law(T, asp, mu_true)

    assert eq.target_name == "viscosity_mu"
    assert eq.r2_score > 0.85, f"Expected high R^2, got {eq.r2_score}"
    assert "log10(T)" in eq.equation_str
    assert "\\mu" in eq.latex_str
    assert len(eq.signoff_statement) > 0

    # Test evaluation
    pred = eq.eval_fn(350.0, 10.0)
    assert pred > 0.0


def test_soak_efficiency_discovery():
    discoverer = SymbolicEquationDiscoverer(random_state=42)

    t_soak = np.linspace(1.0, 14.0, 20)
    v_steam = np.linspace(800.0, 2500.0, 20)
    # True efficiency: (1 - exp(-0.8 * V/1000)) * exp(-0.05 * t)
    eta_true = (1.0 - np.exp(-0.8 * (v_steam / 1000.0))) * np.exp(-0.05 * t_soak)

    eq = discoverer.discover_soak_efficiency_relation(t_soak, v_steam, eta_true)

    assert eq.r2_score > 0.90
    assert "V_steam" in eq.equation_str
    assert "\\eta" in eq.latex_str


def test_rod_hazard_discovery():
    discoverer = SymbolicEquationDiscoverer(random_state=42)

    dF = np.linspace(20.0, 80.0, 20)
    tc = np.linspace(0.5, 4.0, 20)
    hazard_true = 0.05 * (dF / 100.0)**2.2 * (1.0 + 0.4 * tc)

    eq = discoverer.discover_rod_hazard_relation(dF, tc, hazard_true)

    assert eq.r2_score > 0.90
    assert "Hazard" in eq.equation_str
    assert "\\text{Hazard}" in eq.latex_str
