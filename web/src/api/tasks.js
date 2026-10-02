// Tasks / to-dos API (dashboard builder).
import { api } from './client';

export const getTasks = (params) => api.get('/tasks', params);
export const createTask = (body) => api.post('/tasks', body);
export const updateTask = (id, patch) => api.patch(`/tasks/${id}`, patch);
export const completeTask = (id) => api.patch(`/tasks/${id}`, { status: 'done' });
export const deleteTask = (id) => api.del(`/tasks/${id}`);
