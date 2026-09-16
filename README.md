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

## Implementation Status

* Phase 1: Physics engine implementation (Marx-Langenheim, Boberg-Lantz, Walther Viscosity, Gibbs wave equation, FMI).
* Phase 2: Synthetic data generator mimicking field sensor data, noise, and drift.
* Phase 3: EnKF assimilation loop (Pending).
* Phase 4: MPC controller (Pending).

## Tech Stack

* Core computational: Python, NumPy, SciPy, Numba
* Autodiff and ML: JAX, GPyTorch, BoTorch
* Control & Optimization: CasADi, IPOPT
* Data assimilation: FilterPy
* Deployment: FastAPI, React, TimescaleDB

## Requirements

Python 3.10+
See `requirements.txt` for specific dependencies.
