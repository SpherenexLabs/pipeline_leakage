import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, summarize } from '../src/lib/analytics.mjs';
import { buildReportCsv } from '../src/lib/report.mjs';

test('CSV report exports the selected period, pressure, and numeric totals', () => {
  const readings = [
    { date: '2026-10-13', supplied: 10, consumed: 8, wasted: 2, flow: 6, pressure: 0.913, leakageCount: 1 },
    { date: '2026-10-13', supplied: 20, consumed: 20, wasted: 0, flow: 4, pressure: 0.917, leakageCount: 0 },
  ];
  const csv = buildReportCsv({
    period: 'Daily', from: '2026-10-13', to: '2026-10-13', cost: 0.5,
    groups: aggregate(readings, 'Daily', 0.5), totals: summarize(readings, 0.5),
  });
  assert.match(csv, /Analysis period,Daily\r\nFrom date,2026-10-13\r\nTo date,2026-10-13/);
  assert.match(csv, /Average pressure \(bar\),Leakage events,Estimated loss \(INR\)/);
  assert.match(csv, /13 Oct 2026,30\.00,28\.00,2\.00,0\.91500,1,1\.00/);
  assert.match(csv, /Total,30\.00,28\.00,2\.00,0\.91500,1,1\.00/);
});

test('missing pressure readings do not lower the report average', () => {
  const readings = [
    { date: '2026-10-13', supplied: 0, consumed: 0, wasted: 0, flow: 4, pressure: 0.91319, pressureAvailable: true, leakageCount: 0 },
    { date: '2026-10-13', supplied: 0, consumed: 0, wasted: 0, flow: 4, pressure: 0, pressureAvailable: false, leakageCount: 0 },
  ];
  const totals = summarize(readings, 0.1);
  assert.equal(totals.avgPressure, 0.91319);
  assert.equal(aggregate(readings, 'Daily')[0].pressure, 0.91319);
});
