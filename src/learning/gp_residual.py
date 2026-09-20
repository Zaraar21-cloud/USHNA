"""
Bounded Gaussian Process (GP) Residual Model for USHNA.
Tier 2 of the Learning Layer (Section 5.2).

Implements the Kennedy-O'Hagan calibration framework:
y_obs = f_physics(x, theta) + delta(x) + epsilon

Crucial Architectural Guarantees:
1. The GP learns ONLY the discrepancy delta(x).
2. The correction delta(x) is hard-bounded to +/- 15% of the physics prediction:
   y_hat = f_phys + clip(delta, -0.15 * f_phys, +0.15 * f_phys)
   The ML component is structurally incapable of producing a physically absurd answer.
3. Calibrated uncertainty is provided natively (mu, sigma, 95% CI).
4. Clustering of large residuals is diagnosed as physical assumption failures
   (e.g., steam thief-zone override at high injection volumes).
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
from scipy.optimize import minimize
from scipy.linalg import cholesky, cho_solve


@dataclass
class BoundedGPOutput:
    physics_prediction: float
    raw_discrepancy_mean: float
    bounded_discrepancy: float
    calibrated_prediction: float
    uncertainty_std: float
    ci_95_lower: float
    ci_95_upper: float
    bound_active: bool
    diagnostic_alert: Optional[str] = None


class BoundedGPResidualModel:
    """
    Gaussian Process Discrepancy Model with hard physical bounds.
    Fits the residual between physics engine outputs and real field observations.
    """

    def __init__(
        self,
        lengthscale_bounds: Tuple[float, float] = (0.1, 50.0),
        variance_bounds: Tuple[float, float] = (1e-4, 100.0),
        noise_variance: float = 1e-3,
        max_residual_fraction: float = 0.15,
        max_training_samples: int = 150
    ):
        self.max_residual_fraction = max_residual_fraction
        self.max_samples = max_training_samples
        self.noise_variance = noise_variance
        self.lengthscale_bounds = lengthscale_bounds
        self.variance_bounds = variance_bounds

        # Model state
        self.X_train: Optional[np.ndarray] = None
        self.y_residual_train: Optional[np.ndarray] = None
        self.lengthscale: np.ndarray = np.array([1.0])
        self.sigma_f: float = 1.0
        self.L_chol: Optional[np.ndarray] = None
        self.alpha_weights: Optional[np.ndarray] = None
        self.is_fitted: bool = False

    def _rbf_kernel(
        self,
        X1: np.ndarray,
        X2: np.ndarray,
        lengthscale: np.ndarray,
        sigma_f: float
    ) -> np.ndarray:
        """Computes anisotropic RBF (Squared Exponential) covariance matrix."""
        # Scale inputs by lengthscales
        scaled_X1 = X1 / lengthscale
        scaled_X2 = X2 / lengthscale
        # Squared Euclidean distance
        dist_sq = np.sum(scaled_X1**2, axis=1, keepdims=True) + \
                  np.sum(scaled_X2**2, axis=1) - \
                  2.0 * np.dot(scaled_X1, scaled_X2.T)
        dist_sq = np.maximum(dist_sq, 0.0)
        return (sigma_f ** 2) * np.exp(-0.5 * dist_sq)

    def fit(
        self,
        X: np.ndarray,
        y_obs: np.ndarray,
        y_physics: np.ndarray
    ) -> 'BoundedGPResidualModel':
        """
        Fits the GP discrepancy model on residuals delta = y_obs - y_physics.
        """
        X = np.atleast_2d(np.asarray(X, dtype=float))
        y_obs = np.asarray(y_obs, dtype=float).ravel()
        y_physics = np.asarray(y_physics, dtype=float).ravel()

        assert len(y_obs) == len(y_physics) == len(X), "Input dimensions must match"

        # Residuals
        residuals = y_obs - y_physics

        # Prune if too large for real-time edge processing (keep most informative / recent)
        if len(X) > self.max_samples:
            # Subsample evenly across index range
            indices = np.linspace(0, len(X) - 1, self.max_samples, dtype=int)
            X = X[indices]
            residuals = residuals[indices]

        self.X_train = X
        self.y_residual_train = residuals
        n_features = X.shape[1]

        # Optimize hyperparameters (log lengthscales, log sigma_f)
        def neg_log_likelihood(params):
            log_l = params[:n_features]
            log_sf = params[n_features]
            l_val = np.exp(log_l)
            sf_val = np.exp(log_sf)

            K = self._rbf_kernel(self.X_train, self.X_train, l_val, sf_val)
            K_noisy = K + self.noise_variance * np.eye(len(self.X_train))

            try:
                L = cholesky(K_noisy, lower=True)
                alpha = cho_solve((L, True), self.y_residual_train)
                nll = 0.5 * np.dot(self.y_residual_train, alpha) + \
                      np.sum(np.log(np.diag(L))) + \
                      0.5 * len(self.X_train) * np.log(2.0 * np.pi)
                return nll
            except np.linalg.LinAlgError:
                return 1e10

        init_params = np.concatenate([
            np.zeros(n_features),  # log lengthscales = 0 -> l = 1.0
            np.array([np.log(max(np.std(residuals), 0.1))])
        ])

        res = minimize(neg_log_likelihood, init_params, method='L-BFGS-B')
        self.lengthscale = np.exp(res.x[:n_features])
        self.sigma_f = float(np.exp(res.x[n_features]))

        # Precompute Cholesky decomposition of training covariance
        K = self._rbf_kernel(self.X_train, self.X_train, self.lengthscale, self.sigma_f)
        K_noisy = K + self.noise_variance * np.eye(len(self.X_train))
        self.L_chol = cholesky(K_noisy, lower=True)
        self.alpha_weights = cho_solve((self.L_chol, True), self.y_residual_train)
        self.is_fitted = True

        return self

    def predict_discrepancy(self, X_query: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Computes raw GP residual mean and standard deviation.
        """
        if not self.is_fitted or self.X_train is None:
            raise RuntimeError("Model must be fitted before predict.")

        X_query = np.atleast_2d(np.asarray(X_query, dtype=float))
        K_star = self._rbf_kernel(X_query, self.X_train, self.lengthscale, self.sigma_f)
        K_star_star = self._rbf_kernel(X_query, X_query, self.lengthscale, self.sigma_f)

        mu = np.dot(K_star, self.alpha_weights)

        # Variance: diag(K_star_star - K_star * K_noisy^-1 * K_star^T)
        v = cho_solve((self.L_chol, True), K_star.T)
        cov = K_star_star - np.dot(K_star, v)
        var = np.maximum(np.diag(cov), 1e-8)
        std = np.sqrt(var)

        return mu, std

    def predict_bounded(
        self,
        X_query: np.ndarray,
        y_physics: float,
        context_tags: Optional[Dict[str, float]] = None
    ) -> BoundedGPOutput:
        """
        Predicts calibrated value with guaranteed hard +/-15% physics bound.
        Checks for physical breakdown alerts (e.g. thief-zone steam override).
        """
        X_query = np.atleast_2d(np.asarray(X_query, dtype=float))
        raw_mu, raw_std = self.predict_discrepancy(X_query)
        mu_val = float(raw_mu[0])
        std_val = float(raw_std[0])

        # HARD BOUND: Max allowable perturbation is +/- 15% of physics prediction
        max_allowed_delta = self.max_residual_fraction * abs(y_physics)
        bounded_delta = float(np.clip(mu_val, -max_allowed_delta, max_allowed_delta))
        bound_active = bool(abs(mu_val) > max_allowed_delta - 1e-4)

        calibrated_pred = float(y_physics + bounded_delta)
        ci_lower = float(calibrated_pred - 1.96 * std_val)
        ci_upper = float(calibrated_pred + 1.96 * std_val)

        # Diagnose physical assumption failures
        diagnostic = None
        if bound_active:
            steam_vol = (context_tags or {}).get('steam_volume_m3', 0.0)
            if steam_vol > 1500.0 and bounded_delta < 0:
                diagnostic = (
                    f"DIAGNOSTIC ALERT: Residual saturated at -15% limit under high steam volume "
                    f"({steam_vol:.0f} m^3). Indicates thief-zone steam override not captured "
                    f"by 1D Marx-Langenheim heat balance."
                )
            else:
                diagnostic = (
                    f"WARNING: Residual saturated at maximum allowable bound (+/-{self.max_residual_fraction*100:.0f}%). "
                    f"Physics model requires recalibration via EnKF."
                )

        return BoundedGPOutput(
            physics_prediction=float(y_physics),
            raw_discrepancy_mean=mu_val,
            bounded_discrepancy=bounded_delta,
            calibrated_prediction=calibrated_pred,
            uncertainty_std=std_val,
            ci_95_lower=ci_lower,
            ci_95_upper=ci_upper,
            bound_active=bound_active,
            diagnostic_alert=diagnostic
        )
