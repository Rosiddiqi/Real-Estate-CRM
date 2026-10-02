// Per-workspace messaging mode (server: services/messaging/mode.js), read from
// GET /api/bridge → { messaging: { mode: 'demo'|'twilio'|'device', … } }.
// 'device' = no business line: each send returns an sms: URL that opens the
// phone's Messages app with the text prefilled ("Sent from your phone").
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ws } from '../../api/ws';

let info = null;
let fetchedAt = 0;
let inflight = null;
const listeners = new Set();

export function loadMessagingMode(force = false) {
  if (!force && info && Date.now() - fetchedAt < 120_000) return Promise.resolve(info);
  if (inflight) return inflight;
  inflight = api.get('/bridge')
    .then((r) => {
      info = (r && r.messaging) || { mode: r && r.provider === 'twilio' ? 'twilio' : 'demo' };
      fetchedAt = Date.now();
      for (const fn of listeners) fn(info);
      return info;
    })
    .catch(() => info)
    .finally(() => { inflight = null; });
  return inflight;
}

export const getMessagingMode = () => (info ? info.mode : null);

export function useMessagingMode() {
  const [mode, setMode] = useState(getMessagingMode());
  useEffect(() => {
    const fn = (i) => setMode(i ? i.mode : null);
    listeners.add(fn);
    loadMessagingMode();
    return () => { listeners.delete(fn); };
  }, []);
  return mode;
}

if (typeof window !== 'undefined') ws.on('resync', () => { if (info) loadMessagingMode(true); });

// Open the phone's Messages app with the text prefilled (Capacitor iOS hands
// sms: navigations to the system; Safari asks to open Messages).
export function openSmsHandoff(url) {
  if (!url) return;
  try { window.location.href = url; } catch { /* ignore */ }
}
