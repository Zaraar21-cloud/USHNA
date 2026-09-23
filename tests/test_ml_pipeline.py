import numpy as np
import pytest
from src.learning.pipeline import (
    USHNAPipeline,
    ExplainabilityCard,
    IncompleteExplainabilityCardError
)


def test_explainability_card_contract():
    """Verifies that explainability cards enforce the mandatory four elements."""
    card = ExplainabilityCard(
        well_id="BGW-07",
        timestamp="14:32",
        recommendation="Reduce SPM 6.2 -> 4.8; downstroke velocity -35%",
        why="Float Margin Index at 620 m has fallen to 0.08, below the 0.15 operating limit.",
        driver="Pump-intake temperature 58 °C -> 51 °C over the last 96 hours; mu risen 340 -> 890 cP.",
        governing_relation="(S*N)_max proportional to 1/mu — annular viscous drag vs buoyed rod weight.",
        expected_effect="-7% gross fluid; -31% peak compression load; rod fatigue life x2.1.",
        confidence="87%. EnKF posterior on mu: +/-120 cP.",
        cycle_status="Day 41 of production. Cut-off threshold projected at day 57 +/- 4."
    )
    assert card.validate() is True
    md = card.to_markdown()
    assert "RECOMMENDATION • Well BGW-07" in md
    assert "Float Margin Index" in md


def test_explainability_card_rejection_on_missing_field():
    """Ensures that incomplete cards lacking physics drivers/governing equations are rejected."""
    bad_card = ExplainabilityCard(
        well_id="BGW-07",
        timestamp="14:32",
        recommendation="Reduce SPM 6.2 -> 4.8",
        why="",  # Missing why!
        driver="Temperature dropped",
        governing_relation="",
        expected_effect="",
        confidence="90%",
        cycle_status="Day 10"
    )
    with pytest.raises(IncompleteExplainabilityCardError):
        bad_card.validate()


def test_pipeline_end_to_end_telemetry_processing():
    """
    Tests the complete end-to-end pipeline processing a live telemetry step.
    Verifies interaction between EnKF, GP residual, Inverse Diagnosis, FMI,
    and Explainability card generation.
    """
    pipeline = USHNAPipeline(well_id="BGW-07", seed=42)

    # Surface stroke telemetry
    N = 100
    t = np.linspace(0, 2 * np.pi, N)
    u_surf = 1.25 * (1.0 - np.cos(t))
    f_surf = 38000.0 + 14000.0 * np.sin(t)

    result = pipeline.process_telemetry_step(
        t_days=25.0,
        T_measured_K=380.0,
        q_measured_m3day=32.0,
        u_surf=u_surf,
        f_surf=f_surf,
        spm_current=6.2,
        stroke_length_m=2.5,
        intake_pressure_bar=14.0
    )

    assert result['step'] == 1
    assert result['t_days'] == 25.0
    assert 'fmi' in result
    assert 'mu_pump_cP' in result
    assert 'enkf_summary' in result
    assert 'card_diagnosis' in result
    assert 'explainability_card' in result

    # Check card
    card = result['explainability_card']
    assert card.well_id == "BGW-07"
    assert len(card.recommendation) > 0
    assert len(card.why) > 0
    assert len(card.driver) > 0
    assert len(card.governing_relation) > 0


def test_pipeline_fmi_rod_float_response():
    """
    Tests that cold reservoir temperature causing high viscosity
    drops the FMI below 0.15 and triggers an explicit recommendation
    to reduce SPM and downstroke velocity.
    """
    pipeline = USHNAPipeline(well_id="BGW-07", seed=42)

    N = 100
    t = np.linspace(0, 2 * np.pi, N)
    u_surf = 1.25 * (1.0 - np.cos(t))
    f_surf = 35000.0 + 10000.0 * np.sin(t)

    # Cold reservoir temperature (321 K ~ 48 C) -> High heavy oil viscosity ~940 cP
    result = pipeline.process_telemetry_step(
        t_days=65.0,
        T_measured_K=321.0,
        q_measured_m3day=8.0,
        u_surf=u_surf,
        f_surf=f_surf,
        spm_current=6.5,
        stroke_length_m=2.5,
        intake_pressure_bar=8.0
    )

    card = result['explainability_card']
    assert result['fmi'] < 0.15, "Expected cold well to breach FMI < 0.15"
    assert "Reduce SPM" in card.recommendation
    assert "Float Margin Index" in card.why
    assert "(S*N)_max proportional to 1/mu" in card.governing_relation
