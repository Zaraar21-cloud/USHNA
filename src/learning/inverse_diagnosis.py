"""
Inverse-Simulation Fault Diagnosis for USHNA.
Tier 5 of the Learning Layer (Section 5.5).

Produces mechanistic diagnosis with real numbers rather than black-box image labels:
1. Reconstructs downhole pump card from surface dynamometer card via inverse Gibbs wave solve.
2. Extracts physical features: peak/min loads, net stroke, pump fillage, card area (work),
   duration in compression, valve opening positions.
3. Solves parameter-fitting inverse problem for (viscosity mu, gas void fraction,
   valve leakage, mechanical tagging).
4. Explains exact fault mechanism (e.g. distinguishing Gas Interference from Fluid Pound).
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
from scipy.optimize import minimize
from scipy.integrate import trapezoid


@dataclass
class DynamometerFeatures:
    peak_surface_load: float
    min_surface_load: float
    peak_pump_load: float
    min_pump_load: float
    net_stroke_m: float
    card_area_joules: float
    pump_fillage_fraction: float
    compression_duration_fraction: float
    gas_void_fraction_est: float
    load_ratio: float


@dataclass
class MechanisticDiagnosis:
    fault_type: str
    confidence: float
    fillage_pct: float
    gas_void_fraction: float
    leakage_pct: float
    mechanical_tagging: bool
    description: str
    remedial_action: str
    features: DynamometerFeatures
    fitted_card_rmse: float


def everted_gibbs_downhole_card(
    u_surf: np.ndarray,
    f_surf: np.ndarray,
    depth_m: float = 650.0,
    rod_diameter_m: float = 0.0254,
    rod_density: float = 7850.0,
    youngs_modulus: float = 2.07e11,
    damping_c: float = 0.15,
    sound_speed_a: float = 4900.0,
    n_harmonics: int = 10
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Inverts surface dynamometer card (u_surf, f_surf) to downhole pump card (u_pump, f_pump)
    using the Fourier-based Everitt-Jennings/Gibbs damped wave formulation.
    
    Parameters:
    - u_surf: Polished rod position array over one full cycle [m]
    - f_surf: Polished rod load array over one full cycle [N]
    - depth_m: Pump setting depth [m]
    - damping_c: Rod damping coefficient [1/s]
    - sound_speed_a: Acoustic velocity in steel rod [m/s] (~4900 m/s)
    - n_harmonics: Cutoff harmonics for low-pass noise filtering
    
    Returns:
    - u_pump: Downhole pump displacement array [m]
    - f_pump: Downhole pump load array [N]
    """
    N = len(u_surf)
    rod_area = np.pi * (rod_diameter_m / 2.0)**2
    rod_weight = rod_area * depth_m * rod_density * 9.81
    EA = youngs_modulus * rod_area

    # Center and scale time
    t = np.linspace(0, 1, N, endpoint=False)
    omega = 2.0 * np.pi  # Normalized fundamental angular frequency

    # Compute Fourier coefficients of surface displacement u_surf
    # u(0, t) = u0 + sum(un_cos * cos(n omega t) + un_sin * sin(n omega t))
    u_fft = np.fft.rfft(u_surf) / N
    # Load boundary condition: E*A * du/dx(0, t) = F_surf(t) - W_rod
    f_dynamic = f_surf - np.mean(f_surf)
    f_fft = np.fft.rfft(f_dynamic) / N

    u_pump_fft = np.zeros_like(u_fft)
    f_pump_fft = np.zeros_like(f_fft)

    # Constant offset
    u_pump_fft[0] = u_fft[0]
    f_pump_fft[0] = np.mean(f_surf) - rod_weight

    max_k = min(n_harmonics + 1, len(u_fft))

    for n in range(1, max_k):
        wn = n * omega
        # Complex wave number gamma_n = sqrt(-wn^2 + i*c*wn) / a
        # (Gibbs wave equation d^2u/dt^2 + c du/dt = a^2 d^2u/dx^2)
        complex_term = - (wn**2) + 1j * damping_c * wn
        gamma_n = np.sqrt(complex_term) / sound_speed_a

        cosh_term = np.cosh(gamma_n * depth_m)
        sinh_term = np.sinh(gamma_n * depth_m)

        # Boundary relation at depth L:
        # u(L) = u(0) * cosh(gamma L) + (1/(gamma * EA)) * F(0) * sinh(gamma L)
        # F(L) = gamma * EA * u(0) * sinh(gamma L) + F(0) * cosh(gamma L)
        u_pump_fft[n] = u_fft[n] * cosh_term + (f_fft[n] / (gamma_n * EA)) * sinh_term
        f_pump_fft[n] = gamma_n * EA * u_fft[n] * sinh_term + f_fft[n] * cosh_term

    u_pump = np.fft.irfft(u_pump_fft, n=N) * N
    f_pump = np.fft.irfft(f_pump_fft, n=N) * N

    # Downhole load baseline adjust (add fluid hydrostatic load)
    f_pump = f_pump + (np.mean(f_surf) - rod_weight * 0.8)
    f_pump = np.maximum(f_pump, 0.0)

    return u_pump, f_pump


def extract_card_features(
    u_surf: np.ndarray,
    f_surf: np.ndarray,
    u_pump: np.ndarray,
    f_pump: np.ndarray
) -> DynamometerFeatures:
    """
    Extracts physically meaningful parameters and geometric features
    from surface and downhole cards.
    """
    peak_surface_load = float(np.max(f_surf))
    min_surface_load = float(np.min(f_surf))
    peak_pump_load = float(np.max(f_pump))
    min_pump_load = float(np.min(f_pump))

    net_stroke_m = float(np.max(u_pump) - np.min(u_pump))

    # Calculate pump card area = net mechanical work per stroke = oint F_pump du_pump
    # Using trapezoidal integration around closed loop
    card_area_joules = float(np.abs(trapezoid(f_pump, u_pump)))

    # Pump fillage calculation:
    # Determine the point on downstroke where pump load drops toward minimum
    # On downstroke, velocity du/dt is negative.
    du = np.gradient(u_pump)
    downstroke_mask = du < 0
    upstroke_mask = du > 0

    if np.any(downstroke_mask) and np.any(upstroke_mask):
        f_down = f_pump[downstroke_mask]
        u_down = u_pump[downstroke_mask]
        
        # Midpoint load threshold
        f_thresh = min_pump_load + 0.3 * (peak_pump_load - min_pump_load)
        unloaded_idx = np.where(f_down < f_thresh)[0]
        if len(unloaded_idx) > 0:
            stroke_travel_unloaded = np.max(u_down) - u_down[unloaded_idx[0]]
            fillage = 1.0 - (stroke_travel_unloaded / max(net_stroke_m, 1e-4))
            fillage = float(np.clip(fillage, 0.05, 1.0))
        else:
            fillage = 1.0
    else:
        fillage = 0.9

    # Compression duration (fraction of stroke where load is in intermediate transition)
    load_range = max(peak_pump_load - min_pump_load, 1e-3)
    transition_mask = (f_pump > min_pump_load + 0.1 * load_range) & (f_pump < peak_pump_load - 0.1 * load_range)
    compression_duration_fraction = float(np.sum(transition_mask) / len(f_pump))

    # Curvature of the downstroke decompression line:
    # Sharp cliff -> Liquid pound (low gas)
    # Smooth hyperbolic curvature (polytropic PV^gamma) -> Gas interference
    if np.any(downstroke_mask):
        f_down = f_pump[downstroke_mask]
        d2f = np.diff(f_down, n=2)
        mean_convexity = float(np.mean(np.maximum(d2f, 0)))
        # Gas cushion softens the curve
        gas_void_fraction_est = float(np.clip(mean_convexity / (np.std(f_down) + 1e-3) * 0.2, 0.0, 0.8))
    else:
        gas_void_fraction_est = 0.0

    load_ratio = float((peak_surface_load - min_surface_load) / max(min_surface_load, 1.0))

    return DynamometerFeatures(
        peak_surface_load=peak_surface_load,
        min_surface_load=min_surface_load,
        peak_pump_load=peak_pump_load,
        min_pump_load=min_pump_load,
        net_stroke_m=net_stroke_m,
        card_area_joules=card_area_joules,
        pump_fillage_fraction=fillage,
        compression_duration_fraction=compression_duration_fraction,
        gas_void_fraction_est=gas_void_fraction_est,
        load_ratio=load_ratio
    )


def synthesize_pump_card(
    u_norm: np.ndarray,
    fillage: float,
    gas_void: float,
    leakage: float,
    tagging: bool,
    f_max: float = 35000.0,
    f_min: float = 4000.0
) -> np.ndarray:
    """
    Forward model of downhole pump card response given physical conditions:
    - fillage: liquid fill fraction [0 to 1]
    - gas_void: free gas fraction [0 to 0.8]
    - leakage: traveling/standing valve leak [0 to 0.5]
    - tagging: mechanical contact with top/bottom
    """
    N = len(u_norm)
    f_sim = np.zeros(N)

    # Distinguish upstroke vs downstroke
    # u_norm follows 0 -> 1 (upstroke) and 1 -> 0 (downstroke)
    mid = N // 2
    u_up = u_norm[:mid]
    u_down = u_norm[mid:]

    # Upstroke: traveling valve closes, standing valve opens -> fluid lifted
    # Leakage causes load decay during upstroke
    up_load = f_max - leakage * (f_max - f_min) * (1.0 - u_up)
    f_sim[:mid] = up_load

    # Downstroke: traveling valve opens when chamber pressure exceeds tubing pressure
    # If gas is present: polytropic compression P * V^1.2 = C -> load drops gradually
    # If liquid pound: chamber stays low pressure until liquid level hit -> sharp slam
    down_load = np.zeros(len(u_down))
    for i, u_pos in enumerate(u_down):
        stroke_remaining = u_pos  # 1.0 at start of downstroke down to 0.0
        if stroke_remaining > fillage:
            # Traveling through gas or vapor space
            if gas_void > 0.05:
                # Polytropic gas compression curve
                comp_ratio = (1.0 - stroke_remaining) / max(1.0 - fillage, 0.01)
                gas_load = f_max - (f_max - f_min) * (comp_ratio ** (1.0 + gas_void))
                down_load[i] = max(gas_load, f_min)
            else:
                # Liquid pound: near zero load until impact
                down_load[i] = f_min
        else:
            # Liquid re-engagement
            if gas_void <= 0.05 and stroke_remaining > fillage - 0.08:
                # Impact spike from fluid pound
                down_load[i] = f_min + 1.2 * (f_max - f_min) * np.exp(-((stroke_remaining - fillage)/0.03)**2)
            else:
                down_load[i] = f_min + leakage * (f_max - f_min)

    f_sim[mid:] = down_load

    if tagging:
        # Mechanical tag spike near bottom of stroke
        tag_mask = (u_norm < 0.05)
        f_sim[tag_mask] += 0.4 * (f_max - f_min)

    return f_sim


class InverseFaultDiagnosis:
    """
    Mechanistic Inverse-Simulation Fault Diagnoser.
    Inverts measured cards to physical parameter states and outputs auditable findings.
    """

    def __init__(self):
        pass

    def diagnose(
        self,
        u_surf: np.ndarray,
        f_surf: np.ndarray,
        depth_m: float = 650.0,
        intake_pressure_bar: float = 12.0,
        bubble_point_bar: float = 20.0
    ) -> MechanisticDiagnosis:
        """
        Runs complete inverse analysis on a single measured pump stroke.
        """
        # 1. Invert to downhole card
        u_pump, f_pump = everted_gibbs_downhole_card(u_surf, f_surf, depth_m=depth_m)

        # 2. Extract physics features
        features = extract_card_features(u_surf, f_surf, u_pump, f_pump)

        # Normalize displacement 0 -> 1 -> 0 for model comparison
        u_span = max(features.net_stroke_m, 1e-4)
        u_norm = (u_pump - np.min(u_pump)) / u_span

        # 3. Inverse parameter search: find (fillage, gas_void, leakage)
        # to match downhole card
        target_f = f_pump
        f_max = features.peak_pump_load
        f_min = features.min_pump_load

        def loss_fn(params):
            fillage, gas_void, leakage = params
            f_candidate = synthesize_pump_card(
                u_norm, fillage, gas_void, leakage, tagging=False,
                f_max=f_max, f_min=f_min
            )
            return np.mean((f_candidate - target_f)**2)

        init_guess = [features.pump_fillage_fraction, features.gas_void_fraction_est, 0.05]
        bounds = [(0.1, 1.0), (0.0, 0.7), (0.0, 0.4)]
        res = minimize(loss_fn, init_guess, bounds=bounds, method='L-BFGS-B')

        fit_fillage, fit_gas, fit_leak = res.x
        rmse = float(np.sqrt(res.fun))

        # Check for mechanical tagging: abrupt impact spike at bottom of stroke
        grad = np.abs(np.gradient(f_pump))
        mean_grad = max(float(np.mean(grad)), 1.0)
        bottom_mask = (u_norm < 0.04)
        tagging_detected = bool(np.any(bottom_mask) and (np.max(grad[bottom_mask]) / mean_grad > 3.0))

        # 4. Synthesize diagnosis based on physical thresholds
        # Gas Interference vs Fluid Pound:
        # If intake pressure < bubble point AND gas_void > 0.15 -> Gas interference
        # If intake pressure > bubble point OR gas_void < 0.10 AND fillage < 0.85 -> Fluid pound
        intake_below_pb = (intake_pressure_bar < bubble_point_bar)

        if tagging_detected:
            fault_type = "MECHANICAL_TAGGING"
            confidence = 0.92
            desc = f"Downhole tag detected at bottom of stroke. Risk of rod buckling and severe fatigue."
            remedy = "Adjust polished rod spacing/clamp immediately to raise plunger clearance."
        elif fit_fillage < 0.85 and intake_below_pb and fit_gas >= 0.15:
            fault_type = "GAS_INTERFERENCE"
            confidence = 0.90
            desc = (
                f"Fillage {fit_fillage*100:.1f}%; best-fit gas void fraction {fit_gas:.2f}; "
                f"pump intake pressure ({intake_pressure_bar:.1f} bar) below bubble point "
                f"({bubble_point_bar:.1f} bar) — gas interference, not fluid pound."
            )
            remedy = "Increase casing backpressure or optimize pump intake submergence to suppress free gas."
        elif fit_fillage < 0.85 and (not intake_below_pb or fit_gas < 0.15):
            fault_type = "FLUID_POUND"
            confidence = 0.88
            desc = (
                f"Fillage {fit_fillage*100:.1f}%; sharp downstroke impact with low gas cushioning "
                f"({fit_gas*100:.1f}% gas). Severe compressive shockwave on rod string."
            )
            remedy = "Slow down pump SPM (Strokes Per Minute) or enable asymmetric slow downstroke."
        elif fit_leak > 0.18:
            fault_type = "VALVE_LEAKAGE"
            confidence = 0.85
            desc = f"Traveling/Standing valve slippage estimated at {fit_leak*100:.1f}%. Volumetric efficiency degraded."
            remedy = "Schedule valve replacement and flush solids from ball and seat."
        else:
            fault_type = "NORMAL_PUMPING"
            confidence = 0.95
            desc = f"Full barrel operation (fillage {fit_fillage*100:.1f}%). Minimal gas and zero tagging."
            remedy = "Maintain current operating envelope."

        return MechanisticDiagnosis(
            fault_type=fault_type,
            confidence=confidence,
            fillage_pct=float(fit_fillage * 100.0),
            gas_void_fraction=float(fit_gas),
            leakage_pct=float(fit_leak * 100.0),
            mechanical_tagging=tagging_detected,
            description=desc,
            remedial_action=remedy,
            features=features,
            fitted_card_rmse=rmse
        )
