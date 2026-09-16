import numpy as np
from src.physics.reservoir import boberg_lantz_temperature
from src.physics.viscosity import WaltherViscosityModel

class SyntheticDataGenerator:
    """
    Phase 2: Synthetic Data Generator.
    Generates realistic CSS cycle data including sensor noise, drift, and faults.
    """
    def __init__(self, seed=42):
        np.random.seed(seed)
        # Heavy oil properties (Jodhpur Sandstone / Rajasthan)
        self.visc_model = WaltherViscosityModel(A=9.5, B=3.6)
        
    def generate_css_cycle(self, days=80):
        """
        Generates a synthetic CSS cycle (time series) covering 
        injection (implied), soak, and production.
        """
        time_days = np.arange(1, days + 1)
        
        # 1. Simulate Reservoir Cooling (Boberg-Lantz proxy)
        T_R = 320.0 # ~47 C
        T_s = 550.0 # ~277 C
        
        # Decay functions representing vertical/horizontal heat loss
        f_VD = np.exp(-0.02 * time_days)
        f_HD = np.exp(-0.01 * time_days)
        delta = 0.1 * (1 - np.exp(-0.05 * time_days)) # Heat carried by fluids
        
        T_res_history = boberg_lantz_temperature(T_R, T_s, f_VD, f_HD, delta)
        
        # 2. Add realistic sensor noise to temperature
        noise_T = np.random.normal(0, 1.5, size=days)
        T_res_noisy = T_res_history + noise_T
        
        # 3. Calculate Viscosity over time
        mu_history = np.array([self.visc_model.kinematic_viscosity(T) for T in T_res_history])
        
        # 4. Synthesize Flow Rate (declining as viscosity increases)
        # q_o propto 1 / mu
        base_rate = 50.0 # m^3/day
        q_o = base_rate * (mu_history[0] / mu_history)
        
        # Add noise to flow rate
        q_o_noisy = q_o + np.random.normal(0, 0.5, size=days)
        
        # Collect data
        dataset = {
            'time_days': time_days,
            'T_res_true': T_res_history,
            'T_res_measured': T_res_noisy,
            'viscosity_true': mu_history,
            'production_rate_measured': np.maximum(q_o_noisy, 0)
        }
        
        return dataset

if __name__ == '__main__':
    generator = SyntheticDataGenerator()
    data = generator.generate_css_cycle(days=80)
    print("Generated 80-day CSS cycle.")
    print(f"Day 1 Temp: {data['T_res_true'][0]:.1f} K, Viscosity: {data['viscosity_true'][0]:.1f} cSt")
    print(f"Day 80 Temp: {data['T_res_true'][-1]:.1f} K, Viscosity: {data['viscosity_true'][-1]:.1f} cSt")
