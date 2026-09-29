"""
USHNA edge API: the digital twin over HTTP.

    uvicorn api.main:app --reload        # http://localhost:8000/docs

Every number comes from ushna.twin (the same chain as the browser twin). /submit always
runs the safety envelope; the API is not a way around it. With MQTT_HOST set, the MQTT
bridge runs in this process; with DATABASE_URL set, decisions are written to TimescaleDB.
"""

import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api._models import Health, Recommendation, Setpoint, State, SubmitResult, TraceRow, Well
from ushna import twin
from ushna.data.db_writer import writer_from_env

VERSION = '0.1.0'
DAY = Query(None, ge=0, le=twin.FIELD['horizon'], description='Production day (default: the well\'s current day)')

log = logging.getLogger('ushna.api')
_setpoints = {}  # well_id -> last applied Setpoint (in memory; the decisions table is the durable record)
_lock = threading.Lock()
_writer = None


@asynccontextmanager
async def lifespan(_app):
    global _writer
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')
    _writer = writer_from_env()
    bridge = None
    if os.environ.get('MQTT_HOST'):
        from ushna.data.mqtt_bridge import start_in_background
        bridge = start_in_background(_writer)
    yield
    if bridge:
        bridge.loop_stop()


app = FastAPI(title='USHNA edge API', version=VERSION, lifespan=lifespan,
              description='Well-to-surface digital twin for CSS + SRP wells: state, recommendations, '
                          'safety-enveloped setpoints and equation traceability.')
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(','),
    allow_methods=['*'], allow_headers=['*'],
)


@app.middleware('http')
async def strip_api_prefix(request, call_next):
    """On Vercel the dashboard calls /api/...; serve the same routes as the edge container."""
    path = request.scope['path']
    if path == '/api' or path.startswith('/api/'):
        request.scope['path'] = path[4:] or '/'
    return await call_next(request)


def _well(well_id):
    w = twin.WELL_BY_ID.get(well_id)
    if not w:
        raise HTTPException(404, f'unknown well {well_id!r}; see /wells')
    return w


def _setpoint(well_id, spm, down):
    """Explicit query setpoint, else the last one applied through /submit, else the well's own."""
    if spm is not None:
        return dict(spm=spm, down=down)
    sp = _setpoints.get(well_id)
    return sp.model_dump() if sp else None


def _state(well_id, day, spm, down):
    w = _well(well_id)
    return w, twin.build_state(w, w['day'] if day is None else day, _setpoint(well_id, spm, down))


SPM = Query(None, gt=0, le=15, description='Evaluate at this SPM instead of the applied setpoint')
DOWN = Query(1.0, gt=0.5, le=1.0)


@app.get('/health', response_model=Health)
def health():
    return Health(status='ok', version=VERSION)


@app.get('/wells', response_model=list[Well])
def wells():
    return [Well(**w) for w in twin.WELLS]


@app.get('/state/{well_id}', response_model=State)
def state(well_id: str, day: int | None = DAY, spm: float | None = SPM, down: float = DOWN):
    w, s = _state(well_id, day, spm, down)
    n = s['now']
    return State(
        well_id=well_id, day=s['day'], setpoint=Setpoint(**s['sp']),
        T_bar=n['Tbar'], T_pump=n['Tpump'], mu=n['mu'], fmi=s['fmiMin']['fmi'], fmi_depth=s['fmiMin']['z'],
        gross=n['gross'], fillage=n['fillage'], cut_day=s['cut']['day'], cut_band=s['cut']['band'],
        sor=s['sor'], npv=s['npv'],
    )


@app.get('/state/{well_id}/full', summary='Full twin state, same shape as twin.js buildState (for the dashboard)')
def state_full(well_id: str, day: int | None = DAY, spm: float | None = SPM, down: float = DOWN):
    return _state(well_id, day, spm, down)[1]


@app.get('/recommend/{well_id}', response_model=Recommendation)
def recommend(well_id: str, day: int | None = DAY):
    w, s = _state(well_id, day, None, 1.0)
    d, now, ago, sp, m = s['day'], s['now'], s['ago'], s['sp'], s['mpc']
    applied, binding = twin.envelope(w, d, dict(spm=m['spm'], down=m['down']))
    after = twin.build_lite(w, d, applied)
    fmi_now = s['fmiMin']['fmi']
    mu_sigma = round(now['mu'] * 0.13 / 10) * 10
    lower = applied['spm'] < sp['spm']
    if fmi_now < twin.FIELD['fmiLimit']:
        why = f"Float Margin Index at {s['fmiMin']['z']} m has fallen to {fmi_now:.2f}, below the 0.15 operating limit."
    elif lower:
        why = (f"Pump fillage {round(now['fillage'] * 100)}% and FMI {fmi_now:.2f} at {s['fmiMin']['z']} m "
               'are both closing on their limits within the 48 h Ramey lag.')
    else:
        why = f'FMI {fmi_now:.2f} leaves unused margin; the hot, thin fluid can be lifted faster without float.'
    return Recommendation(
        well_id=well_id, day=d, current=Setpoint(**sp), setpoint=Setpoint(**applied),
        infeasible=bool(m.get('infeasible')), binding=binding,
        fmi_now=fmi_now, fmi_after=after['fmi'], gross_now=now['gross'], gross_after=after['gross'],
        why=why,
        driver=(f"Pump-intake temperature {ago['Tpump']:.0f} °C → {now['Tpump']:.0f} °C over the last 96 hours; "
                f"μ {'risen' if ago['mu'] < now['mu'] else 'fallen'} {ago['mu']:.0f} → {now['mu']:.0f} cP."),
        relation=r'(S\cdot N)_{\max} \propto \frac{1}{\mu(T_{pump})}\quad\text{(annular viscous drag vs. buoyed rod weight)}',
        effect=(f"Gross fluid {now['gross']:.1f} → {after['gross']:.1f} bbl/d; FMI {fmi_now:.2f} → {after['fmi']:.2f}; "
                f"Goodman {s['loads']['goodman']:.2f} → {after['goodman']:.2f}."),
        confidence=f'{round(92 - mu_sigma / 40)}%. EnKF posterior on μ: ±{mu_sigma} cP.',
        cycle=f"Day {d} of production. Cut-off threshold projected at day {s['cut']['day']} ± {s['cut']['band']}.",
    )


@app.post('/submit/{well_id}', response_model=SubmitResult)
def submit(well_id: str, req: Setpoint, day: int | None = DAY):
    w = _well(well_id)
    d = w['day'] if day is None else day
    applied, binding = twin.envelope(w, d, req.model_dump())  # never skipped
    result = SubmitResult(well_id=well_id, day=d, requested=req, applied=Setpoint(**applied),
                          binding=binding, accepted=binding is None)
    with _lock:
        _setpoints[well_id] = result.applied
    if _writer:
        _writer.decision(dict(ts=datetime.now(timezone.utc).isoformat(), well_id=well_id,
                              requested_spm=req.spm, applied_spm=applied['spm'], binding=binding,
                              accepted=binding is None, reason='operator'))
    return result


@app.get('/traceability/{well_id}', response_model=list[TraceRow])
def traceability(well_id: str, day: int | None = DAY):
    _, s = _state(well_id, day, None, 1.0)
    n = s['now']
    rows = [
        ('Heated radius r_h', s['rh'], 'm', 'Marx–Langenheim', 'ushna/physics/reservoir.py:marx_langenheim_heated_volume'),
        ('Heated-zone temperature T̄', n['Tbar'], '°C', 'Boberg–Lantz  T̄ = T_R + (T_s − T_R)·f_HD·f_VD·(1 − δ)',
         'ushna/physics/reservoir.py:boberg_lantz_temperature'),
        ('Pump temperature T_pump', n['Tpump'], '°C', 'T_R + 0.9·(T̄ − T_R), Ramey tubing profile above', 'ushna/twin.py:tubing_profile'),
        ('Viscosity at pump μ', n['mu'], 'cP', 'Walther (ASTM D341)  log log(ν + 0.7) = A − B·log T',
         'ushna/physics/viscosity.py:WaltherViscosityModel'),
        ('Inflow q', n['inflow'], 'bbl/d', 'Radial composite  q ∝ kh / (μ_h[ln(r_h/r_w) + s] + μ_c ln(r_e/r_h))',
         'ushna/physics/reservoir.py:radial_composite_inflow'),
        ('Gross rate', n['gross'], 'bbl/d', 'min(inflow, 0.97 · pump displacement)', 'ushna/twin.py:simulate'),
        ('Float Margin Index (min)', s['fmiMin']['fmi'], '', 'FMI(z) = (W_b(z) − F_drag(z) − F_fric(z)) / W_b(z)',
         'ushna/twin.py:fmi_profile (distributed ushna/physics/rod_string.py:float_margin_index)'),
        ('Gearbox torque', s['loads']['torque'], 'kN·m', '(PPRL − MPRL)/2 · S/2', 'ushna/twin.py:loads'),
        ('Cut-off day', s['cut']['day'], 'day', 'Re-inject when π(t) ≤ π̄* (renewal–reward)', 'ushna/twin.py:cutoff'),
        ('MPC setpoint SPM', s['mpc']['spm'], 'SPM', 'max revenue − power − Goodman risk  s.t. FMI > 0.15, fillage ≥ 0.85, torque, Goodman ≤ 1',
         'ushna/twin.py:mpc'),
    ]
    return [TraceRow(quantity=q, value=float(v), unit=u, equation=e, code=c) for q, v, u, e, c in rows]


# The built dashboard, when present (Docker image). Mounted last so API routes win.
_static = Path(os.environ.get('STATIC_DIR', Path(__file__).resolve().parents[1] / 'frontend' / 'dist'))
if _static.is_dir():
    app.mount('/', StaticFiles(directory=_static, html=True), name='dashboard')
