// Clients API — list/detail/CRUD, notes, household links, activity feed,
// AI summary + briefing, waitlists and importer.
import { api } from './client';

// ── Clients ──────────────────────────────────────────────────────────────
export const listClients = (params) => api.get('/clients', params);
export const getClient = (id) => api.get(`/clients/${id}`);
export const createClient = (data) => api.post('/clients', data);
export const updateClient = (id, patch) => api.patch(`/clients/${id}`, patch);
export const deleteClient = (id) => api.del(`/clients/${id}`);
export const restoreClient = (id) => api.post(`/clients/${id}/restore`, {});
export const blockClient = (id) => api.post(`/clients/${id}/block`, {});
export const unblockClient = (id) => api.post(`/clients/${id}/unblock`, {});
export const lookupClient = (params) => api.get('/clients/lookup', params);
export const clientFacets = () => api.get('/clients/facets');
export const clientActivity = (id, params) => api.get(`/clients/${id}/activity`, params);
export const clientSummary = (id) => api.post(`/clients/${id}/summary`, {});
export const clientBriefing = (id, refresh = false) => api.get(`/clients/${id}/briefing`, refresh ? { refresh: 1 } : undefined);

// ── Notes ────────────────────────────────────────────────────────────────
export const listNotes = (clientId) => api.get(`/clients/${clientId}/notes`);
export const addNote = (clientId, body, pinned = false) => api.post(`/clients/${clientId}/notes`, { body, pinned });
export const updateNote = (clientId, noteId, patch) => api.patch(`/clients/${clientId}/notes/${noteId}`, patch);
export const deleteNote = (clientId, noteId) => api.del(`/clients/${clientId}/notes/${noteId}`);

// ── Household links ──────────────────────────────────────────────────────
export const listLinks = (clientId) => api.get(`/clients/${clientId}/links`);
export const addLink = (clientId, { relatedClientId, relation, notes }) => api.post(`/clients/${clientId}/links`, { relatedClientId, relation, notes });
export const deleteLink = (clientId, linkId) => api.del(`/clients/${clientId}/links/${linkId}`);

// ── Waitlists ────────────────────────────────────────────────────────────
export const listWaitlists = () => api.get('/waitlists');
export const getWaitlist = (id) => api.get(`/waitlists/${id}`);
export const createWaitlist = (data) => api.post('/waitlists', data);
export const updateWaitlist = (id, patch) => api.patch(`/waitlists/${id}`, patch);
export const deleteWaitlist = (id) => api.del(`/waitlists/${id}`);
export const addWaitlistEntry = (id, data) => api.post(`/waitlists/${id}/entries`, data);
export const updateWaitlistEntry = (id, entryId, patch) => api.patch(`/waitlists/${id}/entries/${entryId}`, patch);
export const removeWaitlistEntry = (id, entryId) => api.del(`/waitlists/${id}/entries/${entryId}`);
export const reorderWaitlist = (id, entryIds) => api.put(`/waitlists/${id}/order`, { entryIds });
export const clientWaitlists = (clientId) => api.get(`/waitlists/client/${clientId}`);

// ── Import ───────────────────────────────────────────────────────────────
export const analyzeImport = (data) => api.post('/import/analyze', data);
export const executeImport = (data) => api.post('/import/execute', data);
export const listImports = () => api.get('/import/jobs');

// ── Cross-team (guarded by callers) ──────────────────────────────────────
export const clientAppointments = (clientId) => api.get('/appointments', { clientId, limit: 100 });
export const clientDeals = (clientId) => api.get('/deals', { clientId });
export const clientTasks = (clientId) => api.get('/tasks', { clientId });
export const clientMatches = (clientId) => api.get(`/matchmaker/client/${clientId}`);
