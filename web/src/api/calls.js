// Phone + calls API.
import { api } from './client';

export const listCalls = (params) => api.get('/calls', params);
export const getCall = (id) => api.get(`/calls/${id}`);
export const getActiveCall = () => api.get('/calls/active');
export const getCallMode = () => api.get('/calls/mode');
export const callSuggestions = (params) => api.get('/calls/suggestions', params);
export const dial = ({ clientId, phone }) => api.post('/calls/dial', { clientId: clientId || null, phone: phone || null });
export const hangup = (id, body = {}) => api.post(`/calls/${id}/hangup`, body);
// Device mode (the agent's own phone placed it): { outcome: talked|voicemail|no_answer, durationSec, notes }
export const logDeviceCall = (id, { outcome, durationSec, notes }) => api.post(`/calls/${id}/log`, { outcome, durationSec: durationSec ?? null, notes: notes || null });
export const setHold = (id, held) => api.post(`/calls/${id}/hold`, { held });
export const addCallNote = (id, { t, text }) => api.post(`/calls/${id}/notes`, { t, text });
export const markHeard = (id) => api.post(`/calls/${id}/heard`, {});
export const regenerateRecap = (id) => api.post(`/calls/${id}/recap`, {});
export const decideSuggestion = (id, sid, body) => api.post(`/calls/${id}/suggestions/${sid}`, body);
export const undoCallAction = (undoToken) => api.post('/calls/undo', { undoToken });
export const logCall = (body) => api.post('/calls', body);
