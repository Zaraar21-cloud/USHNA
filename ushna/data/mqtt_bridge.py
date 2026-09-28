"""
Edge consumer: subscribes to ushna/+/telemetry, runs the physics chain and the safety
envelope, publishes the setpoint to ushna/<well_id>/setpoint and logs to the database.

    python -m ushna.data.mqtt_bridge            # MQTT_HOST, MQTT_PORT, DATABASE_URL from env

Keeps running with no broker (retries) and no database (buffers, see db_writer).
"""

import json
import logging
import os
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from ushna import twin

log = logging.getLogger('ushna.bridge')

TELEMETRY_TOPIC = 'ushna/+/telemetry'


def decide(well_id, day, spm, down=1.0):
    """Physics chain at today's setpoint, then the optimizer's request through the envelope."""
    well = twin.WELL_BY_ID[well_id]
    day = max(0, min(int(day), twin.FIELD['horizon']))
    r = twin.simulate(well, with_fmi=False)['rows'][day]
    now = twin.build_lite(well, day, dict(spm=spm, down=down))
    opt = twin.mpc(well, day)
    applied, binding = twin.envelope(well, day, dict(spm=opt['spm'], down=opt['down']))
    return dict(
        well_id=well_id, day=day, spm=spm, t_pump=r['Tpump'], mu=r['mu'], fmi=now['fmi'], gross=now['gross'],
        fillage=min(1.0, r['inflow'] / twin.displacement(spm)),
        requested_spm=opt['spm'], applied_spm=applied['spm'], down=applied['down'],
        binding=binding, accepted=binding is None,
    )


def log_line(d):
    verdict = 'accepted' if d['accepted'] else f"clamped ({d['binding']})"
    return (f"{d['well_id']} d{d['day']} T_pump={d['t_pump']:.1f}C mu={d['mu']:.0f}cP FMI={d['fmi']:.3f}"
            f" -> SPM {d['applied_spm']:.1f} {verdict}")


def handle(payload, writer=None):
    """One telemetry message -> (setpoint message, decision). Pure apart from the writer."""
    d = decide(payload['well_id'], payload['day'], float(payload['spm']))
    ts = payload.get('ts') or datetime.now(timezone.utc).isoformat()
    if writer:
        writer.telemetry(dict(ts=ts, **{k: d[k] for k in ('well_id', 'day', 't_pump', 'mu', 'fmi', 'spm', 'gross', 'fillage')}))
        writer.decision(dict(ts=ts, well_id=d['well_id'], requested_spm=d['requested_spm'], applied_spm=d['applied_spm'],
                             binding=d['binding'], accepted=d['accepted'], reason='mpc'))
    setpoint = dict(ts=ts, well_id=d['well_id'], day=d['day'], spm=d['applied_spm'], down=d['down'],
                    requested_spm=d['requested_spm'], binding=d['binding'], accepted=d['accepted'])
    return setpoint, d


def make_client(writer=None, host=None, port=None):
    host = host or os.environ.get('MQTT_HOST', 'localhost')
    port = int(port or os.environ.get('MQTT_PORT', 1883))
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='ushna-edge-bridge')
    client.reconnect_delay_set(1, 10)

    def on_connect(c, _userdata, _flags, reason, _props):
        if reason.is_failure:
            log.warning('MQTT connect refused: %s', reason)
            return
        c.subscribe(TELEMETRY_TOPIC)
        log.info('bridge connected to %s:%d, listening on %s', host, port, TELEMETRY_TOPIC)

    def on_message(c, _userdata, msg):
        try:
            payload = json.loads(msg.payload)
            if payload.get('well_id') not in twin.WELL_BY_ID:
                log.warning('unknown well on %s, ignored', msg.topic)
                return
            setpoint, d = handle(payload, writer)
            c.publish(f"ushna/{d['well_id']}/setpoint", json.dumps(setpoint), qos=1)
            print(log_line(d), flush=True)
        except Exception:  # a bad message must not stop the loop
            log.exception('failed to handle message on %s', msg.topic)

    client.on_connect, client.on_message = on_connect, on_message
    client.connect_async(host, port)
    return client


def start_in_background(writer=None):
    """Runs the bridge on paho's network thread (used by the API process)."""
    client = make_client(writer)
    client.loop_start()  # retries the first connection until the broker is up
    return client


if __name__ == '__main__':
    from ushna.data.db_writer import writer_from_env

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')
    make_client(writer_from_env()).loop_forever(retry_first_connection=True)
