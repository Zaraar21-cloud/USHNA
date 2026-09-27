"""
USHNA Machine Learning Layer (src/learning)

Contains the five ML components:
1. Ensemble Kalman Filter (EnKF) - Data assimilation
2. Inverse-Simulation Fault Diagnosis - Downhole pump card inversion
3. Gaussian Process (GP) Residual Model - Bounded discrepancy learning
4. Symbolic Regression - Human-readable equation discovery
5. Physics-Informed Neural Network (PINN) - Surrogate with energy audit
6. USHNAPipeline - End-to-end orchestrator & explainability card generator
"""

from src.learning.enkf import EnsembleKalmanFilter, ParameterSpec
from src.learning.inverse_diagnosis import (
    InverseFaultDiagnosis,
    MechanisticDiagnosis,
    DynamometerFeatures,
    everted_gibbs_downhole_card,
    synthesize_pump_card
)
from src.learning.gp_residual import BoundedGPResidualModel, BoundedGPOutput
from src.learning.symbolic_regression import (
    SymbolicEquationDiscoverer,
    DiscoveredEquation
)
from src.learning.pinn_surrogate import (
    AxisymmetricPINNSurrogate,
    EnergyAuditReport,
    EnergyAuditFailureError
)
from src.learning.pipeline import (
    USHNAPipeline,
    ExplainabilityCard,
    IncompleteExplainabilityCardError
)

__all__ = [
    'EnsembleKalmanFilter',
    'ParameterSpec',
    'InverseFaultDiagnosis',
    'MechanisticDiagnosis',
    'DynamometerFeatures',
    'everted_gibbs_downhole_card',
    'synthesize_pump_card',
    'BoundedGPResidualModel',
    'BoundedGPOutput',
    'SymbolicEquationDiscoverer',
    'DiscoveredEquation',
    'AxisymmetricPINNSurrogate',
    'EnergyAuditReport',
    'EnergyAuditFailureError',
    'USHNAPipeline',
    'ExplainabilityCard',
    'IncompleteExplainabilityCardError'
]
