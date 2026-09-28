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
   * Data assimilation via Ensemble Kalman Filter (EnKF) for real-time parameter updates (e.g., permeability, skin, rod damping).
   * Bounded residual learning using Gaussian Processes.
   * Symbolic regression (PySR) for discovering closed-form, field-specific correlations.

3. **Optimization Layer**
   * Model Predictive Control (MPC) for real-time SRP command (stroke speed, VFD velocity profile).
   * Bayesian optimization for CSS cycle design (steam volume, soak time).
   * Optimal stopping rules for production cut-off based on real-time net present value.

## Repository Layout

```
ushna/                  Python package
  physics/              reservoir, wellbore, viscosity, rod string
  data/                 synthetic well generator, Arduino serial bridge
  ml/                   all ML: EnKF, PINN, GP residual, symbolic regression, card diagnosis
    train.py            training pipeline (python -m ushna.ml.train)
    artifacts/          trained weights, reports and discovered equations
tests/
  physics/              physics engine tests
  ml/                   ML component tests
frontend/               React dashboard (browser twin)
docs/                   data sources and UI design reference
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
* Phase 4 (partial): MPC and safety envelope run in the browser twin (`frontend/src/data/twin.js`) as a grid search over SPM and downstroke speed. A CasADi/IPOPT MPC is not built yet.
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

## Tech Stack

* Core computational: Python, NumPy, SciPy, Numba
* Autodiff and ML: JAX, GPyTorch, BoTorch
* Control & Optimization: CasADi, IPOPT
* Data assimilation: FilterPy
* Deployment: FastAPI, React, TimescaleDB

## Requirements

Python 3.10+
See `requirements.txt` for specific dependencies.
