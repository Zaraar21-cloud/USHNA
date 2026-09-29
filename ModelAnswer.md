# USHNA — "Model Answer" CSS Design Studio

Repo: `Zaraar21-cloud/USHNA`

## What to build

An interactive panel where a user sets the **starting condition of a well** and the
trained model answers with a **CSS recipe**: how much steam, how long to soak, when
to re-inject — and what that does to the oil.

This is the page that makes the trained model visible. Right now the site *uses*
the model everywhere but never lets anyone ask it a question.

**Location:** new tab on `CssDesign.jsx`, called **"Design studio"**, alongside the
existing "Cut-off", "Cycle design" and "Counterfactual backtest" tabs.

---

## 1. What already exists — reuse, do not rewrite

| Function | File | What it gives you |
|---|---|---|
| `designSpace(well)` | `frontend/src/data/twin.js:372` | Searches 13 steam × 9 soak = 117 designs, returns `{grid, best, current, samples, confidence, sigma}` where `best = {steam, soak, npv, cutDay, sor}` |
| `simulate(well, opts)` | `twin.js` | Full cycle trajectory for a given design |
| `viscosity(T)` | `twin.js` | Walther μ(T) in cP |
| `WALTHER` | `twin.js` | `{A: 7.0393, B: 2.5617}` |
| `FIELD` | `twin.js` | `T_R`, `T_s`, prices, horizon |
| `cutoff`, `cycleNpv` | `twin.js` | Stopping rule and economics |

**The entire search already works.** The task is an input surface and a results
panel around it.

---

## 2. Inputs the user sets

Five controls. Each has a default equal to the currently selected well, and a
**Reset to well** button.

| Control | Range | Default | Notes |
|---|---|---|---|
| **Crude viscosity at reservoir temp** | 5,000 – 25,000 cP | 14,435 cP | Oil India publishes 10,000–13,000 cP at 50 °C; default is the Walther curve evaluated at 47 °C |
| **Reservoir temperature** | 40 – 55 °C | `FIELD.T_R` = 47 | |
| **Boiler capacity (max steam)** | 1,500 – 4,500 t | 4,500 | Caps the search grid |
| **Oil price** | ₹4,000 – 9,000 /bbl | `FIELD.oilPrice` | |
| **Steam cost** | ₹1,000 – 3,500 /t | `FIELD.steamCost` | |

### Implementing the viscosity control

The user sets a target μ at reservoir temperature. Re-fit the Walther constant `A`
holding `B` fixed, so the whole viscosity curve shifts to pass through their point:

```
nu_target = mu_target / 0.95                       // cP -> cSt, rho = 0.95
A = log10(log10(nu_target + 0.7)) + B * log10(T_R + 273.15)
```

Pass the modified `{A, B}` into the physics rather than mutating the exported
`WALTHER` constant. Add an optional `walther` field to the `well` object that
`viscosity()` respects, defaulting to the module constant.

---

## 3. What the model answers

Run `designSpace()` on the synthesised well, with the steam grid clipped to the
boiler capacity. Show the result in three groups.

### Group 1 — The recipe

```
STEAM VOLUME      3,250 t
SOAK TIME             5 days
PRODUCE UNTIL     day 120
RE-INJECT ON      day 133
```

### Group 2 — What it does to the oil (the point of the panel)

```
Viscosity at reservoir       14,435 cP
Viscosity at pump, day 0        980 cP      14.7x thinner
Viscosity at pump, day 41     6,497 cP       2.2x thinner
Viscosity at pump, day 120   12,800 cP       1.1x thinner
Heated zone radius             13.0 m
```

The **thinner-by factor** is the number a non-specialist understands immediately.
Make it the largest text in the group.

### Group 3 — Consequences

```
Cumulative oil / cycle     2,488 bbl
Steam-Oil Ratio                 8.22
Cycle NPV                     Rs xx.x L
Max safe SPM at day 41          4.8
Min Float Margin Index         0.563
```

Compute max safe SPM by solving `FMI = 0.15` for `S·N` using the existing
`fmiProfile` / `rodVelocity` helpers — do not approximate.

---

## 4. The two charts

### Chart A — Viscosity drop over the cycle

X: day 0–120. Y: μ at pump, **log scale**. Two lines: the user's design, and the
well's current practice. Horizontal reference line at the reservoir viscosity.

This shows the steam working and then wearing off. It is the clearest single
picture of what CSS actually does.

### Chart B — Diminishing returns on steam

X: steam volume across the grid. Y (left): viscosity at pump on day 41.
Y (right): SOR. Mark the optimum.

This is the physics insight worth showing: **doubling the steam does not halve the
viscosity**. The curve flattens, and SOR rises. That is why an optimizer is needed
rather than "use more steam."

---

## 5. Make the trained PINN visible

**This is the part that turns "we trained a model" into something a viewer can see.**

Add a small strip below the results:

```
Thermal field computed by PINN surrogate     3 ms
Finite-volume solver, same field           ~2,400 ms
Speed-up                                      800x
Validation RMSE on unseen designs           1.71 C     (release limit 5.0 C)
Energy audit                                  PASSED
```

Pull the real numbers from `trained_models/pinn_training.json` — it already
contains `validation`, `energy_audit` and `speed` keys. Surface them through
`frontend/src/data/ml.js`, which already exports a `pinn` object.

Add one line of copy beneath it:

> The optimizer evaluated 117 designs. Each needs a thermal field. Without the
> trained surrogate this panel would take four minutes instead of half a second.

That sentence explains *why the neural network exists* better than any diagram.

---

## 6. Two preset scenarios

Buttons that load an input set, so a visitor who does not know what to change can
still see the model respond:

- **"Heavier crude"** — viscosity 20,000 cP. The recipe should call for more steam
  and the thinner-by factor should fall.
- **"Cheap gas"** — steam cost ₹1,200/t. The optimizer should buy more steam and
  accept a higher SOR for more oil.

The second one is worth having because it shows the recommendation is
**economics-aware**, not a fixed rule.

---

## 7. Behaviour

- Recompute on input change, debounced ~250 ms. `designSpace()` runs 117
  simulations; measure it and use `useDeferredValue` if it stutters.
- Show a small spinner with "searching 117 designs…" while computing. The wait is
  evidence of work being done, not a flaw — do not hide it entirely.
- Every result must show the **delta against the well's current practice**, not
  just the absolute value.
- Nothing here writes to state or the audit log. This is a sandbox, clearly
  labelled as such.

---

## 8. Provenance

Footer line on the panel:

> Computed live by the USHNA physics engine and PINN surrogate. Viscosity anchored
> to Oil India's published Baghewala value of 10,000–13,000 cP at 50 °C.

---

## 9. Acceptance criteria

- [ ] Raising viscosity increases the recommended steam volume
- [ ] Lowering steam cost increases recommended steam and oil, and raises SOR
- [ ] Boiler capacity caps the search grid; the optimum never exceeds it
- [ ] "Thinner-by" factors are correct against `viscosity()` at the shown temperatures
- [ ] Chart A is log-scale and both lines start at the reservoir viscosity
- [ ] Chart B shows a flattening curve with the optimum marked
- [ ] PINN strip pulls real values from `pinn_training.json`, not hardcoded
- [ ] Reset restores the selected well's parameters exactly
- [ ] Panel does not mutate global `WALTHER` or write to the audit log
- [ ] `npm run check` still passes

---

## 10. Out of scope

- No changes to the physics in `twin.js` beyond accepting an optional `walther`
  override on the well object
- Do not retrain anything in the browser; the PINN is used for inference only
- Do not replace the existing "Cycle design (Bayesian opt.)" tab — this is
  additional
