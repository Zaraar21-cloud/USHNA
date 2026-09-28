"""
USHNA Machine Learning Layer (ushna.ml)

Contains the five ML components:
1. Ensemble Kalman Filter (EnKF) - Data assimilation
2. Inverse-Simulation Fault Diagnosis - Downhole pump card inversion
3. Gaussian Process (GP) Residual Model - Bounded discrepancy learning
4. Symbolic Regression - Human-readable equation discovery
5. Physics-Informed Neural Network (PINN) - Surrogate with energy audit
6. USHNAPipeline - End-to-end orchestrator & explainability card generator
"""

from ushna.ml.enkf import EnsembleKalmanFilter, ParameterSpec
from ushna.ml.inverse_diagnosis import (
    InverseFaultDiagnosis,
    MechanisticDiagnosis,
    DynamometerFeatures,
    everted_gibbs_downhole_card,
    synthesize_pump_card
)
from ushna.ml.gp_residual import BoundedGPResidualModel, BoundedGPOutput
from ushna.ml.symbolic_regression import (
    SymbolicEquationDiscoverer,
    DiscoveredEquation
)
from ushna.ml.pinn_surrogate import (
    AxisymmetricPINNSurrogate,
    EnergyAuditReport,
    EnergyAuditFailureError
)
from ushna.ml.pipeline import (
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
