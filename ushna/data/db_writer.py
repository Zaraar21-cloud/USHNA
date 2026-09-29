"""
Batched, fail-soft writer for the `telemetry` and `decisions` tables (db/schema.sql).

Callers only append to an in-memory buffer; a background thread flushes it every
couple of seconds. If the database is down the rows stay buffered (oldest dropped
past `max_buffer`) and are backfilled once it returns. Nothing here ever raises into
the control loop.
"""

import logging
import os
import threading
import time
from collections import deque

try:
    import psycopg
except ImportError:
    psycopg = None

log = logging.getLogger('ushna.db')

SQL = {
    'telemetry': 'INSERT INTO telemetry (ts, well_id, day, t_pump, mu, fmi, spm, gross, fillage) '
                 'VALUES (%(ts)s, %(well_id)s, %(day)s, %(t_pump)s, %(mu)s, %(fmi)s, %(spm)s, %(gross)s, %(fillage)s)',
    'decisions': 'INSERT INTO decisions (ts, well_id, requested_spm, applied_spm, binding, accepted, reason) '
                 'VALUES (%(ts)s, %(well_id)s, %(requested_spm)s, %(applied_spm)s, %(binding)s, %(accepted)s, %(reason)s)',
}


class DbWriter:
    # ponytail: one connection on one writer thread; a pool only pays off with concurrent writers
    def __init__(self, dsn, flush_every=2.0, max_buffer=50_000):
        self.dsn, self.flush_every, self.max_buffer = dsn, flush_every, max_buffer
        self._buf = {t: deque(maxlen=max_buffer) for t in SQL}
        self._lock = threading.Lock()
        self._conn = None
        self._down = False
        threading.Thread(target=self._run, name='db-writer', daemon=True).start()

    def telemetry(self, row):
        with self._lock:
            self._buf['telemetry'].append(row)

    def decision(self, row):
        with self._lock:
            self._buf['decisions'].append(row)

    def _run(self):
        while True:
            time.sleep(self.flush_every)
            self.flush()

    def flush(self):
        with self._lock:
            batch = {t: list(b) for t, b in self._buf.items()}
            for b in self._buf.values():
                b.clear()
        if not any(batch.values()):
            return
        try:
            if self._conn is None or self._conn.closed:
                self._conn = psycopg.connect(self.dsn, connect_timeout=3)
            with self._conn.cursor() as cur:
                for table, rows in batch.items():
                    if rows:
                        cur.executemany(SQL[table], rows)
            self._conn.commit()
            if self._down:
                log.warning('database reachable again; backfilled %d rows', sum(map(len, batch.values())))
                self._down = False
        except Exception as e:  # any failure: keep the rows, retry next flush
            with self._lock:
                for t, rows in batch.items():  # re-queue ahead of newer rows; maxlen drops the oldest
                    self._buf[t] = deque(rows + list(self._buf[t]), maxlen=self.max_buffer)
            if not self._down:
                log.warning('database unreachable, buffering rows: %s', str(e).strip().splitlines()[0])
                self._down = True
            try:
                if self._conn is not None:
                    self._conn.close()
            except Exception:
                pass
            self._conn = None


def writer_from_env():
    """A DbWriter when DATABASE_URL is set, else None (the twin runs without a database)."""
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        return None
    if psycopg is None:
        log.warning('DATABASE_URL is set but psycopg is not installed; database writer disabled.')
        return None
    return DbWriter(dsn)
