// Cross-cutting API helpers (badges, search, notifications, uploads, profile).
import { api } from './client';

export const getBadges = () => api.get('/badges');
export const markSeen = (kind) => api.post('/badges/seen', { kind });
export const globalSearch = (q, limit) => api.get('/search', { q, limit });
export const getNotifications = (params) => api.get('/notifications', params);
export const readNotification = (id) => api.post(`/notifications/${id}/read`, {});
export const readAllNotifications = () => api.post('/notifications/read-all', {});
export const getWorkspace = () => api.get('/workspace');
export const updateWorkspace = (patch) => api.patch('/workspace', patch);
export const updateMe = (patch) => api.patch('/me', patch);

// Upload one or more File/Blob objects → [{url, mimeType, size, fileName, kind}]
export async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of [].concat(files)) fd.append('files', f, f.name || 'upload');
  const r = await api.upload('/media/upload', fd);
  return r.files || [];
}

// Tell the shell to refresh badge counts soon (debounced).
export const bumpBadges = () => window.dispatchEvent(new CustomEvent('km:badges'));
