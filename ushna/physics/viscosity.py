import numpy as np

class WaltherViscosityModel:
    """
    ASTM D341 / Walther double-logarithmic viscosity model (Eq 4).
    Fitted to Baghewala PVT.
    
    log10(log10(v + 0.7)) = A - B * log10(T)
    """
    def __init__(self, A, B, T_onset=None, n_power_law=None):
        self.A = A
        self.B = B
        self.T_onset = T_onset
        self.n_power_law = n_power_law
        
    def kinematic_viscosity(self, T_kelvin):
        """
        Calculate kinematic viscosity (v) in cSt given Temperature in Kelvin.
        """
        # log10(log10(v + 0.7)) = A - B * log10(T)
        rhs = self.A - self.B * np.log10(T_kelvin)
        v = 10**(10**rhs) - 0.7
        return v
    
    def dynamic_viscosity(self, T_kelvin, density):
        """
        Calculate dynamic viscosity (mu) in cP given Temperature (K) and density (g/cm^3 or kg/L).
        mu = v * density
        """
        v = self.kinematic_viscosity(T_kelvin)
        # Apply shear-thinning correction if below onset temperature
        if self.T_onset is not None and self.n_power_law is not None:
            if T_kelvin < self.T_onset:
                # Placeholder for power-law shear thinning logic
                pass
                
        return v * density

