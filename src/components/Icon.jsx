import React from 'react';

const paths = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
  chart: <><path d="M4 3v17h17M7 14l4-4 4 2 6-7"/><path d="M17 5h4v4"/></>,
  bars: <><path d="M4 13h3v8H4zM10 7h3v14h-3zM16 3h3v18h-3z"/></>,
  alert: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
  drop: <path d="M12 2C9 7 4 12 4 16a8 8 0 0 0 16 0c0-4-5-9-8-14Z"/>,
  report: <><path d="M6 2h9l4 4v16H6zM14 2v5h5M9 11h7M9 15h7M9 18h5"/></>,
  pie: <><path d="M10 3a9 9 0 1 0 11 11h-11V3Z"/><path d="M14 2v8h8a9 9 0 0 0-8-8Z"/></>,
  cloud: <path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Z"/>,
  gauge: <><path d="M3 18a10 10 0 1 1 18 0M12 13l5-5M5 10l2 1M12 4v3M19 10l-2 1"/><circle cx="12" cy="13" r="2"/></>,
  wave: <path d="M2 12h4l3-9 4 18 3-12 2 3h4"/>,
  gear: <><path d="m9 3 1 2h4l1-2 3 2-1 2 2 3h2v4h-2l-2 3 1 2-3 2-1-2h-4l-1 2-3-2 1-2-2-3H3v-4h2l2-3-1-2 3-2Z"/><circle cx="12" cy="12" r="3"/></>,
  coins: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v5c0 4 16 4 16 0V5M4 10v5c0 4 16 4 16 0v-5M4 15v4c0 4 16 4 16 0v-4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  chevron: <path d="m8 4 8 8-8 8"/>,
  check: <path d="m4 12 5 5L20 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  connection: <><path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/></>,
};
export default function Icon({ name, size = 20, className = '' }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.chart}</svg>;
}
