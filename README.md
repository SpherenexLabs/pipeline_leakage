# ks5679 — React water pipeline dashboard

A React web application based on the supplied dashboard image. The visible application is titled **Water Pipeline Monitoring**. It contains no company name or quotation reference numbers.

## Start the application

Use Node.js **20.19+** or **22.12+** and npm.

1. Extract this ZIP.
2. Open a terminal inside the `ks5679` folder.
3. Run:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** in your browser. The dashboard connects directly to Firebase and shows live values. No login or extra configuration is needed.

## Data source

The dashboard reads the Firebase Realtime Database path below and updates as soon as the device writes new values:

```
https://diet-planner-3bdf3-default-rtdb.firebaseio.com/water_pipeline
```

| Firebase field | Shown as |
| --- | --- |
| `flow_sensor/flow_rate_lpm` | Inlet flow rate (L/min), also displayed as liters per second by dividing by 60 |
| `flow_sensor/flow_variation_lpm` | Flow variation (L/min) |
| `flow_sensor/abnormal_flow_during_leakage_lpm` | Abnormal flow (shown in live values) |
| `flow_sensor/total_water_supplied_liters` | Water supplied (L) |
| `flow_sensor_2/flow_rate_lpm`, `total_water_outlet_liters` | Raw outlet flow; the flow rate controls leakage detection |
| `flow_comparison/inlet_minus_outlet_lpm`, `estimated_leakage_lpm` | Device-reported comparison values, shown in the data log but not used for the alert |
| `pressure_sensor/pressure`, `raw_pressure` | Live Pressure Sensor card in bar, plus historical analysis and leakage event records. The value comes directly from the sensor and is not calculated from inlet flow. Shown as *Reduced* when below 90% of the average pressure recorded during NORMAL readings |
| `acoustic_sensor/acoustic_rms`, `peak_to_peak`, ADC values | Acoustic status: *Abnormal* when peak-to-peak exceeds 1.5× the average recorded during NORMAL readings |
| `flow_sensor_2/flow_rate_lpm` | **Leakage detection:** when the outlet flow is below the inlet flow (`flow_sensor/flow_rate_lpm`) it is `LEAKAGE DETECTED`. When the inlet flow is less than or equal to the outlet flow it is `NORMAL`. If the outlet reading is missing or invalid, the dashboard waits and does not write an alert |
| `led/state`, `buzzer/state`, `detection/status` | **Written by the dashboard:** set to 1, 1, `LEAKAGE DETECTED` during leakage and 0, 0, `NORMAL` otherwise. Requires write access to these paths in the Realtime Database rules |

The Firebase configuration is in `src/lib/firebase.js`. The database rules must allow public read access to `/water_pipeline`.

The leakage rule is `desiredAlertState` in `src/lib/pipeline.mjs`. The pressure-drop threshold and acoustic threshold are `PRESSURE_DROP_RATIO` and `ACOUSTIC_RISE_RATIO` in `src/lib/pipeline.mjs`.

While the dashboard is open, it compares the observed Firebase LED, buzzer and detection fields with the outlet-based decision. It writes any mismatch again if another writer resets those fields. A device that continuously writes conflicting LED or buzzer values can still override the browser between retries; its firmware should leave these alert fields to the dashboard or use the same inlet/outlet comparison.

Firebase only stores the latest values. To provide graphs, history, leakage events and reports, the dashboard records each reading it receives (and one reading per minute while open) in the browser's local storage. History therefore covers only periods when the dashboard was open in that browser. Previously saved readings are reclassified against the current outlet threshold when loaded. The Data Log page lists these readings and has a button to clear them.

## Pages

- Overview: Firebase connection, leakage status, inlet flow in L/min and L/s, live pressure and acoustic readings, LED/buzzer state, water totals, cost estimates, and live graphs.
- Live Sensor Graphs: inlet flow in L/min and L/s, pressure sensor card, flow-variation and acoustic trends.
- Historical Analysis: date filters, time-based curves drawn from individual recorded readings, plus daily/weekly/monthly/yearly summaries. A line needs at least two recorded readings; long ranges are sampled while retaining peaks and alert points.
- Leakage History: leakage events with duration and estimated wastage.
- Water Usage & Cost: supplied/consumed/wasted comparison and a configurable cost per liter.
- Reports: period summaries for the selected date range, including average sensor pressure, with a Download CSV button.
- Data Log: recorded readings and recording status.

## Build and verify

```bash
npm test
npm run build
npm run preview
```

`dist/` is also included as a prebuilt production bundle. Serve it through an HTTP server; do not open `dist/index.html` using `file://`.

## Data conventions

- Flow is L/min; water quantities are liters; cost is rupees per liter.
- Supply per interval is the change in `total_water_supplied_liters` between readings. A counter reset is treated as a new count.
- Estimated wastage uses the positive difference between inlet and raw outlet flow during detected leakage. A low outlet value can trigger an alert even when that difference is zero. Estimated consumption is supplied minus estimated wastage.
- Gaps longer than three minutes between readings (dashboard closed) are not counted as leakage time.

## Project structure

```text
src/App.jsx                 Pages, navigation and controls
src/styles.css              Responsive dashboard styling
src/components/             Reusable charts and icons
src/lib/analytics.mjs        Date filtering, aggregation and cost calculation
src/lib/firebase.js         Firebase configuration and live stream
src/lib/pipeline.mjs         Firebase field mapping, history and leakage events
src/lib/data.js             Monitoring hook and browser-recorded readings
tests/analytics.test.mjs     Meaningful calculation and contract checks
```

There are no remote font, icon or chart dependencies. The local DejaVu Sans font and its license are included under `public/fonts/`. All charts and icons render locally as SVG. Package versions are pinned in `package-lock.json`.
