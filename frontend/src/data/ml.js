// The AI layer's real outputs, read straight from trained_models/ (written by scripts/train_ml_pipeline.py).
// Nothing here is invented in the browser: retrain in Python and these numbers change.
import pinn from '../../../trained_models/pinn_training.json';
import enkf from '../../../trained_models/enkf_assimilation_trace.json';
import gp from '../../../trained_models/gp_residual_report.json';
import eqs from '../../../trained_models/discovered_equations.json';

export { pinn, enkf, gp, eqs };

const last = (a) => a[a.length - 1];

export const AI = {
  pinn: {
    trained: pinn.status === 'trained',
    rmse: pinn.validation.val_rmse_c,
    maxErr: pinn.validation.val_max_c,
    speedup: pinn.speed.speedup,
    audit: pinn.energy_audit.max_imbalance_pct,
    auditLimit: pinn.energy_audit.limit_pct,
    params: pinn.architecture.parameters,
    iterations: pinn.training.iterations,
  },
  enkf: {
    collapse: enkf.uncertainty_reduction_pct,
    days: last(enkf.daily_trace).day,
  },
  gp: {
    found: last(gp.gp_mean_pct),
    truth: last(gp.true_unmodelled_pct),
    bound: gp.bound_pct,
  },
  sr: {
    count: Object.keys(eqs).length,
    minR2: Math.min(...Object.values(eqs).map((e) => e.r2_score)),
  },
};
