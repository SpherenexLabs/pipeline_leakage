export const number = (value, digits = 0) => new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: digits, minimumFractionDigits: digits,
}).format(Number(value) || 0);
export const money = value => `₹${number(value, 2)}`;
export const dateKey = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dateLabel = value => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const timeLabel = value => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const isLeak = record => record?.leakageStatus === 'LEAKAGE DETECTED';
export function validRange(from, to) {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}
export function inRange(records, from, to) {
  return records.filter(record => {
    const key = record.date || dateKey(record.timestamp);
    return key >= from && key <= to;
  });
}
// Keep the charts responsive over long ranges while retaining flow/pressure peaks
// and at least one acoustic and leakage event in each time bucket.
export function historicalChartSeries(records, maxPoints = 402) {
  const ordered = [...records].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  let selected = ordered;
  if (ordered.length > maxPoints) {
    const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 8));
    const indices = new Set([0, ordered.length - 1]);
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = 1 + Math.floor(bucket * (ordered.length - 2) / bucketCount);
      const end = 1 + Math.floor((bucket + 1) * (ordered.length - 2) / bucketCount);
      if (start >= end) continue;
      const slice = ordered.slice(start, end);
      const lowest = field => start + slice.reduce((best, item, i) => Number(item[field]) < Number(slice[best][field]) ? i : best, 0);
      const highest = field => start + slice.reduce((best, item, i) => Number(item[field]) > Number(slice[best][field]) ? i : best, 0);
      indices.add(start);
      indices.add(end - 1);
      indices.add(lowest('flow'));
      indices.add(highest('flow'));
      indices.add(lowest('pressure'));
      indices.add(highest('pressure'));
      const acoustic = slice.findIndex(record => record.acousticStatus === 'Abnormal');
      const leakage = slice.findIndex(record => record.leakageCount > 0);
      if (acoustic >= 0) indices.add(start + acoustic);
      if (leakage >= 0) indices.add(start + leakage);
    }
    selected = [...indices].sort((a, b) => a - b).map(index => ordered[index]);
  }
  const oneDay = selected.length > 0 && dateKey(selected[0].timestamp) === dateKey(selected[selected.length - 1].timestamp);
  return selected.map(record => ({
    ...record,
    label: `${dateLabel(record.timestamp)} ${timeLabel(record.timestamp)}`,
    tickLabel: oneDay ? timeLabel(record.timestamp).slice(0, 5) : `${dateKey(record.timestamp).slice(5)} ${timeLabel(record.timestamp).slice(0, 5)}`,
    acousticEvents: record.acousticStatus === 'Abnormal' ? 1 : 0,
    leakageCount: Number(record.leakageCount) || 0,
  }));
}
export function summarize(records, costPerLiter) {
  const supplied = records.reduce((sum, record) => sum + record.supplied, 0);
  const consumed = records.reduce((sum, record) => sum + record.consumed, 0);
  const wasted = records.reduce((sum, record) => sum + record.wasted, 0);
  const flows = records.map(record => record.flow);
  const pressures = records.filter(record => record.pressureAvailable !== false && Number.isFinite(record.pressure));
  return {
    supplied, consumed, wasted, cost: wasted * costPerLiter,
    avgFlow: flows.length ? flows.reduce((sum, value) => sum + value, 0) / flows.length : 0,
    minFlow: flows.length ? Math.min(...flows) : 0,
    maxFlow: flows.length ? Math.max(...flows) : 0,
    avgPressure: pressures.length ? pressures.reduce((sum, record) => sum + record.pressure, 0) / pressures.length : 0,
    pressureDrops: records.filter(record => record.pressureStatus === 'Reduced').length,
    avgVariation: records.length ? records.reduce((sum, record) => sum + (record.flowVariation || 0), 0) / records.length : 0,
    acousticEvents: records.filter(record => record.acousticStatus === 'Abnormal').length,
    leakageCount: records.reduce((sum, record) => sum + (record.leakageCount || 0), 0),
  };
}
function periodKey(record, period) {
  const date = new Date(`${record.date}T12:00:00`);
  if (period === 'Yearly') return record.date.slice(0, 4);
  if (period === 'Monthly') return record.date.slice(0, 7);
  if (period === 'Weekly') {
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return dateKey(date);
  }
  return record.date;
}
export function aggregate(records, period, costPerLiter = 0.1) {
  const groups = new Map();
  for (const record of records) {
    const key = periodKey(record, period);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => {
    const summary = summarize(entries, costPerLiter);
    return {
      key,
      label: period === 'Yearly' ? key : period === 'Monthly'
        ? new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
        : `${period === 'Weekly' ? 'Week of ' : ''}${dateLabel(key)}`,
      ...summary,
      flow: summary.avgFlow,
      pressure: summary.avgPressure,
      flowVariation: entries.reduce((sum, record) => sum + (record.flowVariation || 0), 0) / entries.length,
      acoustic: entries.filter(record => record.acousticStatus === 'Abnormal').length / entries.length,
    };
  });
}
