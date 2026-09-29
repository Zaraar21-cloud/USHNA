// The AI layer's real outputs, read straight from ushna/ml/artifacts/ (written by python -m ushna.ml.train).
// Nothing here is invented in the browser: retrain in Python and these numbers change.
import pinn from '../../../ushna/ml/artifacts/pinn_training.json';
import enkf from '../../../ushna/ml/artifacts/enkf_assimilation_trace.json';
import gp from '../../../ushna/ml/artifacts/gp_residual_report.json';
import eqs from '../../../ushna/ml/artifacts/discovered_equations.json';

export { pinn, enkf, gp, eqs };

const last = (a) => a[a.length - 1];

export const AI = {
  pinn: {
    trained: pinn.status === 'trained',
    rmse: pinn.validation.val_rmse_c,
    maxErr: pinn.validation.val_max_c,
    speedup: pinn.speed.speedup,
    pinnMs: pinn.speed.pinn_ms,
    solverMs: pinn.speed.solver_ms,
    rmseLimit: pinn.gates.rmse_limit_c,
    audit: pinn.energy_audit.max_imbalance_pct,
    auditLimit: pinn.energy_audit.limit_pct,
    auditPassed: pinn.energy_audit.passed,
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
