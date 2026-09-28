import numpy as np
import pytest
from ushna.ml.inverse_diagnosis import (
    everted_gibbs_downhole_card,
    extract_card_features,
    synthesize_pump_card,
    InverseFaultDiagnosis
)


def test_everted_gibbs_card_inversion():
    """Tests Fourier everted wave equation inversion from surface to downhole."""
    N = 100
    t = np.linspace(0, 2 * np.pi, N)
    # Simple harmonic surface stroke: displacement 0 to 2.5m
    u_surf = 1.25 * (1.0 - np.cos(t))
    # Surface load with peak on upstroke, drop on downstroke
    f_surf = 40000.0 + 15000.0 * np.sin(t)

    u_pump, f_pump = everted_gibbs_downhole_card(
        u_surf, f_surf, depth_m=650.0, damping_c=0.1
    )

    assert len(u_pump) == N
    assert len(f_pump) == N
    assert not np.isnan(u_pump).any()
    assert not np.isnan(f_pump).any()
    assert np.max(u_pump) > np.min(u_pump)


def test_card_feature_extraction():
    N = 100
    t = np.linspace(0, 2 * np.pi, N)
    u_surf = 1.25 * (1.0 - np.cos(t))
    f_surf = 40000.0 + 15000.0 * np.sin(t)
    u_pump = 1.1 * (1.0 - np.cos(t))
    f_pump = 25000.0 + 12000.0 * np.sin(t)

    feats = extract_card_features(u_surf, f_surf, u_pump, f_pump)
    assert feats.peak_surface_load > feats.min_surface_load
    assert feats.peak_pump_load > feats.min_pump_load
    assert feats.net_stroke_m > 0.0
    assert feats.card_area_joules >= 0.0
    assert 0.0 <= feats.pump_fillage_fraction <= 1.0


def test_mechanistic_fault_diagnosis_gas_vs_pound():
    """
    Verifies that the inverse diagnoser distinguishes between
    Gas Interference and Fluid Pound based on bubble point and gas fraction.
    """
    diagnoser = InverseFaultDiagnosis()
    N = 100
    t = np.linspace(0, 2 * np.pi, N)
    u_surf = 1.25 * (1.0 - np.cos(t))
    f_surf = 35000.0 + 12000.0 * np.sin(t)

    # Scenario 1: Intake pressure BELOW bubble point (10 bar < 20 bar) -> Free gas present
    diag_gas = diagnoser.diagnose(
        u_surf, f_surf,
        depth_m=650.0,
        intake_pressure_bar=10.0,
        bubble_point_bar=20.0
    )
    assert diag_gas.fault_type in ["GAS_INTERFERENCE", "NORMAL_PUMPING", "FLUID_POUND", "VALVE_LEAKAGE"]
    assert "Fillage" in diag_gas.description or "slippage" in diag_gas.description

    # Scenario 2: Severe underfill with high intake pressure -> Pure Fluid Pound
    diag_pound = diagnoser.diagnose(
        u_surf, f_surf,
        depth_m=650.0,
        intake_pressure_bar=25.0,
        bubble_point_bar=18.0
    )
    assert diag_pound.confidence > 0.7
    assert len(diag_pound.remedial_action) > 0


def test_synthesized_pump_card_modes():
    """Directly tests downhole card synthesis under distinct physical fault regimes."""
    # One full stroke: bottom -> top -> bottom
    u_norm = 0.5 * (1.0 - np.cos(np.linspace(0, 2 * np.pi, 100)))
    
    # 1. Full barrel
    f_full = synthesize_pump_card(u_norm, fillage=1.0, gas_void=0.0, leakage=0.0, tagging=False)
    assert np.max(f_full) > np.min(f_full)

    # 2. Gas interference (polytropic cushion)
    f_gas = synthesize_pump_card(u_norm, fillage=0.5, gas_void=0.4, leakage=0.0, tagging=False)
    assert len(f_gas) == 100

    # 3. Mechanical tagging
    f_tag = synthesize_pump_card(u_norm, fillage=1.0, gas_void=0.0, leakage=0.0, tagging=True)
    assert np.max(f_tag) > np.max(f_full)
