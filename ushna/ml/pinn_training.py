"""
Trained Physics-Informed Neural Network for the CSS heated zone (Section 5.3).

What it learns: the temperature field T(r, z, t) of the steam-heated zone as it
cools after soak, for ANY heated radius r_h in the design range. One network
therefore covers the whole steam-volume design space the CSS optimizer searches.

    rho*c * dT/dt = k * (d2T/dr2 + (1/r) dT/dr + d2T/dz2)      (axisymmetric conduction)

Ground truth is a conservative finite-volume solver of the same PDE. The PINN is
trained on three losses:
  1. PDE residual at random collocation points (autograd second derivatives),
  2. sparse "sensor" data: a DTS fibre in the wellbore plus two observation wells,
  3. zero-flux boundary conditions,
  4. conservation: the field's total enthalpy must stay at its injected value.
The initial condition is imposed exactly and the learned correction fades far from the hot zone:
    theta = theta0(r, z; r_h) + (t/t_end) * g(r, z; r_h) * NN(r, z, t, r_h)

A trained network is only released to the optimizer if it
  - matches the solver on heated radii it never saw in training, and
  - passes a first-principles energy audit: with insulated boundaries the
    enthalpy of the field must stay equal to what was injected, every day.

Uses PyTorch for training; the exported weights run in plain NumPy.
"""

from dataclasses import dataclass, field
import time
from typing import Dict, List, Optional

import numpy as np

# Geometry and properties match the browser twin (frontend/src/data/twin.js).
R_MAX = 60.0         # m, drainage radius r_e
Z_MAX = 40.0         # m, half pay (10 m) + 30 m of over/underburden; z = 0 is mid-pay
HALF_PAY = 10.0      # m, pay 20 m
T_END = 120.0        # days, production horizon
ALPHA = 0.9          # m^2/day, effective diffusivity (twin ALPHA_EFF)
FRONT_W = 1.0        # m, width of the initial hot/cold transition
REACH = 15.0         # m, envelope length: the correction fades beyond ~2 REACH from the hot zone,
                     #    where 120 days of diffusion (sqrt(alpha t) ~ 10 m) changes nothing
T_R, T_S = 47.0, 250.0   # deg C
M_R = 2.5e6          # J/(m^3 K), volumetric heat capacity (twin Marx-Langenheim)
RH_RANGE = (10.0, 22.0)  # m, heated radii the surrogate is valid for
RMSE_LIMIT_C = 5.0       # release gate: error on unseen designs


def _sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def theta0(r, z, r_h):
    """Dimensionless initial temperature: a hot cylinder r < r_h, |z| < HALF_PAY."""
    return _sig((r_h - r) / FRONT_W) * _sig((HALF_PAY - z) / FRONT_W)


def envelope(r, z, r_h):
    """Far-field fade for the learned correction: 1 inside the hot zone, Gaussian decay outside."""
    dr = np.maximum(r - r_h, 0.0) / REACH
    dz = np.maximum(z - HALF_PAY, 0.0) / REACH
    return np.exp(-(dr ** 2 + dz ** 2))


# ─────────────────────────── ground-truth solver ───────────────────────────

@dataclass
class FieldSolution:
    r: np.ndarray          # cell centres (m)
    z: np.ndarray          # cell centres (m)
    t: np.ndarray          # saved times (days)
    theta: np.ndarray      # (len(t), len(r), len(z)) dimensionless temperature
    cell_vol: np.ndarray   # (len(r), len(z)) m^3 (full 2*pi ring, both halves of pay)
    solve_seconds: float


def solve_cooling(r_h: float, nr: int = 120, nz: int = 80, save_every_days: float = 1.0) -> FieldSolution:
    """
    Explicit finite-volume solve of axisymmetric conduction with zero-flux boundaries.
    Conservative by construction: total enthalpy is constant to round-off.
    """
    t0 = time.perf_counter()
    dr, dz = R_MAX / nr, Z_MAX / nz
    r = (np.arange(nr) + 0.5) * dr
    z = (np.arange(nz) + 0.5) * dz
    rf = np.arange(nr + 1) * dr                      # radial faces
    th = theta0(r[:, None], z[None, :], r_h)

    dt = 0.2 * min(dr, dz) ** 2 / ALPHA              # well inside the explicit limit (0.25)
    n_steps = int(np.ceil(T_END / dt))
    dt = T_END / n_steps
    save_stride = max(1, int(round(save_every_days / dt)))

    # radial face transmissibilities r_{i+1/2}/(r_i dr^2); boundary faces carry zero flux
    tr = np.zeros(nr + 1)
    tr[1:-1] = rf[1:-1]
    frames, times = [th.copy()], [0.0]
    for k in range(1, n_steps + 1):
        flux_r = np.zeros((nr + 1, nz))
        flux_r[1:-1] = tr[1:-1, None] * (th[1:] - th[:-1]) / dr
        flux_z = np.zeros((nr, nz + 1))
        flux_z[:, 1:-1] = (th[:, 1:] - th[:, :-1]) / dz
        div = (flux_r[1:] - flux_r[:-1]) / (r[:, None] * dr) + (flux_z[:, 1:] - flux_z[:, :-1]) / dz
        th = th + dt * ALPHA * div
        if k % save_stride == 0 or k == n_steps:
            frames.append(th.copy())
            times.append(k * dt)

    cell_vol = 2.0 * (2.0 * np.pi * r[:, None] * dr) * np.full((1, nz), dz)   # x2: both halves of pay
    return FieldSolution(r, z, np.array(times), np.array(frames, dtype=np.float32), cell_vol, time.perf_counter() - t0)


def enthalpy_gj(theta: np.ndarray, cell_vol: np.ndarray) -> float:
    """Enthalpy above reservoir temperature, GJ."""
    return float(np.sum(theta * cell_vol) * M_R * (T_S - T_R) / 1e9)


# ───────────────────────────────── PINN ─────────────────────────────────

@dataclass
class TrainConfig:
    hidden: int = 64
    layers: int = 3
    iterations: int = 4000
    lr: float = 2e-3
    n_colloc: int = 2048
    n_bc: int = 256
    n_energy_times: int = 8
    w_energy: float = 100.0
    energy_ramp: tuple = (0.4, 0.6)   # off until 40% of training, full weight by 60%
    train_rh: tuple = (10.0, 13.0, 16.0, 19.0, 22.0)
    holdout_rh: tuple = (14.5, 20.5)
    sensor_noise_c: float = 0.5
    log_every: int = 100
    val_every: int = 500
    seed: int = 42


@dataclass
class TrainedPINN:
    weights: List[np.ndarray]          # [W1, b1, W2, b2, ..., Wout, bout]
    history: List[Dict[str, float]] = field(default_factory=list)
    train_seconds: float = 0.0

    # ---- NumPy inference (no torch needed at run time) ----
    def theta(self, r, z, t, r_h):
        r, z, t, r_h = np.broadcast_arrays(*(np.asarray(a, dtype=float) for a in (r, z, t, r_h)))
        x = np.stack([r / R_MAX, z / Z_MAX, t / T_END, _rh_norm(r_h)], axis=-1)
        h = x
        for i in range(0, len(self.weights) - 2, 2):
            h = np.tanh(h @ self.weights[i] + self.weights[i + 1])
        nn = (h @ self.weights[-2] + self.weights[-1])[..., 0]
        return theta0(r, z, r_h) + (t / T_END) * envelope(r, z, r_h) * nn

    def temperature_c(self, r, z, t, r_h):
        return T_R + (T_S - T_R) * self.theta(r, z, t, r_h)

    def n_params(self) -> int:
        return int(sum(w.size for w in self.weights))

    def save(self, path: str) -> None:
        np.savez(path, **{f"w{i}": w for i, w in enumerate(self.weights)},
                 R_MAX=R_MAX, Z_MAX=Z_MAX, T_END=T_END, ALPHA=ALPHA, T_R=T_R, T_S=T_S)

    @classmethod
    def load(cls, path: str) -> 'TrainedPINN':
        d = np.load(path)
        n = len([k for k in d.files if k.startswith('w')])
        return cls([d[f"w{i}"] for i in range(n)])


def _rh_norm(r_h):
    return (np.asarray(r_h) - RH_RANGE[0]) / (RH_RANGE[1] - RH_RANGE[0])


def _sensor_data(solutions: Dict[float, FieldSolution], noise_c: float, rng) -> np.ndarray:
    """DTS fibre in the wellbore (r ~ 0) every 2 m, plus observation wells at 8 m and 20 m, every 4 days."""
    rows = []
    for r_h, sol in solutions.items():
        ti = np.arange(0, len(sol.t), 4)
        for r_obs in (sol.r[0], 8.0, 20.0):
            ir = int(np.argmin(np.abs(sol.r - r_obs)))
            for iz in range(0, len(sol.z), 4):
                for it in ti:
                    rows.append((sol.r[ir], sol.z[iz], sol.t[it], r_h, sol.theta[it, ir, iz]))
    data = np.array(rows)
    data[:, 4] += rng.normal(0.0, noise_c / (T_S - T_R), len(data))
    return data


def train_pinn(cfg: Optional[TrainConfig] = None, verbose: bool = True) -> Dict:
    """
    Solve the ground truth, train the PINN, validate on held-out designs, audit energy.
    Returns a dict with the trained model and everything needed for reporting.
    """
    import torch  # training-only dependency
    DT = torch.float32

    cfg = cfg or TrainConfig()
    torch.manual_seed(cfg.seed)
    torch.set_num_threads(2)  # small per-thread buffers: trains on low-memory laptops
    rng = np.random.default_rng(cfg.seed)

    solutions = {rh: solve_cooling(rh) for rh in cfg.train_rh}
    holdout = {rh: solve_cooling(rh) for rh in cfg.holdout_rh}
    data = torch.tensor(_sensor_data(solutions, cfg.sensor_noise_c, rng), dtype=DT)

    dims = [4] + [cfg.hidden] * cfg.layers + [1]
    net = torch.nn.Sequential(*[m for i in range(len(dims) - 1) for m in
                                ([torch.nn.Linear(dims[i], dims[i + 1])] + ([torch.nn.Tanh()] if i < len(dims) - 2 else []))]).to(DT)
    opt = torch.optim.Adam(net.parameters(), lr=cfg.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.iterations, eta_min=cfg.lr * 0.02)

    def theta_t(r, z, t, rh):
        x = torch.stack([r / R_MAX, z / Z_MAX, t / T_END, (rh - RH_RANGE[0]) / (RH_RANGE[1] - RH_RANGE[0])], dim=-1)
        th0 = torch.sigmoid((rh - r) / FRONT_W) * torch.sigmoid((HALF_PAY - z) / FRONT_W)
        env = torch.exp(-(((r - rh).clamp(min=0) / REACH) ** 2 + ((z - HALF_PAY).clamp(min=0) / REACH) ** 2))
        return th0 + (t / T_END) * env * net(x)[..., 0]

    def grad(y, x):
        return torch.autograd.grad(y, x, torch.ones_like(y), create_graph=True)[0]

    # Conservation loss: total enthalpy on a 1 m quadrature grid must stay at its t = 0 value.
    # Pointwise losses barely see a small far-field bias, but over this much rock it adds up to
    # a large energy error, so the conservation law itself is trained, not only audited.
    rq = torch.arange(0.5, R_MAX, 1.0, dtype=DT)
    zq = torch.arange(0.5, Z_MAX, 1.0, dtype=DT)
    Rq, Zq = torch.meshgrid(rq, zq, indexing='ij')
    Rq, Zq, Wq = Rq.reshape(-1), Zq.reshape(-1), (2 * np.pi * Rq).reshape(-1)

    def energy_loss(weight):
        k = cfg.n_energy_times
        t = torch.empty(k, dtype=DT).uniform_(T_END * 0.05, T_END)
        rh = torch.empty(k, dtype=DT).uniform_(*RH_RANGE)
        n = Rq.numel()
        th = theta_t(Rq.repeat(k), Zq.repeat(k), t.repeat_interleave(n), rh.repeat_interleave(n)).view(k, n)
        th0 = (torch.sigmoid((rh[:, None] - Rq) / FRONT_W) * torch.sigmoid((HALF_PAY - Zq) / FRONT_W))
        ratio = (th * Wq).sum(1) / (th0 * Wq).sum(1)
        return weight * ((ratio - 1.0) ** 2).mean()

    def sample_colloc(n):
        rh = torch.empty(n, dtype=DT).uniform_(*RH_RANGE)
        # half the points near the thermal front, where the physics is hardest
        near = n // 2
        r = torch.cat([torch.empty(n - near, dtype=DT).uniform_(0.2, R_MAX),
                       (rh[:near] + torch.empty(near, dtype=DT).uniform_(-8, 8)).clamp(0.2, R_MAX)])
        z = torch.cat([torch.empty(n - near, dtype=DT).uniform_(0, Z_MAX),
                       torch.empty(near, dtype=DT).uniform_(0, HALF_PAY + 8)])
        t = torch.empty(n, dtype=DT).uniform_(0, T_END)
        return [v.requires_grad_(True) for v in (r, z, t)] + [rh]

    def losses(w_e):
        r, z, t, rh = sample_colloc(cfg.n_colloc)
        th = theta_t(r, z, t, rh)
        th_r, th_z, th_t = grad(th, r), grad(th, z), grad(th, t)
        th_rr, th_zz = grad(th_r, r), grad(th_z, z)
        # residual scaled by the horizon so it is O(1): T_END*(dθ/dt − α∇²θ)
        res = T_END * (th_t - ALPHA * (th_rr + th_r / r + th_zz))
        l_pde = (res ** 2).mean()

        pred = theta_t(data[:, 0], data[:, 1], data[:, 2], data[:, 3])
        l_data = ((pred - data[:, 4]) ** 2).mean() * 1e3

        n = cfg.n_bc
        rh_b = torch.empty(n, dtype=DT).uniform_(*RH_RANGE)
        tb = torch.empty(n, dtype=DT).uniform_(0, T_END)
        zb = torch.empty(n, dtype=DT).uniform_(0, Z_MAX)
        rb = torch.empty(n, dtype=DT).uniform_(0.2, R_MAX)
        r_edge = torch.full((n,), R_MAX, dtype=DT, requires_grad=True)
        z_mid = torch.zeros(n, dtype=DT, requires_grad=True)
        z_top = torch.full((n,), Z_MAX, dtype=DT, requires_grad=True)
        l_bc = (grad(theta_t(r_edge, zb, tb, rh_b), r_edge) ** 2).mean() \
            + (grad(theta_t(rb, z_mid, tb, rh_b), z_mid) ** 2).mean() \
            + (grad(theta_t(rb, z_top, tb, rh_b), z_top) ** 2).mean()
        l_bc = l_bc * Z_MAX ** 2
        return l_pde, l_data, l_bc, energy_loss(w_e)

    def export():
        ws = []
        for m in net:
            if isinstance(m, torch.nn.Linear):
                ws += [m.weight.detach().numpy().T.astype(np.float64), m.bias.detach().numpy().astype(np.float64)]
        return TrainedPINN(ws)

    history, t_start = [], time.perf_counter()
    for it in range(1, cfg.iterations + 1):
        opt.zero_grad()
        a, b = cfg.energy_ramp
        w_e = cfg.w_energy * min(1.0, max(0.0, (it / cfg.iterations - a) / (b - a)))
        l_pde, l_data, l_bc, l_energy = losses(w_e)
        loss = l_pde + l_data + l_bc + l_energy
        loss.backward()
        opt.step()
        sched.step()
        if it % cfg.log_every == 0 or it == 1:
            row = {'iter': it, 'loss': loss.item(), 'pde': l_pde.item(), 'data': l_data.item(), 'bc': l_bc.item(), 'energy': l_energy.item()}
            if it % cfg.val_every == 0 or it == cfg.iterations:
                row.update(_holdout_error(export(), holdout))
            history.append(row)
            if verbose and (it % cfg.val_every == 0 or it == 1):
                extra = f"  held-out RMSE {row['val_rmse_c']:.2f} C" if 'val_rmse_c' in row else ''
                print(f"      iter {it:5d}  loss {row['loss']:.3e}  (pde {row['pde']:.2e}, data {row['data']:.2e}, bc {row['bc']:.2e}, energy {row['energy']:.2e}){extra}")

    model = export()
    model.history = history
    model.train_seconds = time.perf_counter() - t_start
    return {'model': model, 'solutions': solutions, 'holdout': holdout, 'config': cfg}


def _holdout_error(model: TrainedPINN, holdout: Dict[float, FieldSolution]) -> Dict[str, float]:
    errs = []
    for rh, sol in holdout.items():
        ti = np.arange(0, len(sol.t), 10)
        R, Z = np.meshgrid(sol.r[::2], sol.z[::2], indexing='ij')
        for it in ti:
            pred = model.theta(R, Z, sol.t[it], rh)
            errs.append((pred - sol.theta[it, ::2, ::2]).ravel())
    e = np.concatenate(errs) * (T_S - T_R)
    return {'val_rmse_c': float(np.sqrt(np.mean(e ** 2))), 'val_max_c': float(np.max(np.abs(e)))}


def energy_audit(model: TrainedPINN, r_h: float, sol: FieldSolution, limit_pct: float = 2.0) -> Dict:
    """
    First-principles gate: boundaries are insulated, so enthalpy must stay at its injected value.
    The PINN is checked on its own field, day by day; the solver is shown as the reference.
    """
    R, Z = np.meshgrid(sol.r, sol.z, indexing='ij')
    E0 = enthalpy_gj(sol.theta[0], sol.cell_vol)
    days = list(range(0, int(T_END) + 1, 10))
    pinn_pct, fd_pct = [], []
    for d in days:
        it = int(np.argmin(np.abs(sol.t - d)))
        pinn_pct.append(100.0 * (enthalpy_gj(model.theta(R, Z, sol.t[it], r_h), sol.cell_vol) / E0 - 1.0))
        fd_pct.append(100.0 * (enthalpy_gj(sol.theta[it], sol.cell_vol) / E0 - 1.0))
    worst = float(max(abs(x) for x in pinn_pct))
    return {
        'r_h': r_h, 'injected_gj': E0, 'days': days,
        'pinn_imbalance_pct': pinn_pct, 'solver_imbalance_pct': fd_pct,
        'max_imbalance_pct': worst, 'limit_pct': limit_pct, 'passed': worst <= limit_pct,
    }


def report(result: Dict) -> Dict:
    """Everything the dashboard shows, as plain JSON-able numbers."""
    model: TrainedPINN = result['model']
    cfg: TrainConfig = result['config']
    holdout: Dict[float, FieldSolution] = result['holdout']
    rh_show = cfg.holdout_rh[0]
    sol = holdout[rh_show]

    per_design = {f"{rh:g}": _holdout_error(model, {rh: s}) for rh, s in holdout.items()}
    audit = energy_audit(model, rh_show, sol)

    # radial temperature profiles at mid-pay for the held-out design
    iz = 0
    profiles = []
    for d in (0, 30, 60, 120):
        it = int(np.argmin(np.abs(sol.t - d)))
        T_fd = T_R + (T_S - T_R) * sol.theta[it, :, iz]
        T_nn = model.temperature_c(sol.r, sol.z[iz], sol.t[it], rh_show)
        profiles.append({'day': d, 'r': sol.r[::2].round(2).tolist(),
                         'solver_c': T_fd[::2].round(2).tolist(), 'pinn_c': T_nn[::2].round(2).tolist()})

    # heated-zone average temperature T-bar(t): what the reservoir model consumes
    mask = (sol.r[:, None] < rh_show) & (sol.z[None, :] < HALF_PAY)
    w = sol.cell_vol * mask
    R, Z = np.meshgrid(sol.r, sol.z, indexing='ij')
    tbar = []
    for it in range(0, len(sol.t), 5):
        fd = T_R + (T_S - T_R) * float(np.sum(sol.theta[it] * w) / np.sum(w))
        nn = T_R + (T_S - T_R) * float(np.sum(model.theta(R, Z, sol.t[it], rh_show) * w) / np.sum(w))
        tbar.append({'day': round(float(sol.t[it]), 1), 'solver_c': round(fd, 2), 'pinn_c': round(nn, 2)})

    # speed: full-field solve from scratch vs one surrogate evaluation of the same field
    t0 = time.perf_counter()
    for _ in range(20):
        model.theta(R, Z, T_END, rh_show)
    pinn_s = (time.perf_counter() - t0) / 20
    fresh = solve_cooling(rh_show, save_every_days=T_END)

    val = _holdout_error(model, holdout)
    accurate = val['val_rmse_c'] <= RMSE_LIMIT_C
    return {
        'status': 'trained' if (audit['passed'] and accurate) else 'rejected',
        'gates': {'rmse_limit_c': RMSE_LIMIT_C, 'accurate': accurate, 'energy_audit_passed': audit['passed']},
        'trained_at': time.strftime('%Y-%m-%d %H:%M'),
        'architecture': {'inputs': ['r', 'z', 't', 'r_h'], 'hidden': [cfg.hidden] * cfg.layers,
                         'activation': 'tanh', 'parameters': model.n_params(),
                         'initial_condition': 'hard-constrained'},
        'physics': {'pde': 'axisymmetric conduction', 'alpha_m2_per_day': ALPHA, 'pay_m': 2 * HALF_PAY,
                    'domain_m': [R_MAX, Z_MAX], 'horizon_days': T_END, 'T_R_c': T_R, 'T_s_c': T_S,
                    'r_h_range_m': list(RH_RANGE)},
        'training': {'iterations': cfg.iterations, 'collocation_per_iter': cfg.n_colloc,
                     'train_designs_r_h': list(cfg.train_rh), 'holdout_designs_r_h': list(cfg.holdout_rh),
                     'sensor_noise_c': cfg.sensor_noise_c, 'seconds': round(model.train_seconds, 1),
                     'sensors': 'DTS fibre in wellbore (every 2 m) + observation wells at 8 m and 20 m, every 4 days'},
        'history': model.history,
        'validation': {'holdout': per_design, **val},
        'energy_audit': audit,
        'profiles': {'r_h': rh_show, 'z': 0.0, 'curves': profiles},
        'tbar': {'r_h': rh_show, 'curve': tbar},
        'speed': {'solver_ms': round(fresh.solve_seconds * 1000, 1), 'pinn_ms': round(pinn_s * 1000, 2),
                  'speedup': round(fresh.solve_seconds / max(pinn_s, 1e-9), 1)},
    }
