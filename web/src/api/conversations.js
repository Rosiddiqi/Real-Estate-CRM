// Inbox conversation endpoints (/api/conversations).
import { api } from './client';

export const listConversations = (params) => api.get('/conversations', params);
export const getConversation = (id) => api.get(`/conversations/${id}`);
export const conversationByClient = (clientId, { create = false } = {}) =>
  api.get(`/conversations/by-client/${clientId}`, create ? { create: 1 } : undefined);
export const resolveConversation = (body) => api.post('/conversations/resolve', body);
export const patchConversation = (id, patch) => api.patch(`/conversations/${id}`, patch);
export const markConversationRead = (id) => api.post(`/conversations/${id}/read`, {});
export const deleteConversation = (id) => api.del(`/conversations/${id}`);
export const searchInbox = (q, opts) => api.get('/conversations/search', { q }, opts);
export const getInboxAiCard = () => api.get('/conversations/ai-card');
export const getBriefing = (id) => api.get(`/conversations/${id}/briefing`);
export const sendTyping = (id, isTyping) => api.post(`/conversations/${id}/typing`, { isTyping });
