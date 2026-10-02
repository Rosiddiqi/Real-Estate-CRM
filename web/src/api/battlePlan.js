// Battle Plan API (dashboard builder).
import { api } from './client';

export const getBattlePlan = (date) => api.get('/battle-plan', date ? { date } : undefined);
export const getTodoBoard = () => api.get('/battle-plan/todo');
export const replan = (date) => api.post('/battle-plan/replan', date ? { date } : {});
// action: done | dismiss | skip | retime | reopen ; id: moveId | appt-<id> | task-<id>
export const planItemAction = (id, action, body = {}) => api.post(`/battle-plan/items/${encodeURIComponent(id)}/${action}`, body);
export const retimeItem = (id, startMin, durationMin) => planItemAction(id, 'retime', { startMin, durationMin });
export const sendMoveFeedback = ({ moveId, isCorrect, reasons, note, mute, kind, feedback }) =>
  api.post('/battle-plan/feedback', { moveId, isCorrect: !!isCorrect, reasons, note, mute, kind, feedback });
export const coachClient = ({ clientId, note, moveId }) => api.post('/battle-plan/coach', { clientId, note, moveId });
export const getSuppressions = () => api.get('/battle-plan/suppressions');
export const suppressClient = ({ clientId, reason, durationDays = null }) => api.post('/battle-plan/suppress', { clientId, reason, durationDays });
export const unsuppressClient = (clientId) => api.del(`/battle-plan/suppress/${clientId}`);
export const getSelfRules = () => api.get('/battle-plan/self-rules');
export const addSelfRule = (text) => api.post('/battle-plan/self-rules', { text });
export const removeSelfRule = (id) => api.del(`/battle-plan/self-rules/${id}`);
