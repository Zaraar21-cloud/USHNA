import numpy as np
from numba import jit

@jit(nopython=True)
def solve_gibbs_wave_equation(u_initial, u_dt_initial, dx, dt, c, steps, a=4900.0):
    """
    Solves the Gibbs damped wave equation (Eq 5) using explicit finite differences.
    d^2u/dt^2 = a^2 d^2u/dx^2 - c du/dt
    
    Parameters:
    - u_initial: Initial displacement array at t=0
    - u_dt_initial: Initial velocity array at t=0
    - dx: Spatial step size
    - dt: Time step size
    - c: Rod damping coefficient (1/s)
    - steps: Number of time steps to simulate
    - a: Speed of sound in rod (m/s), approx 4900 m/s for steel
    
    Returns:
    - u_history: Array of displacements over time
    """
    nx = len(u_initial)
    u_history = np.zeros((steps, nx))
    
    # Initialize first two time steps
    u = u_initial.copy()
    u_prev = u_initial - u_dt_initial * dt  # Simple backward Euler for initial t-1
    
    u_history[0, :] = u
    
    alpha = (a * dt / dx)**2
    damping_factor = c * dt / 2.0
    
    for t in range(1, steps):
        u_next = np.zeros(nx)
        for i in range(1, nx - 1):
            # Finite difference discretization of the wave equation
            # (u_next - 2u + u_prev)/dt^2 = a^2 (u_{i+1} - 2u_i + u_{i-1})/dx^2 - c (u_next - u_prev)/(2dt)
            
            space_deriv = u[i+1] - 2*u[i] + u[i-1]
            
            # Solving for u_next
            u_next[i] = (1 / (1 + damping_factor)) * (
                alpha * space_deriv + 2*u[i] - u_prev[i] * (1 - damping_factor)
            )
            
        # Boundary conditions (e.g., surface polished rod motion and downhole pump load)
        # Left as placeholder for specific boundary implementations
        u_next[0] = u[0] # Fixed or driven
        u_next[-1] = u[-1] # Pump boundary condition
        
        u_history[t, :] = u_next
        u_prev = u.copy()
        u = u_next.copy()
        
    return u_history

def float_margin_index(W_buoyant, mu, v_rod, D_t, D_r, F_fric):
    """
    Computes the Float Margin Index (FMI) to predict rod float (Eq 6).
    
    Parameters:
    - W_buoyant: Buoyed weight of the rod string above depth z
    - mu: Fluid viscosity
    - v_rod: Rod velocity (downstroke)
    - D_t: Tubing inner diameter
    - D_r: Rod outer diameter
    - F_fric: Mechanical friction
    
    Returns:
    - FMI: Float Margin Index (must be > 0.15 for safe operation)
    """
    # Laminar viscous drag per unit length
    f_drag = (2 * np.pi * mu * v_rod) / np.log(D_t / D_r)
    
    # For a segment, F_drag = f_drag * length
    # Assuming f_drag is integrated or represents total drag F_drag for the segment
    F_drag = f_drag  # Simplification; should integrate over length
    
    FMI = (W_buoyant - F_drag - F_fric) / W_buoyant
    return FMI
