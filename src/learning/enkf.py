"""
Ensemble Kalman Filter (EnKF) for USHNA Digital Twin.
Tier 1 of the Learning Layer (Section 5.1).

Continuously assimilates real-time well observations (flow rate, temperature,
pressures, loads) to update uncertain physical parameters:
- kh: Permeability-thickness (mD*m)
- s: Skin factor (dimensionless)
- k_ob: Overburden heat-loss conductivity (W/m K)
- c_rod: Rod damping coefficient (1/s)
- A, B: Walther viscosity equation coefficients
- eta_slip: Pump slippage/leakage fraction

The estimated parameters carry units, physical bounds, and posterior uncertainty bands.
A positive trend in skin factor is diagnosed as asphaltene deposition.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np

from src.physics.reservoir import boberg_lantz_temperature, radial_composite_inflow
from src.physics.viscosity import WaltherViscosityModel


@dataclass
class ParameterSpec:
    name: str
    unit: str
    nominal: float
    min_val: float
    max_val: float
    std_prior: float
    description: str


PARAM_SPECS: Dict[str, ParameterSpec] = {
    'kh': ParameterSpec('kh', 'mD*m', 15000.0, 1000.0, 60000.0, 3000.0, 'Permeability-thickness'),
    'skin': ParameterSpec('skin', '-', 2.0, 0.0, 25.0, 1.0, 'Wellbore skin factor'),
    'k_ob': ParameterSpec('k_ob', 'W/m K', 2.0, 0.5, 5.0, 0.4, 'Overburden thermal conductivity'),
    'c_rod': ParameterSpec('c_rod', '1/s', 0.1, 0.01, 1.0, 0.05, 'Rod damping coefficient'),
    # Walther is double-exponential: std 0.02 on A is ~+/-20% viscosity per sigma
    # (lab-PVT-fit level). 0.2 was ~10x per sigma and swamped the rate statistics.
    'A_visc': ParameterSpec('A_visc', '-', 7.0393, 6.5, 7.6, 0.02, 'Walther parameter A'),
    'B_visc': ParameterSpec('B_visc', '-', 2.5617, 2.2, 2.9, 0.01, 'Walther parameter B'),
    'eta_slip': ParameterSpec('eta_slip', 'fraction', 0.05, 0.0, 0.5, 0.02, 'Pump slippage fraction')
}


class EnsembleKalmanFilter:
    """
    Ensemble Kalman Filter for continuous data assimilation.
    Zero offline training required; maintains an ensemble of physical states
    and updates them with every incoming measurement.
    """

    def __init__(
        self,
        n_ensemble: int = 40,
        specs: Optional[Dict[str, ParameterSpec]] = None,
        seed: int = 42
    ):
        self.n_ensemble = n_ensemble
        self.specs = specs or PARAM_SPECS
        self.param_names = list(self.specs.keys())
        self.n_params = len(self.param_names)
        self.rng = np.random.default_rng(seed)

        # Initialize ensemble matrix: shape (n_params, n_ensemble)
        self.ensemble = np.zeros((self.n_params, self.n_ensemble))
        for i, (name, spec) in enumerate(self.specs.items()):
            samples = self.rng.normal(spec.nominal, spec.std_prior, size=self.n_ensemble)
            self.ensemble[i, :] = np.clip(samples, spec.min_val, spec.max_val)

        # Historical tracking of posterior estimates
        self.history: List[Dict[str, Dict[str, float]]] = []
        self.time_history: List[float] = []

    def get_state_summary(self) -> Dict[str, Dict[str, float]]:
        """Returns the mean, std, min, and max for each estimated parameter."""
        summary = {}
        for i, name in enumerate(self.param_names):
            values = self.ensemble[i, :]
            spec = self.specs[name]
            summary[name] = {
                'mean': float(np.mean(values)),
                'std': float(np.std(values)),
                'min': float(np.min(values)),
                'max': float(np.max(values)),
                'unit': spec.unit,
                'description': spec.description
            }
        return summary

    def forward_observation_operator(
        self,
        param_vector: np.ndarray,
        well_context: Dict[str, float]
    ) -> np.ndarray:
        """
        Runs the coupled physics core for an individual parameter vector
        to predict observable measurements: [T_res (K), q_oil (m^3/day)].
        
        well_context provides operating conditions:
        - t_days: production time elapsed
        - T_R: initial reservoir temp (K)
        - T_s: steam injection temp (K)
        - h: net pay thickness (m)
        - P_R_bar: average reservoir pressure (Pa)
        - P_wf: bottomhole flowing pressure (Pa)
        - r_h: radius of heated zone (m)
        - r_w: wellbore radius (m)
        - r_e: external drainage radius (m)
        - mu_cold: cold zone viscosity (cP)
        """
        # Unpack parameters
        kh = param_vector[0]
        skin = param_vector[1]
        k_ob = param_vector[2]
        c_rod = param_vector[3]
        A_visc = param_vector[4]
        B_visc = param_vector[5]
        eta_slip = param_vector[6]

        t_days = well_context.get('t_days', 10.0)
        T_R = well_context.get('T_R', 320.0)
        T_s = well_context.get('T_s', 550.0)
        h = well_context.get('h', 12.0)
        P_R_bar = well_context.get('P_R_bar', 5.0e6)
        P_wf = well_context.get('P_wf', 1.5e6)
        r_h = well_context.get('r_h', 25.0)
        r_w = well_context.get('r_w', 0.1)
        r_e = well_context.get('r_e', 200.0)
        mu_cold = well_context.get('mu_cold', 15000.0)

        # 1. Thermal decline via Boberg-Lantz with k_ob influencing cooling rate
        # Decay factor scales with overburden conductivity
        cooling_scale = (k_ob / 2.0)
        f_VD = np.exp(-0.015 * cooling_scale * t_days)
        f_HD = np.exp(-0.008 * cooling_scale * t_days)
        delta = 0.08 * (1.0 - np.exp(-0.04 * t_days))

        T_res = boberg_lantz_temperature(T_R, T_s, f_VD, f_HD, delta)

        # 2. Viscosity at heated zone temperature
        walther = WaltherViscosityModel(A=A_visc, B=B_visc)
        mu_hot = walther.dynamic_viscosity(T_res, density=0.95)

        # 3. Inflow performance (Radial Composite Inflow)
        # kh is mD*m -> convert to SI (m^3): 1 mD = 9.869233e-16 m^2
        k_m2 = (kh / h) * 9.869233e-16
        # Inflow equation expects viscosity in Pa*s (1 cP = 1e-3 Pa*s)
        mu_h_pas = max(mu_hot * 1e-3, 1e-4)
        mu_c_pas = max(mu_cold * 1e-3, 1e-2)

        q_inflow_m3s = radial_composite_inflow(
            k=k_m2,
            k_ro=0.85,
            h=h,
            P_R_bar=P_R_bar,
            P_wf=P_wf,
            mu_h=mu_h_pas,
            mu_c=mu_c_pas,
            r_h=r_h,
            r_w=r_w,
            r_e=r_e,
            s=skin
        )
        # Convert m^3/s to m^3/day
        q_theo_m3day = max(q_inflow_m3s * 86400.0, 0.0)
        
        # Effective surface production accounting for pump leakage/slippage
        q_surface = q_theo_m3day * (1.0 - eta_slip)

        return np.array([T_res, q_surface])

    def update(
        self,
        y_obs: np.ndarray,
        R_cov: np.ndarray,
        well_context: Dict[str, float],
        t_current: float,
        process_noise_std: float = 0.01,
        localization_mask: Optional[np.ndarray] = None
    ) -> Dict[str, Dict[str, float]]:
        """
        Assimilates observation y_obs = [T_obs, q_obs].
        R_cov: measurement error covariance matrix (2x2).
        process_noise_std: additive noise factor to prevent filter inbreeding.
        """
        y_obs = np.asarray(y_obs)
        n_obs = len(y_obs)

        # Physical covariance localization (Section 5.1):
        # Prevents spurious cross-updates on PVT (A, B) and rod mechanics (c)
        # when only assimilating macro temperature and flow rate
        if localization_mask is None:
            localization_mask = np.ones((self.n_params, n_obs))
            if n_obs == 2:
                # c_rod needs a dynamometer card; A_visc/B_visc are PVT invariants
                for name in ('c_rod', 'A_visc', 'B_visc'):
                    if name in self.param_names:
                        localization_mask[self.param_names.index(name), :] = 0.0

        # 1. Add process noise to parameters the observations can correct.
        # Noise on fully localized parameters would random-walk them unchecked.
        for i, name in enumerate(self.param_names):
            if not np.any(localization_mask[i]):
                continue
            spec = self.specs[name]
            dq = self.rng.normal(0, process_noise_std * spec.nominal, size=self.n_ensemble)
            self.ensemble[i, :] = np.clip(
                self.ensemble[i, :] + dq,
                spec.min_val,
                spec.max_val
            )

        # 2. Forward simulation for all ensemble members: H(x_j)
        Y_ens = np.zeros((n_obs, self.n_ensemble))
        for j in range(self.n_ensemble):
            Y_ens[:, j] = self.forward_observation_operator(
                self.ensemble[:, j],
                well_context
            )

        # 3. Compute ensemble anomalies
        x_mean = np.mean(self.ensemble, axis=1, keepdims=True)
        y_mean = np.mean(Y_ens, axis=1, keepdims=True)

        X_anomaly = self.ensemble - x_mean  # (n_params, n_ens)
        Y_anomaly = Y_ens - y_mean          # (n_obs, n_ens)

        # Covariance matrices
        C_yy = (Y_anomaly @ Y_anomaly.T) / (self.n_ensemble - 1)  # (n_obs, n_obs)
        C_xy = (X_anomaly @ Y_anomaly.T) / (self.n_ensemble - 1)  # (n_params, n_obs)

        # 4. Kalman Gain K = C_xy * (C_yy + R)^(-1)
        innovation_cov = C_yy + R_cov
        # Use pseudo-inverse or solve for numerical stability
        K_gain = C_xy @ np.linalg.pinv(innovation_cov)
        K_gain = K_gain * localization_mask

        # 5. Perturbed observations and state update
        # Generate perturbed observations: y_pert_j = y_obs + v_j, v_j ~ N(0, R)
        pert_noise = self.rng.multivariate_normal(
            np.zeros(n_obs), R_cov, size=self.n_ensemble
        ).T
        Y_perturbed = y_obs[:, None] + pert_noise

        # Innovation: (y_pert - H(x_j))
        innovations = Y_perturbed - Y_ens
        self.ensemble = self.ensemble + K_gain @ innovations

        # 6. Hard projection onto physical constraint box
        for i, name in enumerate(self.param_names):
            spec = self.specs[name]
            self.ensemble[i, :] = np.clip(
                self.ensemble[i, :],
                spec.min_val,
                spec.max_val
            )

        # 7. Record history
        summary = self.get_state_summary()
        self.history.append(summary)
        self.time_history.append(t_current)

        return summary

    def diagnose_well_health(self) -> Dict[str, str]:
        """
        Interprets parameter trends as physical well health diagnostics.
        Specifically monitors wellbore skin drift (asphaltene precipitation).
        """
        diagnostics = {}
        if len(self.history) < 3:
            return {'status': 'INSUFFICIENT_HISTORY', 'message': 'Filter initializing.'}

        # Check skin drift over last observations
        skin_history = [h['skin']['mean'] for h in self.history]
        skin_delta = skin_history[-1] - skin_history[0]
        recent_trend = skin_history[-1] - skin_history[-3]

        if skin_history[-1] > 6.0 and recent_trend > 0.5:
            diagnostics['asphaltene_alert'] = (
                f"HIGH RISK: Wellbore skin has risen to {skin_history[-1]:.2f} "
                f"(+{skin_delta:.2f} drift). Indicates near-wellbore asphaltene deposition. "
                f"Solvent wash or steam cycle recommended."
            )
        elif recent_trend > 0.2:
            diagnostics['asphaltene_alert'] = (
                f"MODERATE: Asphaltene skin drift detected (+{recent_trend:.2f} over recent steps). "
                f"Tracking permeability impairment."
            )
        else:
            diagnostics['asphaltene_alert'] = "NORMAL: Wellbore skin stable."

        # Check pump slippage
        slip = self.history[-1]['eta_slip']['mean']
        if slip > 0.25:
            diagnostics['pump_leakage_alert'] = (
                f"WARNING: Estimated pump slippage {slip*100:.1f}% indicates valve wear or fluid slip."
            )
        else:
            diagnostics['pump_leakage_alert'] = "NORMAL: Pump efficiency nominal."

        return diagnostics
