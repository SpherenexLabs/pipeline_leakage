import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, historicalChartSeries, inRange, summarize, validRange } from '../src/lib/analytics.mjs';
import { alertStateMatches, applyStreamEvent, baseline, classify, deriveRecords, desiredAlertState, mapReading, reclassifyReading } from '../src/lib/pipeline.mjs';
import { pipelineUrl, writeAlertState } from '../src/lib/firebase.js';

const records = [
  { date: '2026-09-30', supplied: 1000, consumed: 850, wasted: 150, flow: 6, flowVariation: 2, acousticStatus: 'Abnormal', leakageCount: 1 },
  { date: '2026-10-01', supplied: 800, consumed: 800, wasted: 0, flow: 8, flowVariation: 0, acousticStatus: 'Normal', leakageCount: 0 },
  { date: '2026-10-02', supplied: 1200, consumed: 1000, wasted: 200, flow: 7, flowVariation: 2, acousticStatus: 'Abnormal', leakageCount: 2 },
];
test('cost and volume totals use each period volume exactly once', () => {
  const totals = summarize(records, .1);
  assert.equal(totals.supplied, 3000);
  assert.equal(totals.consumed, 2650);
  assert.equal(totals.wasted, 350);
  assert.equal(totals.cost, 35);
  assert.equal(totals.avgFlow, 7);
  assert.equal(totals.leakageCount, 3);
  assert.equal(totals.avgVariation, 4 / 3);
});
test('date filtering includes both boundary dates and excludes older data', () => {
  assert.equal(inRange(records, '2026-10-01', '2026-10-02').length, 2);
  assert.equal(inRange(records, '2026-10-02', '2026-10-02').length, 1);
  assert.equal(inRange(records, '2027-01-01', '2027-01-31').length, 0);
  assert.equal(validRange('2026-10-02', '2026-10-01'), false);
});
test('monthly, weekly and yearly grouping preserves total volumes and leakage counts', () => {
  const monthly = aggregate(records, 'Monthly', .2);
  assert.equal(monthly.length, 2);
  assert.equal(monthly[1].supplied, 2000);
  assert.equal(monthly[1].cost, 40);
  assert.equal(aggregate(records, 'Weekly').length, 1);
  assert.equal(aggregate(records, 'Yearly')[0].leakageCount, 3);
});
test('empty periods contain zero values without invalid averages', () => {
  assert.equal(summarize([], .1).avgFlow, 0);
  assert.equal(summarize([], .1).cost, 0);
  assert.deepEqual(aggregate([], 'Daily'), []);
});
test('historical charts plot individual same-day readings instead of one daily summary', () => {
  const readings = [
    { date: '2026-10-13', timestamp: '2026-10-13T10:00:00Z', flow: 10, pressure: .9, acousticStatus: 'Normal', leakageCount: 0 },
    { date: '2026-10-13', timestamp: '2026-10-13T10:01:00Z', flow: 8, pressure: .8, acousticStatus: 'Abnormal', leakageCount: 1 },
    { date: '2026-10-13', timestamp: '2026-10-13T10:02:00Z', flow: 10, pressure: .9, acousticStatus: 'Normal', leakageCount: 0 },
  ];
  assert.equal(aggregate(readings, 'Daily').length, 1);
  const series = historicalChartSeries(readings);
  assert.deepEqual(series.map(point => point.flow), [10, 8, 10]);
  assert.deepEqual(series.map(point => point.acousticEvents), [0, 1, 0]);
  assert.deepEqual(series.map(point => point.leakageCount), [0, 1, 0]);
  assert.equal(series[0].tickLabel.length, 5);
});
test('long historical ranges retain endpoints, peaks and alerts when sampled', () => {
  const readings = Array.from({ length: 800 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 9, 13, 0, i)).toISOString(),
    flow: i === 310 ? 50 : 10,
    pressure: i === 460 ? .2 : .9,
    acousticStatus: i === 510 ? 'Abnormal' : 'Normal',
    leakageCount: i === 610 ? 1 : 0,
  }));
  const series = historicalChartSeries(readings, 82);
  assert.ok(series.length <= 82);
  assert.equal(series[0].timestamp, readings[0].timestamp);
  assert.equal(series.at(-1).timestamp, readings.at(-1).timestamp);
  assert.ok(series.some(point => point.flow === 50));
  assert.ok(series.some(point => point.pressure === .2));
  assert.ok(series.some(point => point.acousticEvents === 1));
  assert.ok(series.some(point => point.leakageCount === 1));
});
const node = {
  acoustic_sensor: { acoustic_rms: 0, average_adc: 0, maximum_adc: 0, minimum_adc: 0, peak_to_peak: 0 }, buzzer: { state: 0 }, detection: { status: 'NORMAL' },
  flow_sensor: { abnormal_flow_during_leakage_lpm: 0, flow_rate_lpm: 4, flow_variation_lpm: 0, total_water_supplied_liters: 0 }, led: { state: 0 },
  pressure_sensor: { pressure: 0.91269, raw_pressure: 91269 }, flow_sensor_2: { flow_rate_lpm: 4, flow_variation_lpm: 0, total_water_outlet_liters: 0 },
  flow_comparison: { estimated_leakage_lpm: 0, inlet_minus_outlet_lpm: 0 },
};
test('Firebase stream events update nested values and deletions', () => {
  let value = applyStreamEvent(null, 'put', { path: '/', data: node });
  value = applyStreamEvent(value, 'put', { path: '/flow_sensor/flow_rate_lpm', data: 7.5 });
  value = applyStreamEvent(value, 'patch', { path: '/detection', data: { status: 'LEAKAGE' } });
  assert.equal(value.flow_sensor.flow_rate_lpm, 7.5);
  assert.equal(value.flow_sensor.total_water_supplied_liters, 0);
  assert.equal(value.detection.status, 'LEAKAGE');
  assert.equal(applyStreamEvent(value, 'put', { path: '/', data: null }), null);
});
test('outlet flow below inlet flow is the leakage condition', () => {
  const normal = mapReading(node, '2026-10-13T10:00:00Z');
  assert.equal(normal.leakageStatus, 'NORMAL');
  assert.equal(normal.ledActive, false);
  assert.equal(normal.pressure, 0.91269);
  assert.equal(normal.pressureAvailable, true);
  assert.equal(normal.rawPressure, 91269);
  assert.equal(mapReading({ ...node, pressure_sensor: {} }).pressureAvailable, false);
  assert.equal(mapReading({ ...node, pressure_sensor: { pressure: 0 } }).pressureAvailable, true);
  assert.equal(normal.outletFlow, 4);
  const inlet = flow => ({ ...node, flow_sensor: { ...node.flow_sensor, flow_rate_lpm: flow } });
  const outlet = flow => ({ ...node, flow_sensor_2: { ...node.flow_sensor_2, flow_rate_lpm: flow } });
  const leak = mapReading(outlet(1));
  assert.equal(leak.leakageStatus, 'LEAKAGE DETECTED');
  assert.equal(leak.leakRate, 3);
  assert.equal(mapReading(inlet(60)).flowPerSecond, 1);
  assert.equal(mapReading(inlet(4)).leakageStatus, 'NORMAL');
  assert.equal(mapReading(inlet(3.9)).leakageStatus, 'NORMAL');
  assert.equal(mapReading(inlet(4.01)).leakageStatus, 'LEAKAGE DETECTED');
  assert.equal(mapReading(outlet(10)).leakageStatus, 'NORMAL');
  assert.equal(mapReading(outlet(0)).leakageStatus, 'LEAKAGE DETECTED');
  assert.equal(mapReading({ ...node, detection: { status: 'LEAKAGE DETECTED' } }).leakageStatus, 'NORMAL');
  assert.equal(mapReading({}).leakageStatus, 'WAITING FOR OUTLET FLOW DATA');
  assert.equal(mapReading({ flow_sensor_2: { flow_rate_lpm: 0 } }).leakageStatus, 'NORMAL');
});
test('inlet versus outlet comparison drives the Firebase alert fields', async () => {
  const readings = (inlet, outlet) => ({ ...node,
    flow_sensor: { flow_rate_lpm: inlet }, flow_sensor_2: { flow_rate_lpm: outlet },
  });
  const leak = desiredAlertState(readings(10, 1));
  assert.deepEqual(leak, { leaking: true, state: 1, status: 'LEAKAGE DETECTED' });
  assert.equal(alertStateMatches(readings(10, 1), leak), false);
  assert.equal(alertStateMatches({ ...readings(10, 1), led: { state: 1 }, buzzer: { state: 1 }, detection: { status: 'LEAKAGE DETECTED' } }, leak), true);
  assert.deepEqual(desiredAlertState(readings(4, 4)), { leaking: false, state: 0, status: 'NORMAL' });
  assert.equal(desiredAlertState(readings(100, 80)).status, 'LEAKAGE DETECTED');
  assert.equal(desiredAlertState(readings(0.65104, 0)).status, 'LEAKAGE DETECTED');
  assert.equal(desiredAlertState(readings(3.12808, 3.23663)).status, 'NORMAL');
  assert.equal(desiredAlertState(readings(0, 0)).status, 'NORMAL');
  assert.equal(desiredAlertState(readings(.07589, .2656)).status, 'NORMAL');
  assert.equal(mapReading(readings(10, 1)).leakRate, 9);
  assert.equal(mapReading(readings(0, .2)).leakRate, 0);
  assert.equal(desiredAlertState(readings(10, undefined)), null);
  assert.equal(desiredAlertState(readings(undefined, 0)).status, 'NORMAL');

  const closedValve = { ...node, flow_sensor: { flow_rate_lpm: 10.09115 }, flow_sensor_2: { flow_rate_lpm: 6.51042 }, led: { state: 1 }, buzzer: { state: 1 }, detection: { status: 'LEAKAGE DETECTED' } };
  const openValve = { ...node, flow_sensor: { flow_rate_lpm: 0.13287 }, flow_sensor_2: { flow_rate_lpm: 4.84969 } };
  assert.equal(desiredAlertState(closedValve).status, 'LEAKAGE DETECTED');
  assert.equal(alertStateMatches(closedValve, desiredAlertState(closedValve)), true);
  assert.equal(desiredAlertState(openValve).status, 'NORMAL');

  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options) => { writes.push({ url, options }); return { ok: true }; };
  try {
    await writeAlertState(true);
    await writeAlertState(false);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(writes.map(({ url, options }) => ({ url, method: options.method, body: JSON.parse(options.body) })), [
    { url: `${pipelineUrl}.json`, method: 'PATCH', body: { 'led/state': 1, 'buzzer/state': 1, 'detection/status': 'LEAKAGE DETECTED' } },
    { url: `${pipelineUrl}.json`, method: 'PATCH', body: { 'led/state': 0, 'buzzer/state': 0, 'detection/status': 'NORMAL' } },
  ]);
});
test('previously saved readings are reclassified using the inlet/outlet comparison', () => {
  const previousLeak = { flow: 3.12808, outletFlow: 3.23663, leakageStatus: 'LEAKAGE DETECTED', detectionStatus: 'LEAKAGE DETECTED' };
  const previousNormal = { flow: .65104, outletFlow: 0, leakageStatus: 'NORMAL', detectionStatus: 'NORMAL' };
  assert.equal(reclassifyReading(previousLeak).leakageStatus, 'NORMAL');
  assert.equal(reclassifyReading(previousNormal).leakageStatus, 'LEAKAGE DETECTED');
});
test('pressure drops and acoustic rises are judged against normal-condition readings', () => {
  const reading = (pressure, peak, leaking = false) => mapReading({ ...node, flow_sensor_2: { flow_rate_lpm: leaking ? .5 : 4 }, pressure_sensor: { pressure }, acoustic_sensor: { peak_to_peak: peak } });
  const base = baseline([reading(1, 100), reading(1, 100), reading(0.5, 900, true)]);
  assert.deepEqual(base, { pressure: 1, acousticPeak: 100 });
  assert.equal(classify(reading(0.95, 120), base).pressureStatus, 'Normal');
  assert.equal(classify(reading(0.8, 120), base).pressureStatus, 'Reduced');
  assert.equal(classify(reading(0.8, 120), base).acousticStatus, 'Normal');
  assert.equal(classify(reading(0.8, 200), base).acousticStatus, 'Abnormal');
  assert.equal(classify(reading(0.8, 0), baseline([])).pressureStatus, 'Normal');
});
test('recorded readings produce incremental supply, leakage events and wastage', () => {
  const at = (minute, outletFlow, total) => ({ ...mapReading({ ...node, flow_sensor: { ...node.flow_sensor, total_water_supplied_liters: total }, flow_sensor_2: { flow_rate_lpm: outletFlow } }), timestamp: new Date(Date.UTC(2026, 9, 13, 10, minute)).toISOString() });
  const logs = [at(0, 4, 100), at(1, 0, 110), at(2, 0, 120), at(3, 4, 130), at(30, 0, 140)];
  const { records, events, tailWasted } = deriveRecords(logs, Date.parse(logs[4].timestamp) + 60000);
  assert.deepEqual(records.map(record => record.supplied), [0, 10, 10, 10, 10]);
  assert.equal(records.reduce((sum, record) => sum + record.wasted, 0), 8);
  assert.equal(events.length, 2);
  assert.equal(events[0].durationSeconds, 120);
  assert.equal(events[0].ongoing, false);
  assert.equal(events[1].ongoing, true);
  assert.equal(tailWasted, 4);
});
test('multi-path stream patches update nested alert fields', () => {
  let value = applyStreamEvent(null, 'put', { path: '/', data: { led: { state: 1 }, buzzer: { state: 1 }, detection: { status: 'LEAKAGE DETECTED' } } });
  value = applyStreamEvent(value, 'patch', { path: '/', data: { 'led/state': 0, 'buzzer/state': 0, 'detection/status': 'NORMAL' } });
  assert.deepEqual(value, { led: { state: 0 }, buzzer: { state: 0 }, detection: { status: 'NORMAL' } });
});
