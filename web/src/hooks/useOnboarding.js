// Onboarding state (server-derived). Refreshes when the app reports progress.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSocket } from './useSocket';

export function useOnboarding(enabled) {
  const [state, setState] = useState(null);
  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve(null);
    return api.get('/onboarding').then((s) => { setState(s); return s; }).catch(() => null);
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh]);
  useSocket(['client_updated', 'message_sent', 'deal_created', 'activity_created'], () => {
    if (state && !state.complete && !state.grandfathered) refresh();
  });
  const act = useCallback((action) => api.post(`/onboarding/${action}`, {}).then(setState).catch(() => {}), []);
  return { state, refresh, act };
}
