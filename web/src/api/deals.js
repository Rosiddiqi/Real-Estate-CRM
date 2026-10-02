// Deals REST client (pipeline builder). Every call returns the server's
// normalized deal shape (server/src/services/pipeline/normalize.js).
import { api } from './client';

export const getStages = () => api.get('/pipeline/stages');
export const getBoardSummary = () => api.get('/pipeline/summary');

// listDeals({ board:1 }) · ({ clientId, open:1 }) · ({ stage:'under_contract,active' }) …
export const listDeals = (params = {}) => api.get('/deals', params);
export const getDeal = (id) => api.get(`/deals/${id}`);
export const createDeal = (body) => api.post('/deals', body);
export const patchDeal = (id, patch) => api.patch(`/deals/${id}`, patch);
export const deleteDeal = (id) => api.del(`/deals/${id}`);
export const moveDeal = (id, body) => api.post(`/deals/${id}/move`, body);
export const closeDeal = (id, body = {}) => api.post(`/deals/${id}/close`, body);
export const markLost = (id, body) => api.post(`/deals/${id}/lost`, body);
export const reopenDeal = (id, body = {}) => api.post(`/deals/${id}/reopen`, body);
export const patchDealClient = (id, body) => api.patch(`/deals/${id}/client`, body);

// Book of Business
export const getBookLedger = () => api.get('/book');
export const getBookClients = (params = {}) => api.get('/book/clients', params);
