// Listings endpoints (owner: listings builder). Server: routes/listings.js
import { api, getApiBase } from './client';

export const listListings = (params) => api.get('/listings', params);
export const getListing = (id) => api.get(`/listings/${id}`);
export const createListing = (body) => api.post('/listings', body);
export const updateListing = (id, patch) => api.patch(`/listings/${id}`, patch);
export const setListingStatus = (id, body) => api.post(`/listings/${id}/status`, body);
export const addListingPhotos = (id, body) => api.post(`/listings/${id}/photos`, body);
export const shareListing = (id) => api.post(`/listings/${id}/share`, {});
export const deleteListing = (id) => api.del(`/listings/${id}`);
export const listSources = () => api.get('/listings/sources');
export const createSource = (body) => api.post('/listings/sources', body);
export const parseListingText = (body) => api.post('/listings/parse', body);

// Private showcase page — always the SERVER origin (native builds run from
// capacitor://localhost, so location.origin alone would be wrong there).
export const showcaseUrl = (slug) => (slug ? `${getApiBase() || window.location.origin}/api/public/p/${slug}` : null);
