import pytest

pytest.importorskip('fastapi')
from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402
from ushna import twin  # noqa: E402

client = TestClient(app)


def test_health_and_wells():
    assert client.get('/health').json()['status'] == 'ok'
    assert [w['id'] for w in client.get('/wells').json()] == [w['id'] for w in twin.WELLS]


def test_state_matches_twin():
    s = client.get('/state/BGW-07', params={'day': 41}).json()
    ref = twin.build_state(twin.WELL_BY_ID['BGW-07'], 41)
    assert s['T_pump'] == pytest.approx(ref['now']['Tpump'])
    assert s['cut_day'] == ref['cut']['day']
    assert client.get('/state/NOPE').status_code == 404
    assert client.get('/state/BGW-07', params={'day': 999}).status_code == 422


def test_submit_runs_envelope():
    r = client.post('/submit/BGW-07', params={'day': 41}, json={'spm': 9.0, 'down': 1.0}).json()
    assert r['accepted'] is False and r['binding'] == twin.FMI_BINDING and r['applied']['spm'] < 9.0
    # the clamped setpoint is what /state now evaluates
    assert client.get('/state/BGW-07', params={'day': 41}).json()['setpoint']['spm'] == r['applied']['spm']


def test_recommend_and_traceability():
    rec = client.get('/recommend/BGW-07', params={'day': 41}).json()
    assert rec['setpoint']['spm'] > 0 and all(rec[k] for k in ('why', 'driver', 'relation', 'effect', 'confidence', 'cycle'))
    rows = client.get('/traceability/BGW-07').json()
    assert any(r['quantity'].startswith('Float Margin') for r in rows)
