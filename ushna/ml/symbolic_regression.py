"""
Symbolic Regression Engine for USHNA.
Tier 4 of the Learning Layer (Section 5.4).

The "Anti-Black-Box" Component.
Fits the coefficients of fixed, physics-motivated closed-form templates:
1. Field-specific viscosity law: mu(T, asphaltene)
2. Soak-time thermal efficiency: eta(t_soak, V_steam)
3. Rod-failure hazard expression: H(delta_F, t_comp)

The equation *forms* are chosen by hand; only their coefficients are learned.
Free-form structure search (e.g. PySR, listed in requirements.txt) is not done here.
Outputs printable equations with units and fit metrics for engineering review.
"""

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple, Union
import numpy as np
from scipy.optimize import curve_fit, minimize


@dataclass
class DiscoveredEquation:
    target_name: str
    equation_str: str
    latex_str: str
    variable_units: Dict[str, str]
    r2_score: float
    rmse: float
    complexity: int
    eval_fn: Callable[..., Union[float, np.ndarray]]
    signoff_statement: str


def safe_div(a: np.ndarray, b: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    return a / (b + np.sign(b + 1e-12) * eps)

def safe_log(a: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    return np.log(np.maximum(np.abs(a), eps))

def safe_exp(a: np.ndarray, max_val: float = 50.0) -> np.ndarray:
    return np.exp(np.clip(a, -max_val, max_val))

def safe_pow(a: np.ndarray, p: float) -> np.ndarray:
    return np.abs(a) ** p


class SymbolicEquationDiscoverer:
    """
    Parsimonious equation discovery engine for petroleum engineering relationships.
    Balancing accuracy (R^2, RMSE) against algebraic complexity to yield
    human-verifiable closed-form correlations.
    """

    def __init__(self, random_state: int = 42):
        self.rng = np.random.default_rng(random_state)

    def discover_viscosity_law(
        self,
        T_kelvin: np.ndarray,
        asphaltene_wt_pct: np.ndarray,
        viscosity_cP: np.ndarray
    ) -> DiscoveredEquation:
        """
        Discovers closed-form viscosity correlation: mu(T, asphaltene)
        Grounds in ASTM D341 Walther law with asphaltene multiplier:
        log10(log10(v + 0.7)) = A - B * log10(T) + C * asphaltene^D
        """
        T = np.asarray(T_kelvin, dtype=float)
        asp = np.asarray(asphaltene_wt_pct, dtype=float)
        mu = np.asarray(viscosity_cP, dtype=float)

        # Walther transformation target: z = log10(log10(mu / 0.95 + 0.7))
        v_cSt = np.maximum(mu / 0.95, 0.1)
        z = np.log10(np.log10(v_cSt + 0.7))

        # Model: z = A - B * log10(T) + C * asp
        # Linear in [1, -log10(T), asp]
        log_T = np.log10(T)
        X = np.column_stack([np.ones_like(T), -log_T, asp])

        # Least squares solve
        theta, residuals, rank, s = np.linalg.lstsq(X, z, rcond=None)
        A_val, B_val, C_val = theta

        # Refine nonlinear parameters with curve_fit:
        # mu = 0.95 * (10^(10^(A - B*log10(T) + C*asp^gamma)) - 0.7)
        def func(coords, A, B, C, gamma):
            t_k, a_pct = coords
            rhs = A - B * np.log10(t_k) + C * (a_pct ** gamma)
            # Upper clip 2.47: 10**(10**2.47) ~ 1e295, below float64 overflow (~1.8e308)
            kin = 10.0 ** (10.0 ** np.clip(rhs, -0.5, 2.47)) - 0.7
            return 0.95 * kin

        try:
            popt, _ = curve_fit(
                func,
                (T, asp),
                mu,
                p0=[A_val, B_val, max(C_val, 1e-4), 1.0],
                bounds=([5.0, 1.5, 0.0, 0.5], [12.0, 5.0, 0.5, 2.5]),
                maxfev=2000
            )
            A_f, B_f, C_f, gamma_f = popt
        except Exception:
            A_f, B_f, C_f, gamma_f = A_val, B_val, C_val, 1.0

        # Prediction & metrics
        mu_pred = func((T, asp), A_f, B_f, C_f, gamma_f)
        ss_res = np.sum((mu - mu_pred)**2)
        ss_tot = np.sum((mu - np.mean(mu))**2)
        r2 = 1.0 - (ss_res / max(ss_tot, 1e-9))
        rmse = np.sqrt(np.mean((mu - mu_pred)**2))

        eq_str = (
            f"mu(T, asp) = 0.95 * (10^(10^({A_f:.3f} - {B_f:.3f}*log10(T) + {C_f:.4f}*asp^{gamma_f:.2f})) - 0.7)"
        )
        latex_str = (
            r"\mu(T, \text{asp}) = 0.95 \cdot \left[ 10^{10^{"
            + f"{A_f:.3f} - {B_f:.3f}\\log_{{10}}(T) + {C_f:.4f} \\cdot \\text{{asp}}^{{{gamma_f:.2f}}}"
            + r"}} - 0.7 \right]"
        )

        def eval_fn(t_in, asp_in):
            return func((np.asarray(t_in), np.asarray(asp_in)), A_f, B_f, C_f, gamma_f)

        return DiscoveredEquation(
            target_name="viscosity_mu",
            equation_str=eq_str,
            latex_str=latex_str,
            variable_units={'T': 'K', 'asp': 'wt%', 'mu': 'cP'},
            r2_score=float(r2),
            rmse=float(rmse),
            complexity=8,
            eval_fn=eval_fn,
            signoff_statement=(
                f"Fixed-form fit: viscosity data fits modified Walther law with "
                f"R^2 = {r2:.4f}. Asphaltene sensitivity exponent = {gamma_f:.2f}."
            )
        )

    def discover_soak_efficiency_relation(
        self,
        t_soak_days: np.ndarray,
        V_steam_m3: np.ndarray,
        efficiency_eta: np.ndarray
    ) -> DiscoveredEquation:
        """
        Discovers soak thermal efficiency relation:
        eta(t_soak, V_steam) = (1 - exp(-k1 * V_steam / 1000)) * exp(-k2 * t_soak)
        Capturing the tradeoff: more steam increases heated radius, but longer soak
        conductively dissipates enthalpy into over/underburden.
        """
        t = np.asarray(t_soak_days, dtype=float)
        v = np.asarray(V_steam_m3, dtype=float)
        y = np.asarray(efficiency_eta, dtype=float)

        def model(coords, k1, k2, alpha):
            t_s, v_s = coords
            return (1.0 - np.exp(-k1 * (v_s / 1000.0)**alpha)) * np.exp(-k2 * t_s)

        popt, _ = curve_fit(
            model,
            (t, v),
            y,
            p0=[0.8, 0.05, 1.0],
            bounds=([0.01, 0.001, 0.2], [5.0, 0.5, 2.0]),
            maxfev=2000
        )
        k1, k2, alpha = popt

        y_pred = model((t, v), k1, k2, alpha)
        ss_res = np.sum((y - y_pred)**2)
        ss_tot = np.sum((y - np.mean(y))**2)
        r2 = 1.0 - (ss_res / max(ss_tot, 1e-9))
        rmse = np.sqrt(np.mean((y - y_pred)**2))

        eq_str = f"eta(t_soak, V_steam) = (1 - exp(-{k1:.3f} * (V_steam/1000)^{alpha:.2f})) * exp(-{k2:.4f} * t_soak)"
        latex_str = (
            f"\\eta(t_{{\\text{{soak}}}}, V_{{\\text{{steam}}}}) = "
            f"\\left(1 - e^{{-{k1:.3f} (V_{{\\text{{steam}}}}/1000)^{{{alpha:.2f}}}}} \\right) "
            f"e^{{-{k2:.4f} t_{{\\text{{soak}}}}}}"
        )

        def eval_fn(t_in, v_in):
            return model((np.asarray(t_in), np.asarray(v_in)), k1, k2, alpha)

        return DiscoveredEquation(
            target_name="soak_efficiency_eta",
            equation_str=eq_str,
            latex_str=latex_str,
            variable_units={'t_soak': 'days', 'V_steam': 'm^3', 'eta': 'fraction'},
            r2_score=float(r2),
            rmse=float(rmse),
            complexity=6,
            eval_fn=eval_fn,
            signoff_statement=(
                f"Soak Thermal Retention: Enthalpy recovery decays at rate of {k2*100:.2f}%/day. "
                f"R^2 = {r2:.4f}."
            )
        )

    def discover_rod_hazard_relation(
        self,
        delta_F_load_range_kN: np.ndarray,
        t_comp_duration_sec: np.ndarray,
        hazard_index: np.ndarray
    ) -> DiscoveredEquation:
        """
        Discovers rod failure hazard relation:
        H(delta_F, t_comp) = c1 * (delta_F / 100)^beta * (1 + c2 * t_comp)
        Based on Modified Goodman fatigue combined with Lubinski compression buckling risk.
        """
        dF = np.asarray(delta_F_load_range_kN, dtype=float)
        tc = np.asarray(t_comp_duration_sec, dtype=float)
        h = np.asarray(hazard_index, dtype=float)

        def hazard_model(coords, c1, beta, c2):
            load_rng, comp_t = coords
            return c1 * (load_rng / 100.0)**beta * (1.0 + c2 * comp_t)

        popt, _ = curve_fit(
            hazard_model,
            (dF, tc),
            h,
            p0=[0.1, 2.0, 0.5],
            bounds=([0.001, 1.0, 0.0], [5.0, 4.0, 5.0]),
            maxfev=2000
        )
        c1, beta, c2 = popt

        h_pred = hazard_model((dF, tc), c1, beta, c2)
        ss_res = np.sum((h - h_pred)**2)
        ss_tot = np.sum((h - np.mean(h))**2)
        r2 = 1.0 - (ss_res / max(ss_tot, 1e-9))
        rmse = np.sqrt(np.mean((h - h_pred)**2))

        eq_str = f"Hazard(dF, tc) = {c1:.4f} * (dF/100)^{beta:.2f} * (1 + {c2:.3f} * tc)"
        latex_str = (
            f"\\text{{Hazard}}(\\Delta F, t_{{\\text{{comp}}}}) = "
            f"{c1:.4f} \\left(\\frac{{\\Delta F}}{{100}}\\right)^{{{beta:.2f}}} "
            f"\\left(1 + {c2:.3f} t_{{\\text{{comp}}}}\\right)"
        )

        def eval_fn(df_in, tc_in):
            return hazard_model((np.asarray(df_in), np.asarray(tc_in)), c1, beta, c2)

        return DiscoveredEquation(
            target_name="rod_failure_hazard",
            equation_str=eq_str,
            latex_str=latex_str,
            variable_units={'dF': 'kN', 'tc': 's', 'Hazard': 'fractional risk/cycle'},
            r2_score=float(r2),
            rmse=float(rmse),
            complexity=6,
            eval_fn=eval_fn,
            signoff_statement=(
                f"Rod Failure Law: Modified Goodman exponent = {beta:.2f}. "
                f"Compression buckling increases fatigue rate by {c2*100:.1f}% per second in compression. "
                f"R^2 = {r2:.4f}."
            )
        )
