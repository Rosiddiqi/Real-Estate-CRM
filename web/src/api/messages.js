// Thread endpoints (/api/messages).
import { api } from './client';

export const listMessages = (conversationId, { before, limit, timeline = true } = {}) =>
  api.get('/messages', { conversationId, before, limit, timeline: timeline ? undefined : 0 });
export const sendMessage = (body) => api.post('/messages/send', body);
export const retryMessage = (id) => api.post(`/messages/${id}/retry`, {});
export const deleteMessage = (id) => api.del(`/messages/${id}`);
export const reactToMessage = (id, type, emoji) => api.post(`/messages/${id}/reactions`, { type, emoji });
export const removeReaction = (id) => api.del(`/messages/${id}/reactions`);

export const listScheduled = (conversationId) => api.get('/messages/scheduled', { conversationId });
export const updateScheduled = (id, patch) => api.patch(`/messages/scheduled/${id}`, patch);
export const cancelScheduled = (id) => api.del(`/messages/scheduled/${id}`);
export const sendScheduledNow = (id) => api.post(`/messages/scheduled/${id}/send-now`, {});

export const getLinkPreview = (url) => api.post('/messages/link-preview', { url });
export const getReplySuggestions = (conversationId, refresh = false) => api.post('/messages/suggestions', { conversationId, refresh });
export const sendSuggestionFeedback = (body) => api.post('/messages/suggestions/feedback', body);
export const getThreadSummary = (conversationId, refresh = false) => api.post('/messages/summary', { conversationId, refresh });
export const draftText = (body) => api.post('/messages/draft', body);
