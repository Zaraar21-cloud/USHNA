# USHNA — Stack Implementation Spec

Repo: `Zaraar21-cloud/USHNA` @ `8e4cd29`

Goal: make the "Data & Streaming", "Backend", and "Edge, Cloud" rows of the tech
stack slide **real**, so a judge who opens the repo finds code behind every claim.

Scope is deliberately small. This is a prototype; the aim is credibility, not
production completeness.

---

## 0. Read this first — the honesty problem

`requirements.txt` currently lists nine libraries that **no file in the repo
imports**:

```
jax, jaxlib, filterpy, pysr, gpytorch, botorch, casadi, fastapi, uvicorn
```

Verified by grep. `enkf.py`, `gp_residual.py` and `symbolic_regression.py` are
hand-written NumPy implementations — which is *better* engineering than calling a
wrapper, but the requirements file and the stack slide claim otherwise.

**Two tasks fall out of this, and they come before any new code:**

### Task 0.1 — Split `requirements.txt`

`requirements.txt` — only what is actually imported:

```
numpy>=1.24.0
scipy>=1.10.0
numba>=0.57.0
torch>=2.2
pytest>=7.4
```

`requirements-api.txt` — new, for the work in this spec:

```
fastapi>=0.103.0
uvicorn>=0.23.2
pydantic>=2.4.0
paho-mqtt>=2.0.0
psycopg[binary]>=3.1
```

### Task 0.2 — Add a stack-reality table to the README

A short table naming, for each stack row, what is implemented and what is the
production path. A judge who finds this before finding the gap reads it as rigour
rather than overclaiming.

---

## 1. FastAPI service

**New files:** `api/main.py`, `api/models.py`

FastAPI is already claimed and has no app. This is the most visible gap.

Wrap the **existing** physics. Do not reimplement anything in `src/physics` or
`src/learning`.

### Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/health` | `{status, version}` |
| `GET` | `/wells` | list of well ids and their static parameters |
| `GET` | `/state/{well_id}?day=41` | full computed state: `T_bar`, `T_pump`, `mu`, `fmi`, `gross`, `cut_day`, `sor` |
| `GET` | `/recommend/{well_id}?day=41` | optimizer setpoint plus the explainability fields |
| `POST` | `/submit/{well_id}` | body `{spm, down}` → runs the safety envelope, returns `{applied, binding, accepted}` |
| `GET` | `/traceability/{well_id}` | which equation produced which number |

### Implementation notes

- Compose the existing functions: `marx_langenheim_heated_volume`,
  `boberg_lantz_temperature`, `radial_composite_inflow` (`src/physics/reservoir.py`),
  `ramey_wellbore_temperature` (`wellbore.py`), `WaltherViscosityModel`
  (`viscosity.py`), `solve_gibbs_wave_equation` and `float_margin_index`
  (`rod_string.py`).
- `/submit` **must** run the envelope check before returning. The API is not
  allowed to be a way around the safety layer.
- Pydantic models in `api/models.py`, typed responses. This is what makes the
  FastAPI claim worth making.
- CORS enabled for the Vite dev origin.

### Acceptance

- [ ] `uvicorn api.main:app` starts and `/docs` renders the OpenAPI page
- [ ] `/state/BGW-07?day=41` returns numbers matching the frontend's `twin.js` for the same inputs
- [ ] `POST /submit` with `{spm: 9.0, down: 1.0}` returns `accepted: false` and names the FMI constraint

---

## 2. MQTT telemetry path

**New files:** `src/data/mqtt_publisher.py`, `src/data/mqtt_bridge.py`

### `mqtt_publisher.py` — the well simulator

Publishes one message per second to topic `ushna/<well_id>/telemetry`:

```json
{ "ts": "...", "well_id": "BGW-07", "day": 41,
  "card": [...], "thp": 0.0, "chp": 0.0,
  "steam_rate": 0.0, "flowline_temp": 0.0, "spm": 6.2 }
```

Drive it from the existing physics so the numbers are the same ones the prototype
already shows. Reuse `src/data/synthetic_generator.py` rather than writing new
generation logic.

### `mqtt_bridge.py` — the edge consumer

Subscribes to `ushna/+/telemetry`, runs the physics chain, then:

- publishes the setpoint to `ushna/<well_id>/setpoint`
- writes a row to the database (§3)
- prints a readable one-line log — **this is what appears in the demo video, so
  make it legible**: `BGW-07 d41 T_pump=58.1C mu=6497cP FMI=0.212 -> SPM 4.8 accepted`

### Why this matters beyond the slide

It converts "Data & Streaming" from a claim into a running process, and it is the
exact topology the demo video needs.

### Acceptance

- [ ] Publisher and bridge run against a local Mosquitto with no code changes
- [ ] Bridge keeps running when the database is unreachable (log a warning, do not crash)
- [ ] Log line is readable at 18 pt in a terminal

---

## 3. Postgres / TimescaleDB

**New files:** `db/schema.sql`, `src/data/db_writer.py`

Two tables. Keep it minimal.

```sql
CREATE TABLE telemetry (
  ts TIMESTAMPTZ NOT NULL,
  well_id TEXT NOT NULL,
  day INT, t_pump REAL, mu REAL, fmi REAL,
  spm REAL, gross REAL, fillage REAL
);

CREATE TABLE decisions (
  ts TIMESTAMPTZ NOT NULL,
  well_id TEXT NOT NULL,
  requested_spm REAL, applied_spm REAL,
  binding TEXT, accepted BOOL, reason TEXT
);

SELECT create_hypertable('telemetry', 'ts', if_not_exists => TRUE);
```

Use the `timescale/timescaledb:latest-pg16` image so the TimescaleDB claim is
literally true. If `create_hypertable` fails, log and continue — plain Postgres
must still work.

`db_writer.py` uses `psycopg` with a connection pool and batched inserts. Fail
soft: a database outage must never stop the control loop.

### Acceptance

- [ ] `schema.sql` applies cleanly on a fresh container
- [ ] `telemetry` is a hypertable (`SELECT * FROM timescaledb_information.hypertables`)
- [ ] Killing the database container does not stop `mqtt_bridge.py`

---

## 4. Docker

**New files:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`

### `Dockerfile`

Multi-stage. Stage 1 builds the frontend with Node; stage 2 is `python:3.11-slim`
with the API, the physics and the built static files. One image runs the whole
edge node.

### `docker-compose.yml`

```yaml
services:
  mosquitto:    # eclipse-mosquitto:2
  timescaledb:  # timescale/timescaledb:latest-pg16, mounts db/schema.sql
  ushna-edge:   # built from Dockerfile — API + mqtt_bridge
  simulator:    # runs mqtt_publisher.py
```

### Requirements

- `docker compose up` brings the whole stack up from a cold clone
- The edge service must **keep running when the network is unavailable** — this is
  the claim the demo video is built on. No startup dependency on any external host.
- Healthchecks on mosquitto and timescaledb; `ushna-edge` retries rather than exits
- Named volume for Postgres data so a restart backfills rather than starting empty

### Acceptance

- [ ] `docker compose up` from a clean clone, no manual steps
- [ ] Stopping `timescaledb` leaves `ushna-edge` running and logging
- [ ] Restarting `timescaledb` resumes writes without restarting the edge service

---

## 5. Frontend

Small changes only.

- Add a **data-source toggle**: `local physics` (current behaviour, default) or
  `API`. Keep local as default so the site works when deployed as a static build
  with no backend.
- The API path reads from FastAPI; the local path keeps `twin.js` exactly as is.
- **Do not remove the local path.** It is what makes the offline demo work and what
  keeps the deployed prototype functional without a server.

---

## 6. Slide corrections — do these regardless

| Slide says | Change to |
|---|---|
| Plotly | **Recharts** (what is actually used) |
| Three.js (3D Wellbore) | **Remove** — not present |
| XGBoost | **Remove** — not present |
| FilterPy + Ensemble Kalman Filter | **Ensemble Kalman Filter (NumPy)** |
| GPyTorch | **Gaussian Process residual (NumPy)** |
| PySR | **Symbolic regression (NumPy)** |
| CasADi, IPOPT, BoTorch | **Remove**, or implement — currently unused |
| OPC-UA, Modbus RTU | Keep, labelled **production path** — cannot be demoed without field hardware |
| Kafka | **Remove** — MQTT covers the streaming claim for a prototype |

The renamed rows are stronger, not weaker. "Ensemble Kalman Filter, implemented in
NumPy" says more about the team than "FilterPy" does.

---

## 7. Build order

| # | Task | Effort | Why |
|---|---|---|---|
| 1 | Split requirements, README stack table (§0) | 30 min | Removes the biggest credibility risk |
| 2 | Slide corrections (§6) | 15 min | Free |
| 3 | Dockerfile + compose (§4) | 2 h | Makes Edge/Cloud real; needed for the video |
| 4 | FastAPI app (§1) | 3 h | Closes the most visible code gap |
| 5 | MQTT publisher + bridge (§2) | 3 h | Makes Data & Streaming real |
| 6 | TimescaleDB + writer (§3) | 2 h | Completes the video topology |
| 7 | Frontend source toggle (§5) | 1 h | Ties it together without breaking the static deploy |

Items 1 and 2 cost under an hour and remove more risk than everything else
combined. Do them first even if nothing else gets built.

---

## 8. Out of scope

- No changes to `src/physics/` or `src/learning/` — the algorithms are done
- No changes to `frontend/src/data/twin.js` physics
- No OPC-UA or Modbus implementation — no hardware to test against
- No Kafka — MQTT is sufficient at prototype scale
- Do not replace the hand-written EnKF, GP or symbolic regression with library
  calls. They work, they are tested, and rewriting them adds risk for no gain.
