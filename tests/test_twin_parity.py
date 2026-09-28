"""The Python twin (served by the API) must give the browser twin's numbers."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from ushna import twin

TWIN_JS = Path(__file__).resolve().parents[1] / 'frontend' / 'src' / 'data' / 'twin.js'

JS = """
import(process.argv[1]).then((t) => {
  const out = t.WELLS.map((w) => {
    const s = t.buildState(w, w.day);
    const n = s.now;
    return { id: w.id, Tbar: n.Tbar, Tpump: n.Tpump, mu: n.mu, gross: n.gross, fmi: n.fmi, torque: n.torque,
             cut: s.cut.day, band: s.cut.band, sor: s.sor, npv: s.npv, spmMax: s.spmMax,
             mpc: [s.mpc.spm, s.mpc.down], env: t.envelope(w, w.day, { spm: 9, down: 1 }) };
  });
  console.log(JSON.stringify(out));
});
"""


@pytest.mark.skipif(shutil.which('node') is None, reason='node not installed')
def test_python_twin_matches_browser_twin():
    res = subprocess.run(['node', '--input-type=module', '-e', JS, TWIN_JS.as_uri()],
                         capture_output=True, text=True, check=True)
    for js in json.loads(res.stdout):
        well = twin.WELL_BY_ID[js['id']]
        s = twin.build_state(well, well['day'])
        n = s['now']
        # Continuous values: the browser uses an A&S erfcx approximation, so ~1e-4 relative.
        for k in ['Tbar', 'Tpump', 'mu', 'gross', 'fmi', 'torque']:
            assert n[k] == pytest.approx(js[k], rel=1e-3), (js['id'], k)
        assert s['sor'] == pytest.approx(js['sor'], rel=1e-3)
        assert s['npv'] == pytest.approx(js['npv'], abs=1000)  # residual of ~₹5M sums: absolute tolerance
        # Decisions must be identical.
        assert (s['cut']['day'], s['cut']['band'], s['spmMax']) == (js['cut'], js['band'], js['spmMax']), js['id']
        assert [s['mpc']['spm'], s['mpc']['down']] == js['mpc'], js['id']
        applied, binding = twin.envelope(well, well['day'], dict(spm=9, down=1))
        assert applied['spm'] == js['env']['applied']['spm'] and binding == js['env']['binding'], js['id']


def test_envelope_vetoes_unsafe_spm():
    applied, binding = twin.envelope(twin.WELL_BY_ID['BGW-07'], 41, dict(spm=9.0, down=1.0))
    assert binding == twin.FMI_BINDING and applied['spm'] < 9.0
