"""
Well simulator: publishes one telemetry message per well per tick to ushna/<well_id>/telemetry.

    python -m ushna.data.mqtt_publisher --interval 1          # all wells, one simulated day per tick

Numbers come from the same twin the dashboard shows (ushna.twin), with sensor noise at
the levels ushna/data/synthetic_generator.py uses (1.5 C temperature, 2% of reading on
rates). The dynamometer card comes from ushna.ml.inverse_diagnosis.synthesize_pump_card.
The simulator follows the setpoints the edge publishes back, closing the loop.
"""

import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone

import numpy as np
import paho.mqtt.client as mqtt

from ushna import twin
from ushna.ml.inverse_diagnosis import synthesize_pump_card

log = logging.getLogger('ushna.publisher')

T_NOISE, RATE_NOISE = 1.5, 0.02  # synthetic_generator.py sensor noise
U_CARD = 0.5 * (1 - np.cos(np.linspace(0, 2 * np.pi, 48, endpoint=False)))  # rod position over one stroke


def telemetry(well, day, spm, rng):
    """One telemetry message for `well` on production `day` at `spm`."""
    r = twin.simulate(well, with_fmi=False)['rows'][day]
    gross = min(r['inflow'], twin.displacement(spm) * 0.97)
    fillage = min(1.0, r['inflow'] / twin.displacement(spm))
    flowline = twin.tubing_profile(r['Tpump'], gross)[0]['T']
    card = synthesize_pump_card(U_CARD, fillage=fillage, gas_void=0.02, leakage=0.0, tagging=False)
    card = card * (1 + rng.normal(0, RATE_NOISE, card.size))
    return dict(
        ts=datetime.now(timezone.utc).isoformat(), well_id=well['id'], day=day,
        card=[round(float(f)) for f in card],
        thp=round(8 + 0.05 * gross * (1 + rng.normal(0, RATE_NOISE)), 2),  # bar, synthetic
        chp=round(4 + rng.normal(0, 0.1), 2),                              # bar, synthetic
        steam_rate=0.0,  # production phase: no injection
        flowline_temp=round(flowline + rng.normal(0, T_NOISE), 1),
        spm=spm,
    )


def main():
    ap = argparse.ArgumentParser(description='USHNA well simulator (MQTT publisher)')
    ap.add_argument('--wells', default='all', help='comma-separated well ids, or "all"')
    ap.add_argument('--interval', type=float, default=1.0, help='seconds between ticks (one simulated day per tick)')
    ap.add_argument('--host', default=os.environ.get('MQTT_HOST', 'localhost'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('MQTT_PORT', 1883)))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')

    wells = twin.WELLS if args.wells == 'all' else [twin.WELL_BY_ID[w] for w in args.wells.split(',')]
    day = {w['id']: w['day'] for w in wells}
    spm = {w['id']: w['spm'] for w in wells}
    rng = np.random.default_rng(42)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='ushna-simulator')
    client.reconnect_delay_set(1, 10)

    def on_connect(c, *_):
        c.subscribe('ushna/+/setpoint')
        log.info('simulator connected to %s:%d', args.host, args.port)

    def on_setpoint(_c, _u, msg):  # the well runs at whatever the edge applied
        sp = json.loads(msg.payload)
        if sp.get('well_id') in spm:
            spm[sp['well_id']] = sp['spm']

    client.on_connect, client.on_message = on_connect, on_setpoint
    client.connect_async(args.host, args.port)
    client.loop_start()
    while not client.is_connected():  # don't burn simulated days before the broker is up
        time.sleep(0.2)
    while True:
        for w in wells:
            client.publish(f"ushna/{w['id']}/telemetry", json.dumps(telemetry(w, day[w['id']], spm[w['id']], rng)))
            day[w['id']] = (day[w['id']] + 1) % (twin.FIELD['horizon'] + 1)  # wraps into the next cycle
        time.sleep(args.interval)


if __name__ == '__main__':
    main()
