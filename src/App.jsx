import React, { useEffect, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';
import { AcousticStrip, LineChart, WaterComparison } from './components/Charts.jsx';
import { useMonitoring } from './lib/data.js';
import { PIPELINE_PATH, pipelineUrl } from './lib/firebase.js';
import { buildReportCsv } from './lib/report.mjs';
import { aggregate, dateKey, dateLabel, historicalChartSeries, inRange, isLeak, money, number, summarize, timeLabel, validRange } from './lib/analytics.mjs';

const navigation = [
  ['overview', 'Overview', 'home'], ['sensors', 'Live Sensor Graphs', 'chart'],
  ['history', 'Historical Analysis', 'bars'], ['leaks', 'Leakage History', 'alert'],
  ['usage', 'Water Usage & Cost', 'drop'], ['reports', 'Reports', 'report'],
  ['log', 'Data Log', 'cloud'],
];
const periods = ['Daily', 'Weekly', 'Monthly', 'Yearly'];
// Dashboard flow-to-pressure calibration: 0.010 L/s corresponds to 1 bar.
// Replace this constant with the pipe/pump calibration when available.
const PRESSURE_PER_LPS = 100;

function Status({ label, active = true }) {
  return <span className={`status-chip ${active ? 'online' : 'offline'}`}><i/>{label}</span>;
}
function Card({ title, icon, children, className = '', action }) {
  return <section className={`card ${className}`}><div className="card-heading"><h2>{icon && <Icon name={icon}/>} {title}</h2>{action}</div>{children}</section>;
}
function Empty({ children = 'No records for the selected period.' }) {
  return <div className="empty-state"><Icon name="report" size={32}/><p>{children}</p></div>;
}
function PeriodTabs({ period, onChange }) {
  return <div className="period-tabs" role="group" aria-label="Analysis period">{periods.map(value => <button key={value} onClick={() => onChange(value)} className={period === value ? 'selected' : ''} aria-pressed={period === value}>{value}</button>)}</div>;
}
function DateFilters({ from, to, onApply, period, onPeriodChange, compact = false }) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [error, setError] = useState('');
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to]);
  return <form className={`date-filter ${compact ? 'compact' : ''}`} onSubmit={event => {
    event.preventDefault();
    if (!validRange(draftFrom, draftTo)) { setError('Choose a valid date range. From Date must not be later than To Date.'); return; }
    setError(''); onApply(draftFrom, draftTo);
  }}>
    <div className="filter-fields"><label>From Date<input type="date" required value={draftFrom} onChange={event => setDraftFrom(event.target.value)} aria-label="From Date"/></label><label>To Date<input type="date" required value={draftTo} onChange={event => setDraftTo(event.target.value)} aria-label="To Date"/></label><button type="submit" className="primary apply-button">Apply</button></div>
    {onPeriodChange && <PeriodTabs period={period} onChange={onPeriodChange}/>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </form>;
}
function Metric({ title, value, unit, icon, color = 'blue', subtitle }) {
  return <div className={`metric-card ${color}`}><div className="metric-icon"><Icon name={icon} size={29}/></div><div><h2>{title}</h2><div className="metric-value">{value}{unit && <span> {unit}</span>}</div>{subtitle && <p>{subtitle}</p>}</div></div>;
}
function SensorCards({ current }) {
  const flowBasedPressure = current.flowPerSecond * PRESSURE_PER_LPS;
  return <div className="sensor-grid">
    <Metric title="Inlet Flow" value={number(current.flow, 1)} unit="L/min" icon="drop" subtitle={`Variation ${number(current.flowVariation, 1)} L/min`}/>
    <Metric title="Water Flow per Second" value={number(current.flowPerSecond, 3)} unit="L/s" icon="gauge" color="teal" subtitle={`From inlet flow ${number(current.flow, 1)} L/min`}/>
    <Metric title="Outlet Flow" value={current.outletAvailable ? number(current.outletFlow, 5) : '—'} unit={current.outletAvailable ? 'L/min' : ''} icon="drop" color="teal" subtitle={current.outletAvailable ? 'Leak alert when below inlet flow' : 'Waiting for outlet reading'}/>
    <Metric title="Inside Water Pressure" value={number(flowBasedPressure, 5)} unit="bar" icon="gauge" color="teal" />
    <Metric title="Outside Water Pressure" value={current.pressureAvailable ? number(current.pressure, 5) : '—'} unit={current.pressureAvailable ? 'bar' : ''} icon="gauge" color="teal" subtitle={current.pressureAvailable ? 'Firebase pressure_sensor.pressure' : 'Waiting for pressure reading'}/>
    <Metric title="Acoustic Status" value={current.acousticStatus} icon="wave" color={current.acousticStatus === 'Normal' ? 'teal' : 'red'} subtitle={`RMS ${number(current.acousticRms, 2)} · Peak-to-peak ${number(current.acousticPeak)}`}/>
  </div>;
}
function UsageCards({ values, cost }) {
  return <div className="usage-grid"><Metric title="Water Supplied" value={number(values.supplied, 2)} unit="L" icon="drop"/><Metric title="Estimated Consumption" value={number(values.consumed)} unit="L" icon="gear" color="teal"/><Metric title="Estimated Wastage" value={number(values.wasted)} unit="L" icon="alert" color="orange"/><Metric title="Estimated Water-Loss Cost" value={money(values.wasted * cost)} icon="coins" color="red" subtitle={`Cost per liter: ${money(cost)}`}/></div>;
}
function LeakageBanner({ current }) {
  const leaking = isLeak(current);
  const waiting = current.detectionStatus === 'WAITING FOR OUTLET FLOW DATA';
  return <div className={`leak-banner ${waiting ? 'waiting' : leaking ? 'danger' : 'safe'}`} role="status">
    <div className="banner-main"><Icon name={waiting ? 'clock' : leaking ? 'alert' : 'check'} size={29}/><strong>{waiting ? 'WAITING FOR OUTLET FLOW DATA' : leaking ? 'LEAKAGE DETECTED' : 'NORMAL CONDITION'}</strong><span>{waiting ? 'Awaiting outlet flow reading' : <>Inlet {number(current.flow, 2)} L/min · Outlet {number(current.outletFlow, 5)} L/min · {leaking ? 'Outlet below inlet' : 'Outlet at or above inlet'}</>}</span></div>  </div>;
}
function EventsTable({ events, compact = false, onSelect }) {
  if (!events.length) return <Empty/>;
  return <div className="table-scroll"><table className="events-table"><thead><tr><th>Event</th>{!compact && <th>Date</th>}<th>Time</th><th>Flow</th><th>Pressure</th><th>Acoustic</th><th>Detection</th>{!compact && <><th>Duration</th><th>Est. Wastage</th></>}</tr></thead><tbody>{events.map((event, i) => <tr key={event.id} className={i === 0 ? 'highlight-row' : ''}><td><button className="text-button event-link" onClick={() => onSelect(event)} aria-label={`View event ${event.id}`}>#{event.id}</button></td>{!compact && <td>{dateLabel(event.timestamp)}</td>}<td>{timeLabel(event.timestamp).slice(0, 5)}</td><td>{number(event.flow, 1)} L/min</td><td className={event.pressureStatus === 'Normal' ? '' : 'red-text'}>{number(event.pressure, 3)} bar</td><td className={event.acousticStatus === 'Abnormal' ? 'red-text' : ''}>{event.acousticStatus}</td><td><span className="red-text">{event.detectionStatus}</span></td>{!compact && <><td>{number((event.durationSeconds || 0) / 60, 1)} min{event.ongoing ? ' (ongoing)' : ''}</td><td>{number(event.estimatedWastage, 2)} L</td></>}</tr>)}</tbody></table></div>;
}
function EventDialog({ event, onClose, cost }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} className="event-dialog">
    <div className="dialog-heading"><h2>Leakage event #{event.id}</h2><button className="icon-button" onClick={onClose} aria-label="Close event details"><Icon name="close"/></button></div>
    <span className="badge red">{event.ongoing ? 'ONGOING' : event.leakageStatus}</span>
    <dl className="details-list">
      <dt>Date & time</dt><dd>{dateLabel(event.timestamp)} · {timeLabel(event.timestamp)}</dd>
      <dt>Flow rate</dt><dd>{number(event.flow, 1)} L/min</dd>
      <dt>Pipeline pressure</dt><dd>{number(event.pressure, 3)} bar ({event.pressureStatus})</dd>
      <dt>Flow variation</dt><dd>{number(event.flowVariation, 1)} L/min</dd>
      <dt>Inlet / outlet flow</dt><dd>{number(event.flow, 2)} / {number(event.outletFlow, 2)} L/min</dd>
      <dt>Leak condition</dt><dd>Outlet below inlet</dd>
      <dt>Acoustic status</dt><dd>{event.acousticStatus}</dd>
      <dt>Detection status</dt><dd>{event.detectionStatus}</dd>
      <dt>Duration</dt><dd>{number((event.durationSeconds || 0) / 60, 1)} min</dd>
      <dt>Estimated wastage</dt><dd>{number(event.estimatedWastage, 2)} L</dd>
      <dt>Estimated loss</dt><dd>{money(event.estimatedWastage * cost)}</dd>
    </dl>
    <button className="primary" onClick={onClose}>Close</button>
  </dialog>;
}
function CostEditor({ cost, onChange }) {
  const [draft, setDraft] = useState(String(cost));
  const [feedback, setFeedback] = useState('');
  return <form className="cost-editor" onSubmit={event => { event.preventDefault(); const next = Number(draft); if (!draft.trim() || !Number.isFinite(next) || next < 0 || next > 100000) { setFeedback('Enter a valid cost from ₹0 to ₹100,000 per liter.'); return; } onChange(next); setFeedback('Water cost updated.'); }}><label>Water cost per liter (₹)<input type="number" min="0" max="100000" step="0.001" value={draft} onChange={event => { setDraft(event.target.value); setFeedback(''); }} required/></label><button className="primary">Update cost</button><span role="status" className="muted">{feedback}</span></form>;
}
function ConditionComparison({ records }) {
  return <Card title="Normal vs Leakage Comparison" icon="bars"><div className="table-scroll"><table><thead><tr><th>Condition</th><th>Records</th><th>Average Flow</th><th>Average Pressure</th><th>Abnormal Acoustic Records</th></tr></thead><tbody>{['NORMAL', 'LEAKAGE DETECTED'].map(condition => {
    const selected = records.filter(record => record.leakageStatus === condition);
    const summary = summarize(selected, 0);
    return <tr key={condition}><td><span className={`badge ${condition === 'NORMAL' ? 'green' : 'red'}`}>{condition === 'NORMAL' ? 'Normal' : 'Leakage'}</span></td><td>{selected.length}</td><td>{selected.length ? `${number(summary.avgFlow, 1)} L/min` : '—'}</td><td>{selected.length ? `${number(summary.avgPressure, 3)} bar` : '—'}</td><td>{summary.acousticEvents}</td></tr>;
  })}</tbody></table></div></Card>;
}

function ReportsPage({ period, filterProps, totals, groups, cost, onDownload }) {
  return <Card title={`${period} Water Supply & Leakage Report`} icon="report" className="report-card" action={<button type="button" className="primary" onClick={onDownload} disabled={!groups.length}>Download CSV</button>}>
    <DateFilters {...filterProps}/>
    <UsageCards values={totals} cost={cost}/>
    {groups.length ? <div className="table-scroll"><table><thead><tr><th>Period</th><th>Supplied</th><th>Est. Consumption</th><th>Est. Wastage</th><th>Avg. Pressure</th><th>Leakage Events</th><th>Est. Loss</th></tr></thead><tbody>{groups.map(row => <tr key={row.key}><td>{row.label}</td><td>{number(row.supplied)} L</td><td>{number(row.consumed)} L</td><td>{number(row.wasted)} L</td><td>{number(row.avgPressure, 5)} bar</td><td>{row.leakageCount}</td><td>{money(row.cost)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{number(totals.supplied)} L</th><th>{number(totals.consumed)} L</th><th>{number(totals.wasted)} L</th><th>{number(totals.avgPressure, 5)} bar</th><th>{totals.leakageCount}</th><th>{money(totals.cost)}</th></tr></tfoot></table></div> : <Empty/>}
    <p className="muted small">Consumption, wastage and financial loss are estimates for the selected period.</p>
  </Card>;
}

export default function App() {
  const { data, received, loading, error, writeError, retry, clearHistory } = useMonitoring();
  const [page, setPage] = useState('overview');
  const [mobileMenu, setMobileMenu] = useState(false);
  const today = dateKey(new Date());
  const [range, setRange] = useState({ from: today, to: today });
  const [period, setPeriod] = useState('Daily');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [cost, setCost] = useState(() => {
    try { const stored = localStorage.getItem('water-cost-per-liter'); const parsed = Number(stored); return stored !== null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : 0.1; } catch { return 0.1; }
  });
  const mainRef = useRef(null);
  const switchPage = value => { setPage(value); setMobileMenu(false); mainRef.current?.scrollTo({ top: 0 }); };
  const applyRange = (from, to) => setRange({ from, to });
  const saveCost = value => { setCost(value); try { localStorage.setItem('water-cost-per-liter', String(value)); } catch { /* Cost still works for this session. */ } };
  const filteredHistory = data ? inRange(data.history, range.from, range.to) : [];
  const filteredEvents = data ? inRange(data.events, range.from, range.to).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) : [];
  const totals = summarize(filteredHistory, cost);
  const groups = aggregate(filteredHistory, period, cost);
  const chartHistory = groups.map(group => ({ ...group, label: period === 'Daily' || period === 'Weekly' ? group.key.slice(5) : group.key }));
  const historicalSeries = historicalChartSeries(filteredHistory);
  const pressureSeries = historicalChartSeries(filteredHistory.filter(record => record.pressureAvailable !== false && Number.isFinite(record.pressure)));
  const filterProps = { ...range, onApply: applyRange, period, onPeriodChange: setPeriod };
  const downloadReport = () => {
    const csv = buildReportCsv({ period, from: range.from, to: range.to, cost, groups, totals });
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `water-pipeline-report-${range.from}-to-${range.to}-${period.toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const title = navigation.find(item => item[0] === page)[1];
  const renderHistorical = (compact = false) => <Card title="Historical Analysis" icon="bars" className="historical-card" action={compact ? <button className="text-button" onClick={() => switchPage('history')}><Icon name="bars" size={18}/>Full analysis</button> : null}>
    <DateFilters {...filterProps} compact={compact}/>
    {filteredHistory.length ? <>{compact ? <><h3>Supplied / Consumed / Wasted</h3><WaterComparison {...totals}/></> : <>
      <UsageCards values={totals} cost={cost}/>
      {historicalSeries.length === 1 && <p className="muted small">Only one reading is recorded for this range. The graphs will connect readings as more data arrives.</p>}
      {filteredHistory.length > historicalSeries.length && <p className="muted small">Charts show representative readings from {filteredHistory.length} recorded readings, including flow and pressure peaks and alert points.</p>}
      <div className="two-column">
        <Card title="Flow Rate vs Time" icon="chart"><LineChart data={historicalSeries} timeScale smooth label="Historical flow"/></Card>
        <Card title="Pressure vs Time" icon="gauge"><LineChart data={pressureSeries} timeScale smooth field="pressure" color="#00a4ad" unit="bar" label="Historical pressure"/></Card>
        <Card title="Acoustic Events vs Time" icon="wave"><LineChart data={historicalSeries} timeScale field="acousticEvents" color="#f18714" label="Acoustic events" unit="Events" fill={false} max={1}/></Card>
        <Card title="Leakage Events vs Time" icon="alert"><LineChart data={historicalSeries} timeScale field="leakageCount" color="#e2183a" label="Leakage events" unit="Events" fill={false} max={1}/></Card>
        <Card title="Water Supplied per Reading" icon="drop"><LineChart data={historicalSeries} timeScale smooth field="supplied" label="Water supplied" unit="Liters"/></Card>
        <Card title="Supplied / Consumed / Wasted" icon="pie"><WaterComparison {...totals}/><p className="muted small">Estimates for the selected period</p></Card>
      </div>
      <ConditionComparison records={filteredHistory}/>
      <div className="analysis-facts"><span>Average flow <strong>{number(totals.avgFlow, 1)} L/min</strong></span><span>Minimum flow <strong>{number(totals.minFlow, 1)} L/min</strong></span><span>Maximum flow <strong>{number(totals.maxFlow, 1)} L/min</strong></span><span>Average pressure <strong>{number(totals.avgPressure, 3)} bar</strong></span><span>Pressure-drop records <strong>{totals.pressureDrops}</strong></span><span>Acoustic abnormalities <strong>{totals.acousticEvents}</strong></span><span>Leakage events <strong>{totals.leakageCount}</strong></span></div>
    </>}</> : <Empty/>}
  </Card>;

  return <div className="app-shell">
    {mobileMenu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`} aria-label="Main navigation"><div className="wordmark">WATER<span>MONITOR</span><small>Pipeline analytics</small></div><nav>{navigation.map(([key, label, icon]) => <button key={key} className={page === key ? 'nav-item active' : 'nav-item'} onClick={() => switchPage(key)} aria-current={page === key ? 'page' : undefined}><Icon name={icon} size={23}/><span>{label}</span></button>)}</nav><div className="sidebar-footer"><Icon name="drop" size={18}/><span>Water supply monitoring</span></div></aside>
    <main ref={mainRef} className="main-content"><header className="topbar"><div className="topbar-title"><button className="icon-button menu-button" onClick={() => setMobileMenu(value => !value)} aria-label="Toggle navigation" aria-expanded={mobileMenu}><Icon name="menu"/></button><div><h1>{page === 'overview' ? 'Water Pipeline Monitoring' : title}</h1><p>Artificial pipeline prototype</p></div></div><div className="connection-status"><Status label={data?.connectivity?.cloud && !error ? 'Firebase connected' : 'Firebase disconnected'} active={Boolean(data?.connectivity?.cloud && !error)}/><Status label={data?.connectivity?.lastUpdate ? `Last update ${timeLabel(data.connectivity.lastUpdate)}` : 'No update yet'} active={Boolean(data?.connectivity?.lastUpdate)}/><span className="badge blue">Live data</span></div></header>
      {error && <div className="api-error" role="alert"><Icon name="alert"/><div><strong>Firebase connection unavailable</strong><p>{error}{data ? ' Showing the last received readings.' : ''}</p></div><button onClick={retry}>Retry</button></div>}
      {writeError && <div className="api-error" role="alert"><Icon name="alert"/><div><strong>LED and buzzer not updated</strong><p>{writeError}</p></div></div>}
      {loading && !data && <div className="loading-state"><div className="loading-ring"/><p>Loading pipeline readings…</p></div>}
      {received && !data && <Empty>No data found at /{PIPELINE_PATH} in Firebase. The dashboard updates automatically when the device writes readings.</Empty>}
      {data && <div className="page-content">
        {page === 'overview' && <>
          <LeakageBanner current={data.current}/><SensorCards current={data.current}/><UsageCards values={data.current} cost={cost}/>
          <div className="two-column"><Card title="Inlet Flow vs Time" icon="chart"><LineChart data={data.series} highlight label="Live inlet flow rate"/></Card><Card title="Water Flow per Second vs Time" icon="gauge"><LineChart data={data.series} field="flowPerSecond" color="#00a4ad" unit="L/s" highlight label="Live inlet flow per second"/></Card></div>
          <AcousticStrip series={data.series}/>
        </>}
        {page === 'sensors' && <>
          <LeakageBanner current={data.current}/><SensorCards current={data.current}/>
          <div className="two-column">
            <Card title="Flow Rate vs Time" icon="chart"><LineChart data={data.series} highlight label="Live flow"/></Card>
            <Card title="Water Flow per Second vs Time" icon="gauge"><LineChart data={data.series} field="flowPerSecond" color="#00a4ad" unit="L/s" highlight label="Live inlet flow per second"/></Card>
            <Card title="Flow Variation vs Time" icon="bars"><LineChart data={data.series} field="flowVariation" color="#6b5bd6" highlight label="Live flow variation"/></Card>
            <Card title="Acoustic Status vs Time" icon="wave"><LineChart data={data.series} field="acoustic" color="#f18714" max={1} unit="0 Normal · 1 Abnormal" label="Acoustic status"/></Card>
            <Card title="Sensor & Classification Details" icon="connection"><dl className="details-list">
              <dt>Last reading</dt><dd>{dateLabel(data.current.timestamp)} · {timeLabel(data.current.timestamp)}</dd>
              <dt>Inlet flow per second</dt><dd>{number(data.current.flowPerSecond, 3)} L/s (from {number(data.current.flow, 1)} L/min)</dd>
              <dt>Inlet / outlet flow</dt><dd>{number(data.current.flow, 2)} / {number(data.current.outletFlow, 2)} L/min</dd>
              <dt>Leak condition</dt><dd className={isLeak(data.current) ? 'red-text' : ''}>Outlet below inlet</dd>
              <dt>Abnormal flow during leakage</dt><dd>{number(data.current.abnormalFlow, 2)} L/min</dd>
              <dt>Acoustic RMS / peak-to-peak</dt><dd>{number(data.current.acousticRms, 2)} / {number(data.current.acousticPeak)}</dd>
              <dt>Detection status</dt><dd className={isLeak(data.current) ? 'red-text' : 'teal-text'}>{data.current.detectionStatus}</dd>
              <dt>Expected LED / Buzzer</dt><dd>{data.current.detectionStatus === 'WAITING FOR OUTLET FLOW DATA' ? 'Waiting / Waiting' : isLeak(data.current) ? 'On / On' : 'Off / Off'}</dd>
              <dt>Firebase LED / Buzzer</dt><dd>{data.current.ledActive ? 'On' : 'Off'} / {data.current.buzzerActive ? 'On' : 'Off'}</dd>
              <dt>Source</dt><dd>/{PIPELINE_PATH}</dd>
            </dl></Card>
          </div>
          <AcousticStrip series={data.series}/>
        </>}
        {page === 'history' && renderHistorical()}
        {page === 'leaks' && <><Card title="Leakage Event History" icon="alert"><DateFilters {...filterProps} onPeriodChange={null}/><div className="analysis-facts"><span>Recorded events <strong>{filteredEvents.length}</strong></span><span>Leakage duration <strong>{number(filteredEvents.reduce((sum, event) => sum + (event.durationSeconds || 0), 0) / 60, 1)} min</strong></span><span>Estimated wastage <strong>{number(filteredEvents.reduce((sum, event) => sum + (event.estimatedWastage || 0), 0), 2)} L</strong></span></div><EventsTable events={filteredEvents} onSelect={setSelectedEvent}/></Card></>}
        {page === 'usage' && <><Card title="Water Usage & Cost" icon="drop"><DateFilters {...filterProps}/><CostEditor cost={cost} onChange={saveCost}/></Card><UsageCards values={totals} cost={cost}/><div className="two-column"><Card title="Supplied / Consumed / Wasted" icon="pie">{filteredHistory.length ? <WaterComparison {...totals}/> : <Empty/>}</Card><Card title="Water-Loss Cost Calculation" icon="coins"><div className="cost-equation"><span>{number(totals.wasted)} L <small>Estimated wastage</small></span><b>×</b><span>{money(cost)} / L <small>Configured water cost</small></span><b>=</b><strong>{money(totals.cost)} <small>Estimated loss</small></strong></div></Card><Card title="Estimated Consumption vs Time" icon="chart"><LineChart data={chartHistory} field="consumed" unit="Liters" color="#09a6b3" label="Estimated consumption"/></Card><Card title="Estimated Wastage vs Time" icon="alert"><LineChart data={chartHistory} field="wasted" unit="Liters" color="#f18714" label="Estimated wastage"/></Card></div></>}
        {page === 'reports' && <ReportsPage period={period} filterProps={filterProps} totals={totals} groups={groups} cost={cost} onDownload={downloadReport}/>}
        {page === 'log' && <><Card title="Recording Status" icon="clock"><dl className="details-list"><dt>Firebase path</dt><dd>{pipelineUrl}</dd><dt>Connection</dt><dd>{data.connectivity.cloud && !error ? 'Connected' : 'Disconnected'}</dd><dt>Last update received</dt><dd>{data.connectivity.lastUpdate ? `${dateLabel(data.connectivity.lastUpdate)} · ${timeLabel(data.connectivity.lastUpdate)}` : '—'}</dd><dt>Recorded readings</dt><dd>{data.logs.length}</dd><dt>Stored information</dt><dd>Readings received while this dashboard is open, saved in this browser for history and reports</dd></dl><button className="text-button" onClick={() => { if (window.confirm('Clear all readings recorded in this browser?')) clearHistory(); }}>Clear recorded history</button></Card><Card title="Recorded Readings" icon="report"><DateFilters {...filterProps} onPeriodChange={null}/>{inRange(data.logs, range.from, range.to).length ? <div className="table-scroll"><table><thead><tr><th>Date & Time</th><th>Flow (in / out)</th><th>Pressure</th><th>Flow Variation</th><th>Abnormal Flow</th><th>Acoustic (RMS / P-P)</th><th>Detection</th><th>Total Supplied</th><th>Supplied (interval)</th><th>Est. Wastage</th><th>LED</th><th>Buzzer</th></tr></thead><tbody>{inRange(data.logs, range.from, range.to).map((record, i) => <tr key={`${record.timestamp}-${i}`}><td>{dateLabel(record.timestamp)}<small className="table-subtext">{timeLabel(record.timestamp)}</small></td><td>{number(record.flow, 2)} / {number(record.outletFlow, 2)} L/min</td><td className={record.pressureStatus === 'Normal' ? '' : 'red-text'}>{number(record.pressure, 3)} bar</td><td>{number(record.flowVariation, 2)} L/min</td><td>{number(record.abnormalFlow, 2)} L/min</td><td>{number(record.acousticRms, 2)} / {number(record.acousticPeak)}</td><td><span className={`badge ${isLeak(record) ? 'red' : 'green'}`}>{record.detectionStatus}</span></td><td>{number(record.totalSupplied, 2)} L</td><td>{number(record.supplied, 2)} L</td><td>{number(record.wasted, 2)} L</td><td>{record.ledActive ? 'On' : 'Off'}</td><td>{record.buzzerActive ? 'On' : 'Off'}</td></tr>)}</tbody></table></div> : <Empty/>}</Card></>}
      </div>}
    </main>
    {selectedEvent && <EventDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} cost={cost}/>}
  </div>;
}
