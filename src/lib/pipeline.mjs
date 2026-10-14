import { dateKey, isLeak } from './analytics.mjs';

// Pressure counts as reduced below this share of the normal-condition average.
export const PRESSURE_DROP_RATIO = 0.9;
// Acoustic peak-to-peak counts as abnormal above this multiple of the normal-condition average.
export const ACOUSTIC_RISE_RATIO = 1.5;
// Gaps longer than this mean the dashboard was closed, so leakage time is not extrapolated across them.
export const MAX_GAP_MS = 3 * 60 * 1000;
const nonnegative = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };
const finite = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validFlow = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

// Leakage when the outlet flow is below the inlet flow; NORMAL when inlet <= outlet.
// A missing outlet reading must not trigger an alert write; a missing inlet counts as 0.
export function desiredAlertState(raw) {
  const outlet = raw?.flow_sensor_2?.flow_rate_lpm;
  if (!validFlow(outlet)) return null;
  const leaking = Number(outlet) < nonnegative(raw?.flow_sensor?.flow_rate_lpm);
  return { leaking, state: leaking ? 1 : 0, status: leaking ? 'LEAKAGE DETECTED' : 'NORMAL' };
}

export function reclassifyReading(reading) {
  const desired = desiredAlertState({ flow_sensor: { flow_rate_lpm: reading.flow }, flow_sensor_2: { flow_rate_lpm: reading.outletAvailable === false ? undefined : reading.outletFlow } });
  const inletFlow = nonnegative(reading.flow);
  const outletFlow = nonnegative(reading.outletFlow);
  const leakageStatus = desired?.status ?? 'WAITING FOR OUTLET FLOW DATA';
  return {
    ...reading,
    detectionStatus: leakageStatus,
    leakageStatus,
    leakRate: desired?.leaking ? Math.max(0, inletFlow - outletFlow) : 0,
    flowDiscrepancy: desired ? Math.abs(inletFlow - outletFlow) : 0,
  };
}

export function alertStateMatches(raw, desired) {
  const matchesState = value => value !== null && value !== undefined && Number(value) === desired.state;
  return matchesState(raw?.led?.state)
    && matchesState(raw?.buzzer?.state)
    && raw?.detection?.status === desired.status;
}

function setAt(node, keys, value) {
  if (!keys.length) return value ?? null;
  const [key, ...rest] = keys;
  const next = { ...(isObject(node) ? node : {}) };
  const child = setAt(next[key], rest, value);
  if (child === null) delete next[key]; else next[key] = child;
  return Object.keys(next).length ? next : null;
}

// Applies a Firebase REST streaming "put" or "patch" event to the locally held value.
export function applyStreamEvent(root, type, { path, data }) {
  const keys = path.split('/').filter(Boolean);
  if (type === 'patch' && isObject(data)) {
    // Multi-path patches use slash-separated keys such as "led/state".
    return Object.entries(data).reduce((value, [key, child]) => setAt(value, [...keys, ...key.split('/').filter(Boolean)], child), root);
  }
  return setAt(root, keys, data);
}

// Maps the water_pipeline node to the reading shape used by the dashboard.
export function mapReading(raw, timestamp = new Date().toISOString()) {
  const flow = raw?.flow_sensor || {};
  const outlet = raw?.flow_sensor_2 || {};
  const comparison = raw?.flow_comparison || {};
  const acoustic = raw?.acoustic_sensor || {};
  const pressure = raw?.pressure_sensor || {};
  const inletFlow = nonnegative(flow.flow_rate_lpm);
  const outletFlow = nonnegative(outlet.flow_rate_lpm);
  return reclassifyReading({
    timestamp,
    deviceStatus: String(raw?.detection?.status ?? '').trim(),
    flow: inletFlow,
    flowPerSecond: inletFlow / 60,
    flowVariation: finite(flow.flow_variation_lpm),
    abnormalFlow: nonnegative(flow.abnormal_flow_during_leakage_lpm),
    totalSupplied: nonnegative(flow.total_water_supplied_liters),
    outletFlow,
    outletAvailable: validFlow(outlet.flow_rate_lpm),
    outletVariation: finite(outlet.flow_variation_lpm),
    totalOutlet: nonnegative(outlet.total_water_outlet_liters),
    inletMinusOutlet: finite(comparison.inlet_minus_outlet_lpm),
    estimatedLeakage: nonnegative(comparison.estimated_leakage_lpm),
    pressure: nonnegative(pressure.pressure),
    pressureAvailable: validFlow(pressure.pressure),
    rawPressure: finite(pressure.raw_pressure),
    acousticRms: nonnegative(acoustic.acoustic_rms),
    acousticAverage: nonnegative(acoustic.average_adc),
    acousticMax: nonnegative(acoustic.maximum_adc),
    acousticMin: nonnegative(acoustic.minimum_adc),
    acousticPeak: nonnegative(acoustic.peak_to_peak),
    ledActive: Boolean(Number(raw?.led?.state)),
    buzzerActive: Boolean(Number(raw?.buzzer?.state)),
  });
}

// Average pressure and acoustic level of readings recorded while the device reported NORMAL.
export function baseline(readings) {
  const normal = readings.filter(reading => reading.leakageStatus === 'NORMAL');
  const average = key => normal.length ? normal.reduce((sum, reading) => sum + (reading[key] || 0), 0) / normal.length : 0;
  return { pressure: average('pressure'), acousticPeak: average('acousticPeak') };
}
export function classify(reading, base) {
  return {
    ...reading,
    pressureStatus: base.pressure > 0 && reading.pressure < base.pressure * PRESSURE_DROP_RATIO ? 'Reduced' : 'Normal',
    acousticStatus: reading.acousticPeak > base.acousticPeak * ACOUSTIC_RISE_RATIO ? 'Abnormal' : 'Normal',
  };
}

export function sameReading(a, b) {
  return Boolean(a && b) && Object.keys(a).every(key => key === 'timestamp' || a[key] === b[key]);
}

// Turns the recorded readings into incremental history rows and leakage events.
export function deriveRecords(readings, now = Date.now()) {
  const base = baseline(readings);
  const logs = readings.map(reading => classify(reading, base));
  const records = [];
  const events = [];
  let open = null;
  logs.forEach((log, i) => {
    const prev = logs[i - 1];
    const gap = prev ? Date.parse(log.timestamp) - Date.parse(prev.timestamp) : Infinity;
    const continuous = gap >= 0 && gap <= MAX_GAP_MS;
    const supplied = prev ? (log.totalSupplied >= prev.totalSupplied ? log.totalSupplied - prev.totalSupplied : log.totalSupplied) : 0;
    const leakMinutes = continuous && isLeak(prev) ? gap / 60000 : 0;
    const wasted = prev ? (prev.leakRate || 0) * leakMinutes : 0;
    if (open) {
      open.durationSeconds += leakMinutes * 60;
      open.estimatedWastage += wasted;
      if (!continuous || !isLeak(log)) open = null;
    }
    const starts = isLeak(log) && !open;
    if (starts) {
      open = { ...log, id: String(events.length + 1).padStart(3, '0'), durationSeconds: 0, estimatedWastage: 0, ongoing: false };
      events.push(open);
    }
    records.push({ ...log, date: dateKey(log.timestamp), supplied, wasted, consumed: Math.max(0, supplied - wasted), leakageCount: starts ? 1 : 0 });
  });
  const last = logs[logs.length - 1];
  let tailWasted = 0;
  if (open && last) {
    const tail = Math.min(Math.max(0, now - Date.parse(last.timestamp)), MAX_GAP_MS);
    tailWasted = (last.leakRate || 0) * tail / 60000;
    open.durationSeconds += tail / 1000;
    open.estimatedWastage += tailWasted;
    open.ongoing = true;
  }
  return { records, events, tailWasted, base };
}
