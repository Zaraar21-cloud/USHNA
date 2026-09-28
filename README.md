# USHNA: Unified Steam, Hydraulics & Nodal Analysis

A physics-first digital twin for well-to-surface optimization of Cyclic Steam Stimulation (CSS) and Sucker Rod Pump (SRP) operations. Designed to address the specific challenges of heavy oil extraction at the Baghewala Heavy Oil Field, Rajasthan.

Developed for Smart India Hackathon (Problem Statement ID 26120, Oil India Limited).

## Project Overview

USHNA integrates thermal reservoir models with wellbore and surface equipment physics. The objective is to optimize steam injection and pumping schedules dynamically as reservoir viscosity changes, preventing equipment failures such as rod floating and fluid pound. 

The system prioritizes explicit conservation equations and physical constraints over black-box machine learning. Learning algorithms are strictly confined to parameter estimation, bounding residuals, and providing differentiable surrogates.

## Architecture

1. **Physics Core**
   * **Reservoir:** Marx-Langenheim (injection phase) and Boberg-Lantz (thermal decline).
   * **Wellbore:** Ramey transient heat transmission.
   * **Viscosity:** ASTM D341 Walther double-logarithmic coupling law.
   * **Rod String:** Gibbs damped wave equation and Float Margin Index (FMI) computation.

2. **Learning Layer**
   * Data assimilation via an Ensemble Kalman Filter (EnKF, NumPy) for real-time parameter updates (e.g., permeability, skin, heat loss).
   * Bounded residual learning with a Gaussian Process (NumPy).
   * Symbolic regression (NumPy) for closed-form, field-specific correlations.

3. **Optimization Layer**
   * Model Predictive Control (MPC) for real-time SRP command (stroke speed, VFD velocity profile).
   * CSS cycle design (steam volume, soak time) by NPV search over the design space.
   * Optimal stopping rules for production cut-off based on real-time net present value.

## Repository Layout

```
ushna/                  Python package
  physics/              reservoir, wellbore, viscosity, rod string
  data/                 synthetic generator, Arduino bridge, MQTT publisher/bridge, TimescaleDB writer
  ml/                   all ML: EnKF, PINN, GP residual, symbolic regression, card diagnosis
    train.py            training pipeline (python -m ushna.ml.train)
    artifacts/          trained weights, reports and discovered equations
  twin.py               server-side twin: the browser's coupling chain on ushna.physics
api/                    FastAPI edge service (uvicorn api.main:app)
db/schema.sql           TimescaleDB / Postgres schema
docker/                 Mosquitto config
tests/
  physics/              physics engine tests
  ml/                   ML component tests
  test_twin_parity.py, test_api.py, test_edge.py
frontend/               React dashboard (browser twin)
docs/                   data sources and UI design reference
Dockerfile, docker-compose.yml   the whole edge stack
```

## Implementation Status

* Phase 1 (done): Physics engine (Marx-Langenheim, Boberg-Lantz, Ramey, Walther viscosity, Gibbs wave equation, FMI) in `ushna/physics`.
* Phase 2 (done): Synthetic data generator mimicking field sensor data, noise and drift, in `ushna/data`.
* Phase 3 (done): AI layer in `ushna/ml`, trained artefacts in `ushna/ml/artifacts/`, tests in `tests/ml`:
  * **PINN** (`pinn_training.py`, PyTorch): learns the heated-zone temperature field T(r, z, t; r_h) from the heat equation plus sparse DTS / observation-well data. It is released to the optimizer only after passing an accuracy gate on steam designs it never saw and a first-principles energy-conservation audit.
  * **EnKF**: daily assimilation of temperature and rate into named physical parameters (kh, skin, heat loss, …) with uncertainty bands.
  * **Bounded GP residual**: learns what the physics misses, hard-capped at ±15%.
  * **Symbolic regression**: closed-form field correlations for engineer sign-off.
  * **Inverse card diagnosis**: fault mechanism from the dynamometer card.
* Phase 4 (partial): MPC and safety envelope run as a grid search over SPM and downstroke speed, in the browser twin (`frontend/src/data/twin.js`) and on the server (`ushna/twin.py`, checked against the browser by `tests/test_twin_parity.py`). A CasADi/IPOPT MPC is not built yet.
* Edge stack (done): FastAPI service, MQTT telemetry loop and TimescaleDB logging, packaged with Docker Compose.
* Prototype (done): React dashboard in `frontend/` that recomputes the full coupling chain live in the browser.

## Data

The prototype runs on **synthetic wells calibrated to published Baghewala parameters**. Oil India does not publish per-well telemetry for the field. Every anchor value and its citation is in [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Training the AI layer

```bash
pip install -r requirements.txt
python -m ushna.ml.train     # ~10 min on a laptop CPU; writes ushna/ml/artifacts/*
pytest                       # physics + ML test suite
```

The dashboard's **AI models** page reads `ushna/ml/artifacts/*.json` directly, so retraining updates the numbers it shows.

## Running the prototype

```bash
cd frontend
npm install
npm run dev     # http://localhost:3000
npm run check   # physics sanity checks on the browser twin
```

## Running the edge stack

```bash
docker compose up --build     # Mosquitto + TimescaleDB + edge (API, MQTT bridge, dashboard) + well simulator
```

Dashboard and API on http://localhost:8000 (OpenAPI docs at `/docs`). The simulator publishes one
message per well per second to `ushna/<well_id>/telemetry`; the edge runs the physics chain and the
safety envelope, publishes `ushna/<well_id>/setpoint` and logs to TimescaleDB. The edge keeps running
with the broker or the database down: it retries the broker and buffers rows until the database returns.

Without Docker:

```bash
pip install -r requirements-api.txt
uvicorn api.main:app --reload                 # API only
MQTT_HOST=localhost DATABASE_URL=postgresql://ushna:ushna@localhost/ushna uvicorn api.main:app   # + bridge + DB
python -m ushna.data.mqtt_publisher           # well simulator (needs a broker on localhost:1883)
```

The dashboard's header toggle switches between **Local** (physics in the browser, the default; works as
a static site) and **API** (reads state and submits setpoints through the edge service).

## Tech Stack

What is implemented today, and what the production deployment would use.

| Layer | Implemented | Production path |
|---|---|---|
| Physics core | Python (NumPy, SciPy, Numba); JavaScript twin in the browser | Same |
| Learning | EnKF, GP residual and symbolic regression written in NumPy; PINN in PyTorch | Same |
| Optimization | MPC and CSS design as grid searches; optimal-stopping rule | CasADi/IPOPT MPC, Bayesian optimization |
| Safety | Rule-based envelope, enforced in the browser, the API and the MQTT bridge | Same, plus PLC interlocks |
| Data & streaming | MQTT (Mosquitto, paho-mqtt) telemetry and setpoint topics | OPC-UA / Modbus RTU from field RTUs into MQTT |
| Storage | TimescaleDB hypertable (`telemetry`) and decision log (`decisions`) | Same, with retention and continuous aggregates |
| Backend | FastAPI with typed Pydantic models | Same, with auth |
| Frontend | React, Recharts, Tailwind, KaTeX | Same |
| Edge / cloud | Docker Compose: one edge image runs offline next to the well | Same image on an edge gateway, synced to cloud |

Python dependencies: `requirements.txt` (physics, ML, tests) and `requirements-api.txt` (edge service).
Python 3.10+.
