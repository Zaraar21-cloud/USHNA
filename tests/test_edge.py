import pytest

pytest.importorskip('paho.mqtt')
pytest.importorskip('psycopg')

from ushna.data.db_writer import DbWriter  # noqa: E402
from ushna.data.mqtt_bridge import handle, log_line  # noqa: E402


class FakeWriter:
    def __init__(self):
        self.telemetry_rows, self.decision_rows = [], []
    telemetry = lambda self, r: self.telemetry_rows.append(r)  # noqa: E731
    decision = lambda self, r: self.decision_rows.append(r)  # noqa: E731


def test_bridge_decides_logs_and_writes():
    w = FakeWriter()
    setpoint, d = handle({'well_id': 'BGW-11', 'day': 66, 'spm': 5.4}, w)
    assert d['fmi'] < 0.15                       # current setpoint floats the rods
    assert setpoint['spm'] < 5.4                 # edge brings SPM down
    assert len(w.telemetry_rows) == len(w.decision_rows) == 1
    assert log_line(d).startswith('BGW-11 d66 T_pump=')


def test_db_writer_fails_soft_and_keeps_rows():
    w = DbWriter('postgresql://nobody@127.0.0.1:1/none', flush_every=3600)
    w.decision(dict(ts='2026-01-01T00:00:00Z', well_id='BGW-07', requested_spm=5, applied_spm=5,
                    binding=None, accepted=True, reason='test'))
    w.flush()  # database unreachable: must not raise
    assert len(w._buf['decisions']) == 1  # still buffered for backfill
