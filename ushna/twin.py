"""
Server-side twin: the same coupling chain as the browser (frontend/src/data/twin.js),
T_bar -> T_pump -> mu(T_pump) -> FMI -> SPM, built on ushna.physics.

Where a physics function has the same form as the browser it is called directly
(Walther, Marx-Langenheim, Boberg-Lantz, radial composite inflow). The tubing
profile, distributed FMI, surface loads, stopping rule, MPC grid and safety envelope
have no Python counterpart (ushna/physics/wellbore.py is a stub), so they are
ported line for line from twin.js. tests/test_twin_parity.py checks the two agree.

Default calibration only: the browser's editable calibration is not mirrored here.
"""

import math

from ushna.physics.reservoir import (
    boberg_lantz_temperature,
    marx_langenheim_heated_volume,
    radial_composite_inflow,
)
from ushna.physics.viscosity import WaltherViscosityModel

FIELD = dict(
    T_R=47.0, T_s=250.0, T_surf=30.0, gradGeo=0.019,
    pay=20.0, rw=0.1, re=60.0,
    pumpDepth=1100.0, stroke=1.22,
    tInj=8, tSoak=5, horizon=120,
    T_onset=58.0,
    fmiLimit=0.15, fillageLimit=0.85, torqueRating=51.5,
    oilPrice=6300.0, steamCost=2000.0, powerCost=8.0, opex=16000.0, failCost=1.2e6,
    rho=0.95,
)

ROD = dict(
    sections=[
        dict(name='1" steel', to=760.0, d=0.0254, w=40.9),
        dict(name='7/8" steel', to=1030.0, d=0.0222, w=31.4),
        dict(name='1.5" sinker', to=1100.0, d=0.0381, w=90.0),
    ],
    tubingID=0.062, buoy=0.88, coupling=2.5, fric=2.5, plunger=250.0, plungerIn=1.06,
)

WELLS = [
    dict(id='BGW-07', cycle=4, day=41, kh=1.0, skin=3.4, heatLoss=1.0, steam=2600, soak=5, spm=6.2),
    dict(id='BGW-04', cycle=6, day=12, kh=1.15, skin=2.1, heatLoss=0.9, steam=3000, soak=6, spm=6.8),
    dict(id='BGW-11', cycle=3, day=63, kh=0.85, skin=4.2, heatLoss=1.1, steam=2400, soak=5, spm=5.4),
    dict(id='BGW-02', cycle=5, day=27, kh=1.05, skin=2.8, heatLoss=1.0, steam=2800, soak=4, spm=6.5),
    dict(id='BGW-15', cycle=2, day=49, kh=0.95, skin=3.0, heatLoss=1.2, steam=2500, soak=5, spm=5.0),
    dict(id='BGW-09', cycle=4, day=5, kh=1.1, skin=2.5, heatLoss=0.95, steam=2700, soak=6, spm=6.0),
]
WELL_BY_ID = {w['id']: w for w in WELLS}

FMI_BINDING = 'FMI(z) > 0.15'
TORQUE_BINDING = 'Gearbox torque ≤ rating'


# ── Viscosity: Walther through mu(50 C) = 11,500 cP and mu(250 C) = 14 cP ──
def _fit_walther(mu50, rho):
    y = lambda mu: math.log10(math.log10(mu / rho + 0.7))
    x1, x2 = math.log10(323.15), math.log10(523.15)
    B = (y(mu50) - y(14)) / (x2 - x1)
    return WaltherViscosityModel(A=y(mu50) + B * x1, B=B)


WALTHER = _fit_walther(11500, FIELD['rho'])


def viscosity(t_c):
    """Dynamic viscosity (cP) at t_c (deg C)."""
    return float(WALTHER.dynamic_viscosity(t_c + 273.15, FIELD['rho']))


# ── Marx-Langenheim heated radius ──
def heated_radius(steam_t, day=FIELD['tInj'], t_inj=FIELD['tInj']):
    Q = steam_t * 1e3 * 2.33e6 / (t_inj * 86400)  # W, wet steam enthalpy above 30 C
    _, r_h = marx_langenheim_heated_volume(
        Q_i=Q, M_R=2.5e6, delta_T=FIELD['T_s'] - FIELD['T_R'], k_ob=1.7, alpha_ob=8e-7,
        h=FIELD['pay'], t=max(day, 1e-3) * 86400)
    return float(r_h)


# ── Ramey: tubing fluid temperature above the pump ──
DZ = 20


def tubing_profile(t_pump, gross):
    L, Ar, g = FIELD['pumpDepth'], 900 + 6 * gross, FIELD['gradGeo']
    tg = lambda z: FIELD['T_surf'] + g * z
    out = []
    for z in range(0, int(L) + 1, DZ):
        e = math.exp(-(L - z) / Ar)
        T = tg(z) + g * Ar * (1 - e) + (t_pump - tg(L)) * e
        out.append(dict(z=z, T=T, Tgeo=tg(z), mu=viscosity(T)))
    return out


def _section_at(z):
    return next((s for s in ROD['sections'] if z < s['to']), ROD['sections'][-1])


def rod_velocity(spm, down=1.0):
    return math.pi * FIELD['stroke'] * spm / 60 * down  # peak downstroke, m/s


# ── Float Margin Index along the string (distributed form of float_margin_index) ──
def fmi_profile(profile, spm, down=1.0):
    v = rod_velocity(spm, down)
    out = [None] * len(profile)
    W, F = 0.0, ROD['plunger'] * (profile[-1]['mu'] / 1000) * v
    for i in range(len(profile) - 1, -1, -1):
        z, mu = profile[i]['z'], profile[i]['mu']
        s = _section_at(z)
        W += s['w'] * ROD['buoy'] * DZ
        f_drag = ROD['coupling'] * 2 * math.pi * (mu / 1000) * v / math.log(ROD['tubingID'] / min(s['d'], 0.05))
        F += (f_drag + ROD['fric']) * DZ
        out[i] = dict(z=z, fmi=(W - F) / W, W=W, F=F)
    return out


def _min_by(rows, k):
    return min(rows, key=lambda r: r[k])  # first minimum, as in twin.js


# ── Surface loads, torque, power, Goodman ──
def loads(fmi_rows, spm, down, gross):
    top = fmi_rows[0]
    u = 1 / (2 - 1 / down)
    S_in = FIELD['stroke'] * 39.37
    acc_up, acc_dn = S_in * (spm * u) ** 2 / 70500, S_in * (spm * down) ** 2 / 70500
    Wf = FIELD['rho'] * 1000 * 9.81 * FIELD['pumpDepth'] * math.pi * (ROD['plungerIn'] * 0.0254) ** 2 / 4
    drag_up = top['F'] * u / max(down, 1e-6) * 0.6
    PPRL = top['W'] * (1 + acc_up) + Wf + drag_up
    MPRL = top['W'] * (1 - acc_dn) - top['F']
    torque = ((PPRL - MPRL) / 2 * FIELD['stroke'] / 2) / 1000
    area = math.pi * 0.0254 ** 2 / 4
    s_max, s_min = PPRL / area / 1e6, MPRL / area / 1e6
    SA = (793 / 4 + 0.5625 * s_min) * 0.9
    goodman = (s_max - s_min) / (SA - s_min)
    hyd = gross * 1.84e-6 * FIELD['rho'] * 1000 * 9.81 * FIELD['pumpDepth']
    power_kw = (hyd + top['F'] * rod_velocity(spm, down) * 0.5) / 0.55 / 1000
    return dict(PPRL=PPRL, MPRL=MPRL, torque=torque, sMax=s_max, sMin=s_min, SA=SA, goodman=goodman,
                powerKW=power_kw, dragDown=top['F'], Wf=Wf, accUp=acc_up, accDn=acc_dn)


def displacement(spm):
    return 0.1166 * FIELD['stroke'] * 39.37 * ROD['plungerIn'] ** 2 * spm  # bbl/d


def _water_cut(p):
    return 0.3 + 0.25 * math.exp(-p / 8)


# ── Cycle simulation: Boberg-Lantz decline + radial composite inflow + delta coupling ──
ALPHA_EFF, J, K_DELTA = 0.9, 1.05e6, 1.4e-4


def _inflow(well, mu_h, mu_c, rh, skin=None):
    # Skin enters as an effective wellbore radius r_w·e^(-s), which gives mu_h·[ln(r_h/r_w) + s].
    s = well['skin'] if skin is None else skin
    return float(radial_composite_inflow(
        k=J * well['kh'] / (2 * math.pi), k_ro=1.0, h=1.0, P_R_bar=1.0, P_wf=0.0,
        mu_h=mu_h, mu_c=mu_c, r_h=rh, r_w=FIELD['rw'] * math.exp(-s), r_e=FIELD['re'], s=0.0))


def simulate(well, setpoint=None, from_day=0, with_fmi=True, design=None):
    steam = (design or {}).get('steam', well['steam'])
    soak = (design or {}).get('soak', well['soak'])
    eta = 1 - math.exp(-soak / 2.5)
    rh = heated_radius(steam) * (0.75 + 0.25 * eta)
    mu_c = viscosity(FIELD['T_R'])
    rows = []
    delta, cum_oil, cum_gross = 0.012 * soak, 0.0, 0.0
    for p in range(FIELD['horizon'] + 1):
        sp = dict(spm=well['spm'], down=1) if p < from_day or not setpoint else setpoint
        t = p + soak
        tDr = ALPHA_EFF * well['heatLoss'] * t / (rh * rh)
        tDv = 4 * ALPHA_EFF * well['heatLoss'] * t / (FIELD['pay'] ** 2)
        f_HD, f_VD = 1 / (1 + 5 * tDr), 1 / math.sqrt(1 + 5 * tDv)
        t_bar = boberg_lantz_temperature(FIELD['T_R'], FIELD['T_s'], f_VD, f_HD, delta)
        t_pump = FIELD['T_R'] + (t_bar - FIELD['T_R']) * 0.9
        mu_h, mu = viscosity(t_bar), viscosity(t_pump)
        inflow = _inflow(well, mu_h, mu_c, rh)
        disp = displacement(sp['spm'])
        gross = min(inflow, disp * 0.97)
        fillage = min(1, inflow / disp)
        oil = gross * (1 - _water_cut(p))
        cum_oil += oil
        cum_gross += gross
        row = dict(p=p, Tbar=t_bar, Tpump=t_pump, muH=mu_h, mu=mu, inflow=inflow, gross=gross, oil=oil,
                   fillage=fillage, cumOil=cum_oil, delta=delta, rh=rh, spm=sp['spm'], down=sp['down'],
                   waterCut=_water_cut(p))
        if with_fmi:
            fr = fmi_profile(tubing_profile(t_pump, gross), sp['spm'], sp['down'])
            m = _min_by(fr, 'fmi')
            L = loads(fr, sp['spm'], sp['down'], gross)
            row.update(fmi=m['fmi'], fmiDepth=m['z'], torque=L['torque'], powerKW=L['powerKW'], goodman=L['goodman'])
            risk = 0.004 * math.exp(-(row['fmi'] - FIELD['fmiLimit']) / 0.05) + (0.002 if fillage < FIELD['fillageLimit'] else 0)
        else:
            row['powerKW'] = 2 + gross * 0.035
            risk = 0.002
        row['risk'] = min(risk, 0.05)
        row['profit'] = (oil * FIELD['oilPrice'] - row['powerKW'] * 24 * FIELD['powerCost']
                         - FIELD['opex'] - row['risk'] * FIELD['failCost'])
        rows.append(row)
        delta = min(0.97, delta + K_DELTA * gross * ((t_bar - FIELD['T_R']) / (FIELD['T_s'] - FIELD['T_R'])) + 0.002)
    return dict(rows=rows, rh=rh, steam=steam, soak=soak)


# ── Optimal stopping: stop when pi(t) <= pi* (renewal-reward) ──
def cutoff(rows, steam):
    cum = -(steam * FIELD['steamCost'] + (FIELD['tInj'] + 5) * FIELD['opex'])
    best, rate = -math.inf, 0.0
    for i, r in enumerate(rows):
        cum += r['profit']
        rate = cum / (i + 1 + FIELD['tInj'] + 5)
        best = max(best, rate)
    peak = max(range(len(rows)), key=lambda i: (rows[i]['profit'], -i))
    hit = next((r for i, r in enumerate(rows) if i > peak and r['profit'] <= best), None)
    return dict(piStar=best, day=hit['p'] if hit else FIELD['horizon'], rateToHorizon=rate)


def cycle_npv(rows, steam, stop_day):
    r = 0.12 / 365
    npv = -steam * FIELD['steamCost'] - (FIELD['tInj'] + 5) * FIELD['opex']
    for row in rows:
        if row['p'] > stop_day:
            break
        npv += row['profit'] / (1 + r) ** (row['p'] + 13)
    return npv


# ── MPC stand-in: grid search over (SPM, downstroke factor) at the Ramey-lag horizon ──
def mpc(well, day, horizon=2):
    r = simulate(well, with_fmi=False)['rows'][min(day + horizon, FIELD['horizon'])]
    prof = tubing_profile(r['Tpump'], r['gross'])
    best = None
    spm = 3.0
    while spm <= 8.001:
        down = 0.7
        while down <= 1.001:
            disp = displacement(spm)
            gross = min(r['inflow'], disp * 0.97)
            fill = min(1, r['inflow'] / disp)
            fr = fmi_profile(prof, spm, down)
            m = _min_by(fr, 'fmi')
            L = loads(fr, spm, down, gross)
            feasible = (m['fmi'] > FIELD['fmiLimit'] and fill >= FIELD['fillageLimit']
                        and L['torque'] <= FIELD['torqueRating'] and L['goodman'] <= 1)
            obj = (gross * (1 - r['waterCut']) * FIELD['oilPrice'] - L['powerKW'] * 24 * FIELD['powerCost']
                   - L['goodman'] ** 4 * 150000)
            if feasible and (best is None or obj > best['obj']):
                best = dict(spm=round(spm, 1), down=round(down, 2), obj=obj, fmi=m['fmi'], fill=fill,
                            torque=L['torque'], gross=gross)
            down += 0.05
        spm += 0.1
    return best or dict(spm=3, down=0.7, infeasible=True)


# ── Safety envelope: clamp a requested setpoint to hard physics bounds ──
def envelope(well, day, req):
    """Returns (applied, binding). binding is None when the request passes unchanged."""
    r = simulate(well, with_fmi=False)['rows'][day]
    prof = tubing_profile(r['Tpump'], r['gross'])

    def check(spm):
        fr = fmi_profile(prof, spm, req['down'])
        L = loads(fr, spm, req['down'], min(r['inflow'], displacement(spm)))
        if _min_by(fr, 'fmi')['fmi'] <= FIELD['fmiLimit']:
            return FMI_BINDING
        if L['torque'] > FIELD['torqueRating']:
            return TORQUE_BINDING
        return None

    binding = check(req['spm'])
    if not binding:
        return dict(req), None
    spm = req['spm']
    while spm > 2 and check(spm):
        spm = round(spm - 0.1, 1)
    return dict(req, spm=spm), binding


# ── Full state for one well (same keys as twin.js buildState) ──
def build_state(well, day, setpoint=None):
    sp = setpoint or dict(spm=well['spm'], down=1)
    sim = simulate(well, setpoint=sp, from_day=day)
    rows = sim['rows']
    base = simulate(well)['rows'] if setpoint else rows
    now, ago = rows[day], rows[max(0, day - 4)]
    ahead = rows[min(day + 2, FIELD['horizon'])]
    prof = tubing_profile(now['Tpump'], now['gross'])
    fmi_z = fmi_profile(prof, sp['spm'], sp['down'])
    L = loads(fmi_z, sp['spm'], sp['down'], now['gross'])
    cut = cutoff(rows, sim['steam'])
    lo = cutoff(simulate(dict(well, kh=well['kh'] * 0.9), setpoint=sp, from_day=day, with_fmi=False)['rows'], sim['steam'])['day']
    hi = cutoff(simulate(dict(well, kh=well['kh'] * 1.1), setpoint=sp, from_day=day, with_fmi=False)['rows'], sim['steam'])['day']
    steam_bbl = sim['steam'] * 6.29
    s = 9.0
    pr = tubing_profile(ahead['Tpump'], ahead['gross'])
    while s > 2 and _min_by(fmi_profile(pr, s, sp['down']), 'fmi')['fmi'] <= FIELD['fmiLimit']:
        s -= 0.1
    return dict(
        well=well, day=day, sp=sp, rows=rows, base=base, now=now, ago=ago, ahead=ahead, prof=prof, fmiZ=fmi_z,
        loads=L, rh=sim['rh'], steam=sim['steam'],
        cut=dict(cut, band=max(1, round((hi - lo) / 2))),
        sor=steam_bbl / max(now['cumOil'], 1),
        sorAtCut=steam_bbl / max(rows[cut['day']]['cumOil'], 1),
        npv=cycle_npv(rows, sim['steam'], cut['day']),
        mpc=mpc(well, day), spmMax=round(s, 1),
        fmiMin=_min_by(fmi_z, 'fmi'),
        phase='Production',
        asphaltene=now['Tpump'] < FIELD['T_onset'],
    )


def build_lite(well, day, sp):
    """Outcome of a setpoint at `day` without the full cycle: gross, FMI, drag, Goodman."""
    r = simulate(well, with_fmi=False)['rows'][day]
    prof = tubing_profile(r['Tpump'], r['gross'])
    gross = min(r['inflow'], displacement(sp['spm']) * 0.97)
    fr = fmi_profile(prof, sp['spm'], sp['down'])
    L = loads(fr, sp['spm'], sp['down'], gross)
    return dict(gross=gross, fmi=_min_by(fr, 'fmi')['fmi'], dragDown=L['dragDown'], goodman=L['goodman'])
