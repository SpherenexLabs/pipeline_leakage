const cell = value => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const volume = value => Number(value || 0).toFixed(2);
const pressure = value => Number(value || 0).toFixed(5);

// Use plain numeric cells so spreadsheet applications can total and chart the download.
export function buildReportCsv({ period, from, to, cost, groups, totals }) {
  const rows = [
    ['Water Pipeline Monitoring Report'],
    ['Analysis period', period],
    ['From date', from],
    ['To date', to],
    ['Cost per liter (INR)', cost],
    [],
    ['Period', 'Water supplied (L)', 'Estimated consumption (L)', 'Estimated wastage (L)', 'Average pressure (bar)', 'Leakage events', 'Estimated loss (INR)'],
    ...groups.map(row => [row.label, volume(row.supplied), volume(row.consumed), volume(row.wasted), pressure(row.avgPressure), row.leakageCount, volume(row.cost)]),
    ['Total', volume(totals.supplied), volume(totals.consumed), volume(totals.wasted), pressure(totals.avgPressure), totals.leakageCount, volume(totals.cost)],
  ];
  return `${rows.map(row => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
