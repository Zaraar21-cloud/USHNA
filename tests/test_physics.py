import numpy as np
from src.physics.reservoir import marx_langenheim_heated_volume, boberg_lantz_temperature, radial_composite_inflow
from src.physics.viscosity import WaltherViscosityModel
from src.physics.rod_string import solve_gibbs_wave_equation, float_margin_index

def test_marx_langenheim():
    # Toy values for testing
    Q_i = 1e6  # W
    M_R = 2.5e6  # J/m^3 K
    delta_T = 200.0  # K
    k_ob = 2.0  # W/m K
    alpha_ob = 1e-6  # m^2/s
    h = 10.0  # m
    t = 86400 * 10  # 10 days
    
    V_s, r_h = marx_langenheim_heated_volume(Q_i, M_R, delta_T, k_ob, alpha_ob, h, t)
    
    assert V_s > 0, "Heated volume should be positive"
    assert r_h > 0, "Heated radius should be positive"

def test_boberg_lantz():
    T_R = 320.0  # K (approx 47 C)
    T_s = 520.0  # K
    
    # Early time (little cooling)
    T_early = boberg_lantz_temperature(T_R, T_s, f_VD=0.9, f_HD=0.9, delta=0.1)
    
    # Late time (much cooling)
    T_late = boberg_lantz_temperature(T_R, T_s, f_VD=0.3, f_HD=0.3, delta=0.5)
    
    assert T_early > T_late, "Early temperature should be higher than late temperature"
    assert T_early <= T_s, "Temperature should not exceed steam temp"
    assert T_late >= T_R, "Temperature should not drop below reservoir temp"

def test_walther_viscosity():
    # Parameters that mimic heavy oil (API 17-19)
    # log10(log10(v + 0.7)) = A - B * log10(T)
    model = WaltherViscosityModel(A=9.0, B=3.5)
    
    T_cold = 320.0 # K
    T_hot = 520.0 # K
    
    v_cold = model.kinematic_viscosity(T_cold)
    v_hot = model.kinematic_viscosity(T_hot)
    
    assert v_cold > v_hot, "Viscosity should drop significantly at high temperature"

def test_float_margin_index():
    # If drag is high, FMI should drop
    W_buoyant = 50000.0 # N
    F_fric = 5000.0 # N
    
    # Low viscosity (safe)
    FMI_safe = float_margin_index(W_buoyant, mu=0.1, v_rod=1.0, D_t=0.076, D_r=0.025, F_fric=F_fric)
    
    # High viscosity (unsafe)
    FMI_unsafe = float_margin_index(W_buoyant, mu=5.0, v_rod=1.0, D_t=0.076, D_r=0.025, F_fric=F_fric)
    
    assert FMI_safe > FMI_unsafe, "Higher viscosity should result in lower float margin"
    assert FMI_safe > 0.15, "Expected safe scenario to clear 0.15 limit"

def test_gibbs_wave_equation():
    # 1D string, 100 nodes
    nx = 100
    dx = 10.0
    dt = 0.001
    c = 0.1
    steps = 50
    
    u_initial = np.linspace(0, 1, nx)
    u_dt_initial = np.zeros(nx)
    
    u_history = solve_gibbs_wave_equation(u_initial, u_dt_initial, dx, dt, c, steps)
    
    assert u_history.shape == (steps, nx)
    assert not np.isnan(u_history).any(), "Wave equation solution blew up (check CFL condition)"

if __name__ == '__main__':
    test_marx_langenheim()
    test_boberg_lantz()
    test_walther_viscosity()
    test_float_margin_index()
    test_gibbs_wave_equation()
    print("All basic physics tests passed!")
