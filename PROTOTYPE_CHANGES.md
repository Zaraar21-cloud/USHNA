# USHNA Prototype — Changes for SIH Final Round

Target: a deployed prototype reachable by QR from the PPT, where a judge who has
never seen the project can land cold, understand what data they are looking at,
and navigate without guidance.

Repo reviewed: `Zaraar21-cloud/USHNA` @ `main` (4 commits)

---

## 0. Verdict on the current state

The prototype is considerably better than "rushed". What already works:

- Full physics chain recomputed in-browser (`frontend/src/data/twin.js`, 22 kB) —
  T̄ → T_pump → μ(T_pump) → FMI → SPM. Genuinely coupled, not faked.
- 10 pages, 6 wells, working safety envelope with clamp + audit log (`App.jsx: submit()`).
- Real ML artefacts committed under `trained_models/` — EnKF trace, GP residual,
  PINN weights, discovered equations, energy audit.
- Python physics + learning modules with tests (`src/`, `tests/` — 7 test files).

So the work below is **correction and framing**, not rebuilding.

---

## 1. CRITICAL — fix before anything else

### 1.1 Viscosity is ~4.6× too low

`frontend/src/data/twin.js` line ~36:

```js
export const WALTHER = { A: 6.0101, B: 2.1860 };
```

This fit yields:

| Temperature | Repo value | Oil India published |
|---|---|---|
| 47 °C (reservoir) | 2,470 cP | — |
| **50 °C** | **2,107 cP** | **10,000–13,000 cP** |
| 58 °C (pump, hot) | 1,411 cP | — |

Oil India's own Rajasthan Fields page states the Baghewala crude is
10,000–13,000 cP at 50 °C. An OIL judge will know this number. Being 5× light on
the single variable the whole twin is built around is the one error that could
sink the demo.

**Fix** — refit to 11,500 cP @ 50 °C and 14 cP @ 250 °C:

```js
export const WALTHER = { A: 7.0393, B: 2.5617 };
```

Resulting curve: 14,435 cP @ 47 °C → 6,497 cP @ 58 °C → 1,698 cP @ 80 °C → 14 cP @ 250 °C.

**Knock-on effects to re-tune after this change** (viscosity feeds everything):

- `FIELD.T_onset = 58` — asphaltene onset, keep, but verify FMI still crosses
  the 0.15 limit at a sensible day in the cycle rather than on day 1.
- `J = 1.05e6` productivity constant — inflow is ∝ 1/μ, so gross rates will
  collapse ~5×. Re-scale so fleet output lands near **~17 bbl/day/well**
  (OIL: 35 wells, >600 bbl/day total).
- `ROD.plunger = 250`, `ROD.fric = 2.5` — drag terms scale with μ. Re-tune so
  baseline SPM 6.2 on BGW-07 is *feasible* at day 41, not already floating.
- Re-run `npm run check` (`twin.check.mjs`) after retuning.

### 1.2 `arduino_telemetry.csv` is empty

Header row only, zero data rows. The Edge Telemetry page has a source toggle
implying a hardware feed. Either populate it, or remove the hardware framing and
label that page clearly as a simulated edge stream. An empty CSV in the repo root
is worse than no CSV.

### 1.3 Other values to align with published sources

| Field | Current | Published | Action |
|---|---|---|---|
| `pumpDepth` | 900 m | ~1100 m (SPE 23APOG) | update |
| `re` | 60 m | — | keep, document as assumed |
| Porosity | not modelled | 16–25% (Jodhpur ss.) | add to Field Card |
| Well count | 6 | 35 drilled | say "6 of 35 modelled" |
| `T_R = 47` | 47 °C | 46–48 °C (PS 26120) | correct, cite it |

---

## 2. Real data — what exists and what does not

### 2.1 Found and citable

| Source | Gives you |
|---|---|
| **Oil India, Rajasthan Fields** (oil-india.com/rajasthan-fields) | Viscosity 10,000–13,000 cP @ 50 °C · 35 wells · >600 bbl/day · CSS + SRP confirmed · VIT and thermal wellheads · producing since 2017 |
| **Problem Statement 26120** | 17–19° API · reservoir 46–48 °C · low pressure · high asphaltene |
| **OIL EOI-014-2024** (eoibahrain.gov.in) | Field 200.26 km² · Jodhpur ss. + Upper Carbonate · CSS + downhole heating |
| **SPE 23APOG-535203** | Production from ~1100 m · downhole electrical heater trials |
| **Bikaner–Nagaur basin literature** | Jodhpur sandstone porosity 16–25% · 935 MMbbl heavy oil in place |
| **SPE-194949** (Tatweer, Bahrain) | Dynamometer card ML benchmark: 35,292 labelled cards, 12 classes, 299 beam pumps — **cite as the method precedent for card diagnosis** |
| **Sensors 21(13):4546** (open access) | Card classes + sensor-fault taxonomy, freely readable |

### 2.2 Does not exist publicly

No open per-well time series for Baghewala. No public CSS cycle records, rod
failure logs, or dynamometer card sets for this field. The Bahrain card dataset
from SPE-194949 is **described** in the paper but not released for download.

**So: the prototype runs on synthetic data, and must say so loudly.** That is
not a weakness if framed correctly — it is the honest position, and the physics
is what makes synthetic data defensible.

---

## 3. Data provenance — the main gap

Provenance *is* disclosed today, but only in two places a judge will not read:
`Shell.jsx:199` (sidebar footnote) and `Shell.jsx:205` (footer). Everything else
presents numbers with no qualifier.

### 3.1 Add a first-visit modal

Shown once per browser (`localStorage` flag), dismissible, also reachable from a
persistent "About this data" button in the header.

Content:

> **This is a working physics model, not live field data.**
>
> Oil India's Baghewala field does not publish per-well telemetry. Every number
> here is computed live in your browser by the USHNA physics engine — the same
> Marx–Langenheim, Ramey, Walther and Gibbs equations described in our solution —
> running on synthetic wells calibrated to published Baghewala parameters.
>
> **Calibrated from:** Oil India Rajasthan Fields (viscosity, well count, output) ·
> SIH PS 26120 (API gravity, reservoir temperature) · Jodhpur Sandstone literature (porosity).
>
> **What is real:** the equations, the coupling, the solver, the safety logic.
> **What is synthetic:** the six wells and their sensor streams.
>
> Connected to a live SCADA feed, only the data source changes. The model does not.
>
> [ Start with BGW-07 ]  [ Show me the physics ]

That last line is the important one — it tells a judge the synthetic data is a
*substitution*, not a shortcut.

### 3.2 Add a persistent provenance badge

Top-right of every page, next to the well selector:

`● SYNTHETIC DATA · calibrated to published Baghewala parameters`

Amber dot, not red. Clicking it reopens the modal.

### 3.3 Add a "Field Card" panel on the Dashboard

A small table, above the fold, showing each anchor value and its source:

| Parameter | Value | Source |
|---|---|---|
| Crude viscosity | 10,000–13,000 cP @ 50 °C | Oil India, Rajasthan Fields |
| API gravity | 17–19° | SIH PS 26120 |
| Reservoir temperature | 46–48 °C | SIH PS 26120 |
| Formation | Jodhpur Sandstone, 16–25% porosity | Bikaner–Nagaur literature |
| Field size | 200.26 km², 35 wells, >600 bbl/day | Oil India / EOI-014-2024 |
| Pump setting depth | ~1100 m | SPE 23APOG-535203 |

Every row a real citation. This panel alone answers "where did your numbers come
from?" before it is asked.

### 3.4 Label every chart axis that shows synthetic output

One-line caption under each chart: `synthetic · physics-generated`. Cheap, and it
means no single screenshot can be mistaken for field data.

---

## 4. Navigation — landing cold

Current nav is 10 items across 4 groups with no entry point. A judge with 90
seconds will click Dashboard, see dense charts, and leave.

### 4.1 Add a guided tour ("Judge Mode")

Button in the header: **▶ 60-second tour**. Five steps, each highlighting one
panel with a caption:

1. **The problem** — Reservoir page. "The well cools. Viscosity rises 4× over one cycle."
2. **The coupling** — Wellbore page. "Physics computes μ at the pump. No sensor can measure this."
3. **The risk** — Rod String page. "FMI falls toward 0.15. Below that, rods float and break."
4. **The decision** — Recommendations. "MPC cuts SPM. The card shows the equation and confidence."
5. **The guard** — SRP Control. "The safety envelope clamped this request. Every veto is logged."

Step 5 is the strongest and should be last.

### 4.2 Add "what am I looking at" to every page header

Each `PageHeader` gets one plain sentence. Current subtitles are written for
someone who already knows the project. Example rewrite for Rod String:

> Current: "One scalar, μ(T_pump), flows from the thermal model into the pump control law."
> Better: "How close the rod string is to floating, and the maximum pumping speed that keeps it safe."

### 4.3 Reorder nav by story, not architecture

```
Dashboard
Well twin      → Reservoir & CSS · Wellbore · Rod string
Decisions      → Recommendations · SRP control · CSS design
Under the hood → Learning layer · Edge telemetry · Traceability
```

"Under the hood" signals to a non-technical judge that they can skip those three.

### 4.4 Make the demo self-driving

Add a **Run cycle** button that animates day 0 → 120 over ~15 s, so a judge sees
the well cool, FMI fall, and the controller throttle without touching a slider.
This is the single highest-value addition for a QR-code demo where nobody is
there to drive.

---

## 5. Smaller improvements

- **Deep links already work** (`location.hash`). Put `#Recommendations` on the QR
  instead of the root, so the QR lands on the most impressive page. Or use the
  root plus auto-open the tour.
- **Mobile** — judges will scan the QR with a phone. Verify the sidebar collapses
  and Recharts containers do not overflow. Currently untested.
- **`vite.config.js` has no `base`** — set it if deploying to a GitHub Pages
  subpath. Vercel or Netlify need no change.
- **README implementation status is stale** — it says Phase 3 and 4 are pending,
  but `src/learning/enkf.py` and the MPC exist. Fix before a judge reads it.
- **Add `DATA_SOURCES.md`** to the repo root with the table from §2.1 and the
  exact Walther refit. If a judge opens the repo, that file is the answer.

---

## 6. Priority order

| # | Task | Why |
|---|---|---|
| 1 | Refit Walther constants + retune dependents | Factual error against OIL's own published data |
| 2 | First-visit provenance modal | Judge lands cold and must not mistake synthetic for real |
| 3 | Field Card panel with citations | Proves the calibration is grounded |
| 4 | "Run cycle" auto-demo | QR demo with nobody driving |
| 5 | 60-second guided tour | Navigation for a cold visitor |
| 6 | Fix or remove empty telemetry CSV | Repo hygiene |
| 7 | Page-header plain-English subtitles | Comprehension |
| 8 | `DATA_SOURCES.md` + README status | Repo credibility |

Items 1–3 are non-negotiable. Items 4–5 are what turn a dashboard into a demo.

---

## 7. What to put on the PPT next to the QR

> **Live prototype** — physics engine running in your browser on synthetic wells
> calibrated to published Baghewala parameters. Not live field data; connect a
> SCADA feed and only the source changes.

Three lines, and it pre-empts the only awkward question the QR invites.
