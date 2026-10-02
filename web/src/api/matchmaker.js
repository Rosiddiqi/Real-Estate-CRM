// Matchmaker endpoints (owner: listings builder). Server: routes/matchmaker.js
import { api } from './client';

export const getFeed = (mode, params) => api.get('/matchmaker/feed', { mode, ...params });
export const getPeople = (params) => api.get('/matchmaker/people', params);
export const getHotMatches = (params) => api.get('/matchmaker/hot', params);
export const getRecentMatches = (params) => api.get('/matchmaker/recent', params);
export const getClientMatches = (clientId, params) => api.get(`/matchmaker/client/${clientId}`, params);
export const getListingBuyers = (id, params) => api.get(`/matchmaker/listing/${id}/buyers`, params);
export const getWhispers = () => api.get('/matchmaker/whispers');
export const addWhisper = (body) => api.post('/matchmaker/whispers', body);
export const draftMatchText = (body) => api.post('/matchmaker/draft', body);
export const sendMatchFeedback = (body) => api.post('/matchmaker/feedback', body);
export const rescoreMatches = () => api.post('/matchmaker/rescore', {});
