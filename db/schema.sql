-- USHNA edge database. Applies on TimescaleDB (telemetry becomes a hypertable) and on
-- plain Postgres (the hypertable step is skipped with a notice).

CREATE TABLE IF NOT EXISTS telemetry (
  ts      TIMESTAMPTZ NOT NULL,
  well_id TEXT NOT NULL,
  day     INT,
  t_pump  REAL,   -- °C
  mu      REAL,   -- cP at the pump
  fmi     REAL,   -- minimum Float Margin Index
  spm     REAL,
  gross   REAL,   -- bbl/d
  fillage REAL
);

-- Every setpoint decision, accepted or clamped by the safety envelope.
CREATE TABLE IF NOT EXISTS decisions (
  ts            TIMESTAMPTZ NOT NULL,
  well_id       TEXT NOT NULL,
  requested_spm REAL,
  applied_spm   REAL,
  binding       TEXT,   -- constraint that clamped the request, NULL if accepted
  accepted      BOOL,
  reason        TEXT    -- 'mpc' (edge optimizer) or 'operator' (API /submit)
);

CREATE INDEX IF NOT EXISTS decisions_well_ts ON decisions (well_id, ts DESC);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
  PERFORM create_hypertable('telemetry', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TimescaleDB unavailable (%), telemetry stays a plain table', SQLERRM;
  CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry (ts DESC);
END $$;
