import numpy as np

def ramey_wellbore_temperature(T_surface, grad_T_geo, depth, flow_rate, time_since_start, k_form, C_p_fluid, r_w, U_to):
    """
    Ramey's transient heat transmission model for wellbore temperature.
    Computes tubing fluid temperature T(z, t).
    
    Parameters:
    - T_surface: Geothermal surface temperature
    - grad_T_geo: Geothermal gradient (K/m)
    - depth: Depth z at which to evaluate (m)
    - flow_rate: Mass flow rate of fluid (kg/s)
    - time_since_start: Time since start of production (s)
    - k_form: Formation thermal conductivity (W/m K)
    - C_p_fluid: Specific heat capacity of the fluid (J/kg K)
    - r_w: Wellbore radius (m)
    - U_to: Overall heat transfer coefficient (W/m^2 K)
    
    Returns:
    - T_fluid: Temperature of the fluid at the given depth and time
    """
    # A simplified Ramey analytical solution
    # Relaxation distance A
    # f(t) is a dimensionless time function for transient heat conduction
    # For large times, f(t) ~ ln(2 * sqrt(alpha * t) / r_w) - 0.29
    
    # Placeholder for exact f(t) implementation
    alpha_form = 1e-6 # typical thermal diffusivity m^2/s
    f_t = np.log(2 * np.sqrt(alpha_form * time_since_start) / r_w) - 0.29
    if f_t < 0:
        f_t = 0.1 # bounded
        
    # Heat transfer resistance
    R_total = (1.0 / (r_w * U_to)) + (f_t / k_form)
    
    # Relaxation parameter A (m)
    A = (flow_rate * C_p_fluid * R_total) / (2 * np.pi)
    
    # T_geo(z)
    T_geo_z = T_surface + grad_T_geo * depth
    
    # T_fluid(z) = T_geo(z) - A * grad_T_geo * (1 - e^(-depth/A)) + (T_in - T_geo(0) + A * grad_T_geo) * e^(-depth/A)
    # Assuming fluid enters at bottom (z=depth) at formation temperature and flows up, 
    # but the problem states evaluating at pump setting depth yields T_pump.
    # We will provide a robust general formulation in subsequent refinements.
    
    # Placeholder logic for initial setup
    T_fluid = T_geo_z # Base starting point
    
    return T_fluid
