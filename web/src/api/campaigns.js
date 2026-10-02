// Campaigns + Automations API wrappers (/api/campaigns).
import { api } from './client';

export const listCampaigns = () => api.get('/campaigns');
export const getCampaign = (id) => api.get(`/campaigns/${id}`);
export const createCampaign = (body) => api.post('/campaigns', body);
export const updateCampaign = (id, patch) => api.patch(`/campaigns/${id}`, patch);
export const deleteCampaign = (id) => api.del(`/campaigns/${id}`);
export const sampleDrafts = (id, body = {}) => api.post(`/campaigns/${id}/samples`, body);
export const planLaunch = (id, body = {}) => api.post(`/campaigns/${id}/plan`, body);
export const launchCampaign = (id, body = {}) => api.post(`/campaigns/${id}/launch`, body);
export const pauseCampaign = (id) => api.post(`/campaigns/${id}/pause`, {});
export const resumeCampaign = (id) => api.post(`/campaigns/${id}/resume`, {});
export const stopCampaign = (id) => api.post(`/campaigns/${id}/stop`, {});
export const duplicateCampaign = (id) => api.post(`/campaigns/${id}/duplicate`, {});
export const getInvite = (id) => api.get(`/campaigns/${id}/invite`);
export const setRecipientLane = (id, rid, lane) => api.patch(`/campaigns/${id}/recipients/${rid}/lane`, { lane });
export const muteRecipient = (id, rid, muted) => api.post(`/campaigns/${id}/recipients/${rid}/mute`, { muted });

export const getTemplates = () => api.get('/campaigns/templates');
export const getSenderGuard = () => api.get('/campaigns/sender-guard');
export const getAiPause = () => api.get('/campaigns/ai-pause');
export const setAiPause = (paused) => api.put('/campaigns/ai-pause', { paused });

export const audienceOptions = () => api.get('/campaigns/audience/options');
export const previewAudience = (audience, limit) => api.post('/campaigns/audience/preview', { audience, limit });
export const resolveAudienceText = (text) => api.post('/campaigns/audience/resolve', { text });
export const parseLane = (text, lane, hasEvent) => api.post('/campaigns/parse-lane', { text, lane, hasEvent });

export const listAutomations = () => api.get('/campaigns/automations');
export const updateAutomation = (id, patch) => api.patch(`/campaigns/automations/${id}`, patch);
export const runAutomations = () => api.post('/campaigns/automations/run', {});
export const liveThreads = () => api.get('/campaigns/live-threads');

export const listSuggestions = (campaignId) => api.get('/campaigns/suggestions', campaignId ? { campaignId } : undefined);
export const approveSuggestion = (id, text) => api.post(`/campaigns/suggestions/${id}/approve`, text != null ? { text } : {});
export const dismissSuggestion = (id) => api.post(`/campaigns/suggestions/${id}/dismiss`, {});

export const searchListings = (params) => api.get('/listings', params);
