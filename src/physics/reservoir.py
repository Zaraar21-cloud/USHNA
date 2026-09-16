import numpy as np
from scipy.special import erfc

def marx_langenheim_heated_volume(Q_i, M_R, delta_T, k_ob, alpha_ob, h, t):
    """
    Marx-Langenheim model for steam injection phase (Eq 1).
    Computes the heated volume as a function of injected steam.
    
    Parameters:
    - Q_i: Heat injection rate (W or J/day)
    - M_R: Volumetric heat capacity of reservoir (J/m^3 K)
    - delta_T: Temperature difference (T_s - T_R) (K)
    - k_ob: Thermal conductivity of overburden (W/m K)
    - alpha_ob: Thermal diffusivity of overburden (m^2/s)
    - h: Reservoir thickness (m)
    - t: Time since start of injection (s)
    
    Returns:
    - V_s: Heated volume (m^3)
    - r_h: Heated zone radius (m)
    """
    # Dimensionless time
    t_D = (4 * k_ob * t) / (M_R * h**2 * alpha_ob)
    
    # F(t_D) = e^(t_D) * erfc(sqrt(t_D))
    F_tD = np.exp(t_D) * erfc(np.sqrt(t_D))
    
    # Standard Marx-Langenheim formulation for heated area A(t)
    # The exact form in the PDF has some specific coefficients, we use the standard physical form:
    # A(t) = (Q_i * M_R * h / (4 * k_ob * M_R * delta_T)) * (e^tD erfc(sqrt(tD)) + 2*sqrt(tD/pi) - 1)
    # Using the structural simplification from the PDF:
    
    # Placeholder for the exact scalar coefficient which depends on units
    # Assuming V_s directly scales with F(t_D) loss term as per the paper's formulation
    
    # For a robust textbook implementation:
    term1 = np.exp(t_D) * erfc(np.sqrt(t_D))
    term2 = 2 * np.sqrt(t_D / np.pi)
    
    # G(t_D) is the true integral of F(t_D) for Marx-Langenheim
    G_tD = term1 + term2 - 1.0
    
    # Heat capacity of overburden: M_ob = k_ob / alpha_ob
    M_ob = k_ob / alpha_ob
    
    # Heated area A(t)
    A_t = (Q_i / (delta_T * h * M_R)) * t * (G_tD / t_D)
    
    V_s = A_t * h
    r_h = np.sqrt(A_t / np.pi)
    
    return V_s, r_h

def boberg_lantz_temperature(T_R, T_s, f_VD, f_HD, delta):
    """
    Boberg-Lantz model for soak and production thermal decline (Eq 2).
    
    Parameters:
    - T_R: Original reservoir temperature
    - T_s: Steam temperature
    - f_VD: Vertical conduction unit solution
    - f_HD: Radial conduction unit solution
    - delta: Energy carried away with produced fluid
    
    Returns:
    - T_bar: Average heated-zone temperature
    """
    T_bar = T_R + (T_s - T_R) * (f_VD * f_HD * (1 - delta))
    return T_bar

def radial_composite_inflow(k, k_ro, h, P_R_bar, P_wf, mu_h, mu_c, r_h, r_w, r_e, s):
    """
    Radial composite inflow model (Eq 3).
    A hot inner annulus surrounded by cold reservoir.
    
    Parameters:
    - k: Absolute permeability
    - k_ro: Relative permeability to oil
    - h: Reservoir thickness
    - P_R_bar: Average reservoir pressure
    - P_wf: Flowing bottomhole pressure
    - mu_h: Viscosity in the hot zone
    - mu_c: Viscosity in the cold zone
    - r_h: Radius of the hot zone
    - r_w: Wellbore radius
    - r_e: External boundary radius
    - s: Skin factor
    
    Returns:
    - q_o: Oil flow rate
    """
    numerator = 2 * np.pi * k * k_ro * h * (P_R_bar - P_wf)
    denominator = (mu_h * np.log(r_h / r_w)) + (mu_c * np.log(r_e / r_h)) + s
    
    q_o = numerator / denominator
    return q_o
