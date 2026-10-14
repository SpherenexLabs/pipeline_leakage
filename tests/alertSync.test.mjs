import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_ERROR_RETRY_MS, ALERT_RETRY_MS, ALERT_REWRITE_MS, createAlertSync } from '../src/lib/alertSync.mjs';

// A fixed 1.5 L/min inlet: outlets below it are leakage, outlets at or above it are NORMAL.
const reading = (outlet, state, status) => ({
  flow_sensor: { flow_rate_lpm: 1.5 },
  flow_sensor_2: { flow_rate_lpm: outlet },
  led: { state },
  buzzer: { state },
  detection: { status },
});

function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  const flush = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };
  return {
    now: () => time,
    setTimer: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    flush,
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        time = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = target;
      await flush();
    },
  };
}

test('alert sync reapplies 1 after device overwrites a confirmed leakage alert with 0', async () => {
  const clock = fakeClock();
  const writes = [];
  const sync = createAlertSync({ ...clock, write: async leaking => { writes.push(leaking); } });
  sync.update(reading(0, 0, 'NORMAL'));
  await clock.flush();
  assert.deepEqual(writes, [true]);

  sync.update(reading(0, 1, 'LEAKAGE DETECTED'));
  await clock.advance(100);
  sync.update(reading(0, 0, 'NORMAL'));
  await clock.advance(ALERT_REWRITE_MS - 101);
  assert.deepEqual(writes, [true]);
  await clock.advance(1);
  assert.deepEqual(writes, [true, true]);

  sync.update(reading(2, 1, 'LEAKAGE DETECTED'));
  await clock.flush();
  assert.deepEqual(writes, [true, true, false]);
  sync.dispose();
});

test('alert sync retries when Firebase never confirms the LED, buzzer and status', async () => {
  const clock = fakeClock();
  const writes = [];
  const sync = createAlertSync({ ...clock, write: async leaking => { writes.push(leaking); } });
  sync.update(reading(.2, 0, 'NORMAL'));
  await clock.flush();
  await clock.advance(ALERT_RETRY_MS - 1);
  assert.deepEqual(writes, [true]);
  await clock.advance(1);
  assert.deepEqual(writes, [true, true]);
  sync.update(reading(.2, 1, 'LEAKAGE DETECTED'));
  await clock.advance(ALERT_RETRY_MS);
  assert.deepEqual(writes, [true, true]);
  sync.dispose();
});

test('a changed outlet reading is written after the earlier alert request completes', async () => {
  const clock = fakeClock();
  const writes = [];
  let finishFirstWrite;
  const firstWrite = new Promise(resolve => { finishFirstWrite = resolve; });
  const sync = createAlertSync({ ...clock, write: leaking => {
    writes.push(leaking);
    return leaking ? firstWrite : Promise.resolve();
  } });
  sync.update(reading(0, 0, 'NORMAL'));
  await clock.flush();
  sync.update(reading(2, 1, 'LEAKAGE DETECTED'));
  assert.deepEqual(writes, [true]);
  finishFirstWrite();
  await clock.flush();
  assert.deepEqual(writes, [true, false]);
  sync.dispose();
});

test('alert sync reports write failures and retries after a delay', async () => {
  const clock = fakeClock();
  const errors = [];
  let attempts = 0;
  const sync = createAlertSync({ ...clock,
    write: async () => { if (++attempts === 1) throw new Error('Firebase denied write access'); },
    onError: message => errors.push(message),
  });
  sync.update(reading(0, 0, 'NORMAL'));
  await clock.flush();
  assert.equal(errors.at(-1), 'Firebase denied write access');
  await clock.advance(ALERT_ERROR_RETRY_MS);
  assert.equal(attempts, 2);
  sync.update(reading(0, 1, 'LEAKAGE DETECTED'));
  assert.equal(errors.at(-1), '');
  sync.dispose();
});
