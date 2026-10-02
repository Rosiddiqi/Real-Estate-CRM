// Portfolio API — client properties (owns · rents · sold · watching) and the
// Wishlist (BuyerSearch), plus listing-link / describe-it parsing.
import { api } from './client';

export const listProperties = (params) => api.get('/portfolio/properties', params);
export const getProperty = (id) => api.get(`/portfolio/properties/${id}`);
export const createProperty = (data) => api.post('/portfolio/properties', data);
export const updateProperty = (id, patch) => api.patch(`/portfolio/properties/${id}`, patch);
export const deleteProperty = (id) => api.del(`/portfolio/properties/${id}`);
export const propertyBuyers = (id) => api.get(`/portfolio/properties/${id}/buyers`);

export const listSearches = (params) => api.get('/portfolio/searches', params);
export const getSearch = (id) => api.get(`/portfolio/searches/${id}`);
export const createSearch = (data) => api.post('/portfolio/searches', data);
export const updateSearch = (id, patch) => api.patch(`/portfolio/searches/${id}`, patch);
export const deleteSearch = (id) => api.del(`/portfolio/searches/${id}`);

export const parseCapture = ({ text, url, target = 'auto' }) => api.post('/portfolio/parse', { text, url, target });
export const portfolioSuggestions = () => api.get('/portfolio/suggestions');

// Listings builder's per-client matches (guarded by callers).
export const clientMatches = (clientId) => api.get(`/matchmaker/client/${clientId}`);
