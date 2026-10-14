import { applyStreamEvent } from './pipeline.mjs';

export const firebaseConfig = {
  apiKey: 'AIzaSyAr4IYnykpwovqOJWzfBd7abVdAma_Ig3Q',
  authDomain: 'diet-planner-3bdf3.firebaseapp.com',
  databaseURL: 'https://diet-planner-3bdf3-default-rtdb.firebaseio.com',
  projectId: 'diet-planner-3bdf3',
  storageBucket: 'diet-planner-3bdf3.firebasestorage.app',
  messagingSenderId: '927878354911',
  appId: '1:927878354911:web:2e616b171a267b9910566a',
  measurementId: 'G-MSYWCM58MT',
};
export const PIPELINE_PATH = 'water_pipeline';
export const pipelineUrl = `${firebaseConfig.databaseURL}/${PIPELINE_PATH}`;

// Sets the LED, buzzer and detection status in one multi-path update.
export async function writeAlertState(leaking) {
  const state = leaking ? 1 : 0;
  const response = await fetch(`${pipelineUrl}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'led/state': state, 'buzzer/state': state, 'detection/status': leaking ? 'LEAKAGE DETECTED' : 'NORMAL' }),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? `Firebase denied write access to /${PIPELINE_PATH}. Allow writes to led, buzzer and detection in the Realtime Database rules.`
      : `Unable to update the LED and buzzer in Firebase (${response.status}).`);
  }
}

// Listens to a Realtime Database path through the REST streaming API (server-sent events).
export function subscribe({ onData, onOpen, onError }) {
  const source = new EventSource(`${pipelineUrl}.json`);
  let value = null;
  const handle = type => event => {
    try {
      value = applyStreamEvent(value, type, JSON.parse(event.data));
      onData(value);
    } catch { /* Ignore malformed stream messages. */ }
  };
  const refuse = message => () => { source.close(); onError(message, true); };
  source.addEventListener('put', handle('put'));
  source.addEventListener('patch', handle('patch'));
  source.addEventListener('cancel', refuse(`Firebase denied read access to /${PIPELINE_PATH}. Check the Realtime Database rules.`));
  source.addEventListener('auth_revoked', refuse('Firebase revoked access to the monitoring data.'));
  source.onopen = onOpen;
  source.onerror = () => onError(source.readyState === EventSource.CLOSED
    ? 'Unable to connect to Firebase.'
    : 'Connection to Firebase lost. Reconnecting…', source.readyState === EventSource.CLOSED);
  return () => source.close();
}
