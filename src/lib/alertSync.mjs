import { alertStateMatches, desiredAlertState } from './pipeline.mjs';

export const ALERT_RETRY_MS = 2000;
export const ALERT_ERROR_RETRY_MS = 5000;
export const ALERT_REWRITE_MS = 500;

// Keep the Firebase alert fields aligned with the latest outlet reading, including
// when the device writes older LED/buzzer values after this dashboard's PATCH.
export function createAlertSync({ write, onError = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let raw = null;
  let inFlight = false;
  let retryTimer = null;
  let lastAttemptAt = -Infinity;
  let lastAttemptLeaking = null;
  let retryDelay = ALERT_RETRY_MS;
  let confirmedSinceLastWrite = false;
  let disposed = false;

  const cancelRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  };
  const queueRetry = delay => {
    if (retryTimer !== null || disposed) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      reconcile();
    }, delay);
  };

  function reconcile() {
    if (disposed) return;
    const desired = desiredAlertState(raw);
    if (!desired) {
      cancelRetry();
      return;
    }
    if (alertStateMatches(raw, desired)) {
      cancelRetry();
      confirmedSinceLastWrite = true;
      onError('');
      return;
    }
    if (inFlight) return;

    const remaining = desired.leaking === lastAttemptLeaking
      ? Math.max(0, lastAttemptAt + (confirmedSinceLastWrite ? ALERT_REWRITE_MS : retryDelay) - now())
      : 0;
    if (remaining > 0) {
      queueRetry(remaining);
      return;
    }

    cancelRetry();
    inFlight = true;
    lastAttemptAt = now();
    lastAttemptLeaking = desired.leaking;
    confirmedSinceLastWrite = false;
    Promise.resolve()
      .then(() => write(desired.leaking))
      .then(() => { retryDelay = ALERT_RETRY_MS; })
      .catch(error => {
        retryDelay = ALERT_ERROR_RETRY_MS;
        onError(error?.message || 'Unable to update the Firebase alert fields.');
      })
      .finally(() => {
        inFlight = false;
        reconcile();
      });
  }

  return {
    update(value) {
      raw = value;
      reconcile();
    },
    dispose() {
      disposed = true;
      cancelRetry();
    },
  };
}
