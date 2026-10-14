import React, { useId, useState } from 'react';
import { number } from '../lib/analytics.mjs';
import Icon from './Icon.jsx';

export function LineChart({ data = [], field = 'flow', color = '#087dff', unit = 'L/min', label = 'Flow rate', max, fill = true, highlight = false, timeScale = false, smooth = false }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const w = 620, h = 255, left = 48, right = 15, top = 20, bottom = 38;
  const chartW = w - left - right, chartH = h - top - bottom;
  const values = data.map(point => Number(point[field]) || 0);
  const highest = Math.max(...values, 0);
  const ceiling = max ?? (highest <= 1 ? Math.max(.1, Math.ceil(highest * 11.5) / 10) : Math.ceil(highest * 1.15));
  const times = timeScale ? data.map(point => Date.parse(point.timestamp)) : [];
  const useTimeScale = times.length > 1 && times.every(Number.isFinite) && times[times.length - 1] > times[0];
  const x = i => left + (data.length <= 1 ? chartW / 2 : useTimeScale ? (times[i] - times[0]) * chartW / (times[times.length - 1] - times[0]) : i * chartW / (data.length - 1));
  const hitStart = i => i ? (x(i - 1) + x(i)) / 2 : left;
  const hitEnd = i => i < data.length - 1 ? (x(i) + x(i + 1)) / 2 : w - right;
  const y = value => top + chartH * (1 - value / ceiling);
  const points = values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
  const linePath = values.length ? `M ${x(0)} ${y(values[0])}${values.slice(1).map((value, offset) => {
    const i = offset + 1;
    const step = (x(i) - x(i - 1)) / 3;
    return ` C ${x(i - 1) + step} ${y(values[i - 1])}, ${x(i) - step} ${y(value)}, ${x(i)} ${y(value)}`;
  }).join('')}` : '';
  const ticks = [...new Set(Array.from({ length: Math.min(5, data.length) }, (_, i) => Math.round(i * (data.length - 1) / Math.max(1, Math.min(5, data.length) - 1))))];
  const leakIndex = data.findIndex(point => point.leakage);
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} chart with ${data.length} records`} onMouseLeave={() => setHover(null)}>
      <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".12"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={left} y1={y(ceiling * i / 4)} x2={w - right} y2={y(ceiling * i / 4)} stroke="#e4ebf4"/><text x={left - 8} y={y(ceiling * i / 4) + 4} textAnchor="end" className="axis-label">{number(ceiling * i / 4, ceiling <= 1 ? 2 : ceiling <= 2 ? 1 : 0)}</text></g>)}
      {ticks.map(i => <g key={i}><line x1={x(i)} y1={top} x2={x(i)} y2={h - bottom} stroke="#e4ebf4"/><text x={x(i)} y={h - 16} textAnchor={i === 0 && data.length > 1 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="axis-label">{data[i].tickLabel || data[i].label || String(i + 1)}</text></g>)}
      <text x={left} y="11" className="axis-label">{unit}</text>
      {highlight && leakIndex >= 0 && <g><rect x={x(leakIndex)} y={top} width={Math.max(2, w - right - x(leakIndex))} height={chartH} fill="#fff0f1"/><line x1={x(leakIndex)} y1={top} x2={x(leakIndex)} y2={h - bottom} stroke="#ffaeb6" strokeDasharray="5 5"/><text x={Math.min(x(leakIndex) + 8, w - 74)} y={top + 18} fill="#da1635" fontSize="13" fontWeight="600">Leakage</text></g>}
      {data.length > 1 && fill && (smooth ? <path d={`${linePath} L ${x(data.length - 1)} ${h - bottom} L ${x(0)} ${h - bottom} Z`} fill={`url(#${uid})`}/> : <polygon points={`${x(0)},${h - bottom} ${points} ${x(data.length - 1)},${h - bottom}`} fill={`url(#${uid})`}/>)}
      {data.length > 1 && (smooth ? <path d={linePath} fill="none" stroke={color} strokeWidth="2.7" strokeLinecap="round"/> : <polyline points={points} fill="none" stroke={color} strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round"/>)}
      {data.length === 1 && <circle cx={x(0)} cy={y(values[0])} r="5" fill={color}/>}
      {data.map((point, i) => <rect key={i} x={hitStart(i)} y={top} width={Math.max(1, hitEnd(i) - hitStart(i))} height={chartH} fill="transparent" tabIndex="0" aria-label={`${point.label || i + 1}: ${number(values[i], 2)} ${unit}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}/>)}
      {hover !== null && data[hover] && <g pointerEvents="none"><line x1={x(hover)} y1={top} x2={x(hover)} y2={h - bottom} stroke={color} strokeDasharray="3 4"/><circle cx={x(hover)} cy={y(values[hover])} r="5" fill={color} stroke="white" strokeWidth="2"/></g>}
    </svg>
    {hover !== null && data[hover] && <div className="chart-tooltip">{data[hover].label}: <strong>{number(values[hover], 2)} {unit}</strong></div>}
    {!data.length && <div className="chart-empty">No records for this period</div>}
  </div>;
}

export function WaterComparison({ supplied = 0, consumed = 0, wasted = 0 }) {
  const max = Math.max(supplied, consumed, wasted, 1);
  return <div className="water-comparison">{[
    ['Supplied', supplied, 'blue'], ['Consumed', consumed, 'teal'], ['Wasted', wasted, 'orange'],
  ].map(([label, value, color]) => <div className="comparison-row" key={label}><span>{label}</span><div className="bar-track"><div className={`bar-fill ${color}`} style={{ width: `${value / max * 100}%` }}/></div><strong>{number(value)} L</strong></div>)}</div>;
}

export function AcousticStrip({ series = [] }) {
  return <div className="acoustic-strip"><div className="acoustic-heading"><Icon name="wave" size={23} className="blue-text"/><strong>Acoustic Status</strong><span className="muted">(Sound / Vibration Pattern)</span></div><div className="acoustic-timeline"><div className="acoustic-blocks" role="img" aria-label="Acoustic timeline from normal to abnormal">{series.map((point, i) => <span key={i} style={{ background: point.acoustic ? '#e9183b' : `hsl(211 100% ${81 + i % 8}%)` }} title={`${point.label}: ${point.acoustic ? 'Abnormal' : 'Normal'}`}/>)}</div><div className="acoustic-labels"><span>Normal</span><span>Abnormal</span></div></div></div>;
}
