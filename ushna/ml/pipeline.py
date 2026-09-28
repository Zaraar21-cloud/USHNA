"""
ML Pipeline Orchestrator & Explainability Interface for USHNA.
Integrates all five ML components:
1. Ensemble Kalman Filter (EnKF) - Real-time state assimilation
2. Inverse-Simulation Fault Diagnosis - Mechanistic pump card inversion
3. Bounded Gaussian Process Residual Model - Discrepancy correction bounded to +/-15%
4. Symbolic Regression Discoverer - Closed-form engineering equations
5. Physics-Informed Neural Network (PINN) Surrogate - Fast 2D thermal field

Every number on an ExplainabilityCard is computed from the current step:
confidence from EnKF ensemble agreement (or card-fit quality for pump faults),
cycle status from forward-marching each EnKF member to the rate cut-off.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

from ushna.ml.enkf import EnsembleKalmanFilter
from ushna.ml.inverse_diagnosis import InverseFaultDiagnosis, MechanisticDiagnosis
from ushna.ml.gp_residual import BoundedGPResidualModel, BoundedGPOutput
from ushna.ml.symbolic_regression import SymbolicEquationDiscoverer
from ushna.ml.pinn_surrogate import AxisymmetricPINNSurrogate
from ushna.physics.rod_string import float_margin_index
from ushna.physics.viscosity import WaltherViscosityModel


FMI_LIMIT = 0.15
OIL_DENSITY = 0.95  # g/cm^3

# Bottom rod section at risk of float/compression (Section 4.5 & Section 9)
W_BUOYANT_N = 3720.0   # Buoyed weight (N)
F_FRIC_N = 1790.0      # Mechanical friction (N)
D_TUBING_M = 0.076     # Tubing inner diameter (m)
D_ROD_M = 0.0254       # Rod outer diameter (m)

GOVERNING_RELATIONS = {
    'FMI': "(S*N)_max proportional to 1/mu — annular viscous drag vs buoyed rod weight.",
    'GAS_INTERFERENCE': "P_intake < P_bubble -> free gas in barrel; fillage = V_liquid / V_displaced.",
    'FLUID_POUND': "Pump displacement (proportional to S*N) > reservoir inflow -> incomplete fillage.",
    'VALVE_LEAKAGE': "q_surface = q_displaced * (1 - eta_slip).",
    'MECHANICAL_TAGGING': "Plunger contacts pump bottom when rod stretch + spacing < 0.",
}


class IncompleteExplainabilityCardError(Exception):
    """Raised when an explainability card is missing mandatory physics/audit fields."""
    pass


@dataclass
class ExplainabilityCard:
    well_id: str
    timestamp: str
    recommendation: str
    why: str
    driver: str
    governing_relation: str
    expected_effect: str
    confidence: str
    cycle_status: str

    def validate(self) -> bool:
        """Enforces the explainability contract: all fields must be non-empty."""
        for field_name in [
            'well_id', 'timestamp', 'recommendation', 'why', 'driver',
            'governing_relation', 'expected_effect', 'confidence', 'cycle_status'
        ]:
            val = getattr(self, field_name, None)
            if not val or not str(val).strip():
                raise IncompleteExplainabilityCardError(
                    f"Explainability Contract Violated: Field '{field_name}' cannot be empty."
                )
        return True

    def to_markdown(self) -> str:
        self.validate()
        return (
            f"### RECOMMENDATION • Well {self.well_id} • {self.timestamp}\n\n"
            f"**Action**: `{self.recommendation}`\n\n"
            f"| Element | Description |\n"
            f"| :--- | :--- |\n"
            f"| **Why** | {self.why} |\n"
            f"| **Driver** | {self.driver} |\n"
            f"| **Governing Relation** | `{self.governing_relation}` |\n"
            f"| **Expected Effect** | {self.expected_effect} |\n"
            f"| **Confidence** | {self.confidence} |\n"
            f"| **Cycle Status** | {self.cycle_status} |\n"
        )


class USHNAPipeline:
    """
    End-to-end ML Pipeline for USHNA Digital Twin.
    Unifies the five learning components into a cohesive, auditable system.
    """

    def __init__(
        self,
        well_id: str = "BGW-07",
        seed: int = 42,
        pump_depth_m: float = 650.0,
        bubble_point_bar: float = 18.0,
        q_cutoff_m3day: float = 5.0,
        forecast_horizon_days: int = 180
    ):
        self.well_id = well_id
        self.pump_depth_m = pump_depth_m
        self.bubble_point_bar = bubble_point_bar
        self.q_cutoff_m3day = q_cutoff_m3day  # Economic rate cut-off for the cycle
        self.forecast_horizon_days = forecast_horizon_days

        self.enkf = EnsembleKalmanFilter(n_ensemble=40, seed=seed)
        self.gp_residual = BoundedGPResidualModel(max_residual_fraction=0.15)
        self.inverse_diag = InverseFaultDiagnosis()
        self.symbolic = SymbolicEquationDiscoverer(random_state=seed)
        self.pinn = AxisymmetricPINNSurrogate(seed=seed)

        self.well_context = {
            'T_R': 320.0,
            'T_s': 550.0,
            'h': 12.0,
            'P_R_bar': 5.0e6,
            'P_wf': 1.5e6,
            'r_h': 25.0,
            'r_w': 0.1,
            'r_e': 200.0,
            'mu_cold': 15000.0
        }

        # GP training history: rows of [t_days, T_K], measured and physics rates
        self._gp_X: List[List[float]] = []
        self._gp_q_obs: List[float] = []
        self._gp_q_phys: List[float] = []

        # Operational telemetry state
        self.step_count = 0
        self.last_card: Optional[ExplainabilityCard] = None

    def _project_cutoff_days(self, t_now: float) -> np.ndarray:
        """
        Forward-marches every EnKF member's rate forecast and returns the day each
        member first drops below q_cutoff_m3day (members that never do are omitted).
        """
        days = np.arange(np.floor(t_now) + 1.0, t_now + self.forecast_horizon_days + 1.0)
        crossings = []
        for j in range(self.enkf.n_ensemble):
            member = self.enkf.ensemble[:, j]
            for d in days:
                q = self.enkf.forward_observation_operator(member, {**self.well_context, 't_days': d})[1]
                if q < self.q_cutoff_m3day:
                    crossings.append(d)
                    break
        return np.array(crossings)

    def _cycle_status(self, t_days: float, q_measured: float, gp_out: BoundedGPOutput) -> str:
        head = f"Day {int(t_days)} of production."
        if gp_out.bound_active:
            # Physics model can't reproduce the measured rate; a forecast from it would be fiction
            return (
                f"{head} Cut-off projection withheld: physics rate {gp_out.physics_prediction:.1f} m3/d "
                f"vs measured {q_measured:.1f} m3/d exceeds the GP residual bound; recalibrate first."
            )
        crossings = self._project_cutoff_days(t_days)
        frac = len(crossings) / self.enkf.n_ensemble
        if frac < 0.5:
            return (
                f"{head} No rate cut-off (< {self.q_cutoff_m3day:.1f} m3/d) projected within "
                f"{self.forecast_horizon_days} days for {1 - frac:.0%} of the EnKF ensemble."
            )
        p10, p50, p90 = np.percentile(crossings, [10, 50, 90])
        return (
            f"{head} Rate cut-off (< {self.q_cutoff_m3day:.1f} m3/d) projected at day {p50:.0f} "
            f"(P10-P90: {p10:.0f}-{p90:.0f}; {frac:.0%} of ensemble)."
        )

    def process_telemetry_step(
        self,
        t_days: float,
        T_measured_K: float,
        q_measured_m3day: float,
        u_surf: np.ndarray,
        f_surf: np.ndarray,
        spm_current: float = 6.2,
        stroke_length_m: float = 2.5,
        intake_pressure_bar: float = 12.0
    ) -> Dict[str, Any]:
        """
        Processes one telemetry update cycle:
        1. Assimilates T and q via EnKF
        2. Refits and evaluates the Bounded GP residual on all telemetry so far
        3. Diagnoses downhole pump card mechanistically
        4. Calculates Float Margin Index (FMI) for the estimate and every EnKF member
        5. Emits complete ExplainabilityCard
        """
        self.step_count += 1
        now_str = datetime.now().strftime("%H:%M")
        well_context = {**self.well_context, 't_days': t_days}

        # 1. EnKF Step
        y_obs = np.array([T_measured_K, q_measured_m3day])
        # Measurement noise covariance R (e.g. 1.5 K std, 0.5 m3/day std)
        R_cov = np.diag([1.5**2, 0.5**2])
        enkf_summary = self.enkf.update(y_obs, R_cov, well_context, t_current=t_days)
        enkf_diag = self.enkf.diagnose_well_health()

        # Viscosity at pump intake: point estimate from posterior mean, spread from ensemble
        names = self.enkf.param_names
        A_est = enkf_summary['A_visc']['mean']
        B_est = enkf_summary['B_visc']['mean']
        mu_pump_cP = float(WaltherViscosityModel(A=A_est, B=B_est).dynamic_viscosity(T_measured_K, density=OIL_DENSITY))
        mu_ens_cP = WaltherViscosityModel(
            A=self.enkf.ensemble[names.index('A_visc')],
            B=self.enkf.ensemble[names.index('B_visc')]
        ).dynamic_viscosity(T_measured_K, density=OIL_DENSITY)
        # Walther is double-exponential in (A, B): report a percentile band, not a std
        mu_p10, mu_p90 = np.percentile(mu_ens_cP, [10, 90])
        mu_band = f"EnKF posterior on mu (P10-P90): {mu_p10:.3g}-{mu_p90:.3g} cP."

        # 2. GP Residual: accumulate (measured vs physics) rate and refit on full history
        physics_pred = self.enkf.forward_observation_operator(
            np.array([enkf_summary[n]['mean'] for n in names]),
            well_context
        )
        q_phys = physics_pred[1]
        self._gp_X.append([t_days, T_measured_K])
        self._gp_q_obs.append(q_measured_m3day)
        self._gp_q_phys.append(q_phys)
        self.gp_residual.fit(np.array(self._gp_X), np.array(self._gp_q_obs), np.array(self._gp_q_phys))

        gp_out = self.gp_residual.predict_bounded(
            X_query=np.array([[t_days, T_measured_K]]),
            y_physics=q_phys,
            context_tags={'steam_volume_m3': 1200.0}
        )

        # 3. Mechanistic Fault Diagnosis
        card_diag = self.inverse_diag.diagnose(
            u_surf, f_surf, depth_m=self.pump_depth_m,
            intake_pressure_bar=intake_pressure_bar,
            bubble_point_bar=self.bubble_point_bar,
            spm=spm_current
        )

        # 4. Float Margin Index at pump depth; mean downstroke rod speed = 2*S*N/60
        v_downstroke = 2.0 * stroke_length_m * spm_current / 60.0

        def fmi_at(mu_cP, v_rod):
            return float_margin_index(
                W_buoyant=W_BUOYANT_N, mu=mu_cP * 1e-3, v_rod=v_rod,
                D_t=D_TUBING_M, D_r=D_ROD_M, F_fric=F_FRIC_N, length=self.pump_depth_m
            )

        fmi = float(fmi_at(mu_pump_cP, v_downstroke))
        fmi_ens = fmi_at(mu_ens_cP, v_downstroke)
        breach = fmi < FMI_LIMIT
        ensemble_agreement = float(np.mean((fmi_ens < FMI_LIMIT) == breach))
        confidence_fmi = (
            f"{ensemble_agreement:.0%} of EnKF ensemble members agree FMI "
            f"{'<' if breach else '>='} {FMI_LIMIT}. {mu_band}"
        )
        confidence_card = (
            f"{card_diag.confidence:.0%} card-fit quality (RMSE {card_diag.fitted_card_rmse:.0f} N). {mu_band}"
        )

        # 5. Formulate Explainability Card
        fault = card_diag.fault_type
        governing_rel = GOVERNING_RELATIONS.get(fault, GOVERNING_RELATIONS['FMI'])
        confidence = confidence_card

        if breach:
            governing_rel = GOVERNING_RELATIONS['FMI']
            confidence = confidence_fmi
            why = (
                f"Float Margin Index at pump depth ({self.pump_depth_m:.0f} m) has fallen to "
                f"{fmi:.2f}, below the {FMI_LIMIT} operating limit."
            )
            # FMI is linear in rod speed: solve FMI(v_max) = FMI_LIMIT for the fastest safe SPM
            drag_per_speed = (fmi_at(mu_pump_cP, 1.0) - fmi_at(mu_pump_cP, 0.0)) * -W_BUOYANT_N
            v_max = (W_BUOYANT_N * (1.0 - FMI_LIMIT) - F_FRIC_N) / drag_per_speed
            spm_max = np.floor(v_max * 60.0 / (2.0 * stroke_length_m) * 10.0) / 10.0
            if spm_max >= 1.0:
                rec_spm = min(spm_max, spm_current)
                change_pct = (rec_spm / spm_current - 1.0) * 100.0
                fmi_new = float(fmi_at(mu_pump_cP, 2.0 * stroke_length_m * rec_spm / 60.0))
                recommendation = (
                    f"Reduce SPM {spm_current:.1f} -> {rec_spm:.1f}; downstroke velocity {change_pct:.0f}%"
                )
                expected_effect = (
                    f"{change_pct:.0f}% gross fluid (displacement proportional to SPM); "
                    f"FMI {fmi:.2f} -> {fmi_new:.2f}; restores rod-float margin."
                )
            else:
                recommendation = (
                    "Reduce SPM alone cannot restore FMI (needs < 1 SPM); heat or dilute the "
                    "produced fluid to cut viscosity"
                )
                expected_effect = f"FMI stays at {fmi:.2f} until viscosity ({mu_pump_cP:.0f} cP) is reduced."
        elif fault == "GAS_INTERFERENCE":
            recommendation = (
                f"Raise pump intake pressure by {self.bubble_point_bar - intake_pressure_bar:.1f} bar "
                f"(casing backpressure / submergence) to reach bubble point; maintain SPM"
            )
            why = card_diag.description
            fill = max(card_diag.fillage_pct, 1.0)
            expected_effect = (
                f"Pump fillage {fill:.0f}%; suppressing free gas recovers up to "
                f"+{(100.0 / fill - 1.0) * 100.0:.0f}% volumetric efficiency."
            )
        elif fault == "FLUID_POUND":
            rec_spm = spm_current * card_diag.fillage_pct / 100.0
            recommendation = f"Reduce SPM {spm_current:.1f} -> {rec_spm:.1f} to match reservoir inflow"
            why = card_diag.description
            expected_effect = (
                f"Pump displacement matched to inflow (fillage {card_diag.fillage_pct:.0f}% -> ~100%); "
                f"eliminates downstroke fluid-pound impact."
            )
        elif fault == "VALVE_LEAKAGE":
            recommendation = card_diag.remedial_action
            why = card_diag.description
            expected_effect = f"Recovers the ~{card_diag.leakage_pct:.0f}% of displacement lost to valve slippage."
        elif fault == "MECHANICAL_TAGGING":
            recommendation = card_diag.remedial_action
            why = card_diag.description
            expected_effect = "Removes bottom-of-stroke impact loads on the rod string and pump."
        else:
            governing_rel = GOVERNING_RELATIONS['FMI']
            confidence = confidence_fmi
            recommendation = f"Maintain SPM {spm_current:.1f}; operating envelope nominal"
            why = (
                f"Float Margin Index {fmi:.2f} above the {FMI_LIMIT} limit; "
                f"pump fillage {card_diag.fillage_pct:.0f}%."
            )
            expected_effect = "Continued production without rod float risk."

        driver = (
            f"Pump-intake temp {T_measured_K - 273.15:.1f} °C; "
            f"viscosity mu estimated at {mu_pump_cP:.0f} cP."
        )
        if enkf_diag.get('asphaltene_alert', '').startswith('HIGH'):
            driver += f" Asphaltene skin drift detected (skin={enkf_summary['skin']['mean']:.1f})."

        card = ExplainabilityCard(
            well_id=self.well_id,
            timestamp=now_str,
            recommendation=recommendation,
            why=why,
            driver=driver,
            governing_relation=governing_rel,
            expected_effect=expected_effect,
            confidence=confidence,
            cycle_status=self._cycle_status(t_days, q_measured_m3day, gp_out)
        )
        card.validate()
        self.last_card = card

        return {
            'step': self.step_count,
            't_days': t_days,
            'fmi': fmi,
            'mu_pump_cP': mu_pump_cP,
            'enkf_summary': enkf_summary,
            'gp_output': gp_out,
            'card_diagnosis': card_diag,
            'explainability_card': card
        }
