import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribe, writeAlertState } from './firebase.js';
import { createAlertSync } from './alertSync.mjs';
import { classify, deriveRecords, mapReading, reclassifyReading, sameReading } from './pipeline.mjs';
import { timeLabel } from './analytics.mjs';

const STORAGE_KEY = 'water-pipeline-readings';
const MAX_LOGS = 8000;
const HEARTBEAT_MS = 60000;
const SERIES_LENGTH = 60;

function loadLogs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored.filter(log => log && !Number.isNaN(Date.parse(log.timestamp))).map(reclassifyReading) : [];
  } catch { return []; }
}
function saveLogs(logs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)); } catch { /* History still works for this session. */ }
}

export function useMonitoring() {
  const [raw, setRaw] = useState(null);
  const [received, setReceived] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState(loadLogs);
  const [now, setNow] = useState(Date.now());
  const [refresh, setRefresh] = useState(0);
  const [writeError, setWriteError] = useState('');
  const alertSync = useRef(null);

  const append = (reading, force) => setLogs(prev => {
    if (!force && sameReading(prev[prev.length - 1], reading)) return prev;
    const next = [...prev, reading].slice(-MAX_LOGS);
    saveLogs(next);
    return next;
  });

  useEffect(() => {
    setError('');
    return subscribe({
      onOpen: () => { setConnected(true); setError(''); },
      onData: value => { setRaw(value); setReceived(true); setLastUpdate(new Date().toISOString()); },
      onError: message => { setConnected(false); setError(message); },
    });
  }, [refresh]);

  useEffect(() => { if (raw) append(mapReading(raw), false); }, [raw]);

  useEffect(() => {
    const sync = createAlertSync({ write: writeAlertState, onError: setWriteError });
    alertSync.current = sync;
    return () => { sync.dispose(); alertSync.current = null; };
  }, []);

  useEffect(() => { alertSync.current?.update(raw); }, [raw]);

  useEffect(() => {
    if (!raw || !connected) return undefined;
    const timer = setInterval(() => { append(mapReading(raw), true); setNow(Date.now()); }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [raw, connected]);

  const data = useMemo(() => {
    if (!raw) return null;
    const { records, events, tailWasted, base } = deriveRecords(logs, now);
    const current = classify(mapReading(raw, lastUpdate || new Date().toISOString()), base);
    const wasted = records.reduce((sum, record) => sum + record.wasted, 0) + tailWasted;
    return {
      current: { ...current, supplied: current.totalSupplied, wasted, consumed: Math.max(0, current.totalSupplied - wasted) },
      history: records,
      events,
      logs: [...records].reverse(),
      series: records.slice(-SERIES_LENGTH).map(log => ({ ...log, flowPerSecond: log.flow / 60, label: timeLabel(log.timestamp).slice(0, 5), acoustic: log.acousticStatus === 'Abnormal' ? 1 : 0, leakage: log.leakageStatus === 'LEAKAGE DETECTED' })),
      connectivity: { cloud: connected, lastUpdate },
    };
  }, [raw, logs, now, connected, lastUpdate]);

  const clearHistory = () => { saveLogs([]); setLogs(raw ? [mapReading(raw)] : []); };

  return { data, received, loading: !received && !error, error, writeError, retry: () => setRefresh(value => value + 1), clearHistory };
}
