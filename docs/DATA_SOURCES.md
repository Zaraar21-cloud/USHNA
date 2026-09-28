# Data sources

The USHNA prototype runs on **synthetic wells calibrated to published Baghewala parameters**.
Oil India does not publish per-well telemetry, CSS cycle records, rod-failure logs or
dynamometer cards for Baghewala. The equations, the coupling, the solver and the safety
logic are real; the six wells and their sensor streams are synthetic. Connected to a live
SCADA feed, only the data source changes.

## Published anchors

| Parameter | Value | Source |
|---|---|---|
| Crude viscosity | 10,000–13,000 cP @ 50 °C | Oil India, Rajasthan Fields (oil-india.com/rajasthan-fields) |
| API gravity | 17–19° | SIH Problem Statement 26120 |
| Reservoir temperature | 46–48 °C | SIH Problem Statement 26120 |
| Formation | Jodhpur Sandstone, 16–25% porosity | Bikaner–Nagaur basin literature |
| Field size | 200.26 km², 35 wells, >600 bbl/day | Oil India, Rajasthan Fields; OIL EOI-014-2024 |
| Pump setting depth | ~1100 m | SPE 23APOG-535203 |
| Recovery method | CSS + sucker-rod pumps, VIT and thermal wellheads, producing since 2017 | Oil India, Rajasthan Fields |
| Card-diagnosis method precedent | 35,292 labelled cards, 12 classes, 299 beam pumps | SPE-194949 (Tatweer, Bahrain) |
| Card classes and sensor-fault taxonomy | open access | Sensors 21(13):4546 |

The Bahrain card dataset in SPE-194949 is described in the paper but not released, so it is
cited as the method precedent only.

## Viscosity refit (Walther / ASTM D341)

`log10 log10(ν + 0.7) = A − B·log10(T[K])`, with μ = ν·ρ and ρ = 0.95.

| | A | B |
|---|---|---|
| Previous fit (ν(47 °C) = 2600 cSt) | 6.0101 | 2.1860 |
| **Current fit** | **7.0393** | **2.5617** |

The current fit passes through 11,500 cP at 50 °C (mid-range of Oil India's published
10,000–13,000 cP) and 14 cP at 250 °C (steam temperature). The previous fit gave 2,107 cP at
50 °C, about 5× too light.

| T (°C) | μ (cP) |
|---|---|
| 47 (reservoir) | 14,429 |
| 50 | 11,495 |
| 58 (asphaltene onset) | 6,495 |
| 80 | 1,698 |
| 250 | 14 |

`npm run check` (in `frontend/`) asserts μ(50 °C) stays inside 10,000–13,000 cP.

## Retuned dependents (frontend/src/data/twin.js)

Viscosity feeds every downstream term, so these were retuned after the refit:

| Constant | Was | Now | Why |
|---|---|---|---|
| `FIELD.pumpDepth` | 900 m | 1100 m | SPE 23APOG-535203; rod taper rescaled to 0–760 / 760–1030 / 1030–1100 m |
| `FIELD.stroke` | 3.0 m | 1.22 m (48″ unit) | Pump displacement must match ~20–40 bbl/d gross inflow at 5–7 SPM |
| `ROD.plungerIn` | 1.25″ | 1.06″ | Same; smallest API bore. Gives ~85% fillage on BGW-07 at day 41 |
| `ROD.coupling` | 4.7 | 2.5 | Annular-drag multiplier. BGW-07 at 6.2 SPM, day 41: FMI 0.21, crossing 0.15 around day 44 |
| `FIELD.steamCost` | ₹4,200/t | ₹2,000/t | ~2.7 GJ fuel per tonne of wet steam; at ₹4,200/t no cycle broke even at the corrected rates |

Resulting fleet: about 21 bbl/d oil per producing well, which matches Oil India's field average
of ~17 bbl/d once injection and soak downtime are included. The productivity constant `J` was left
unchanged.

## Assumed (not published)

| Parameter | Value | Note |
|---|---|---|
| Drainage radius `re` | 60 m | Assumed |
| Pay thickness | 20 m | Assumed |
| Asphaltene onset `T_onset` | 58 °C | Assumed |
| Steam temperature | 250 °C | Assumed |
| Well count modelled | 6 of 35 | Synthetic wells BGW-02/04/07/09/11/15 |
| Oil price, opex, failure cost | ₹6,300/bbl, ₹16,000/d, ₹12 L | Planning assumptions |

## Python AI layer

The Python learning pipeline uses the same Walther refit (A = 7.0393, B = 2.5617) in
`ushna/data/synthetic_generator.py`, the EnKF priors (`ushna/ml/enkf.py`) and the
training script. The artefacts in `ushna/ml/artifacts/` were retrained after the change.

The PINN (`ushna/ml/pinn_training.py`) shares the browser twin's geometry: 20 m pay,
60 m drainage radius, effective thermal diffusivity 0.9 m²/day, 47 °C reservoir and
250 °C steam.
