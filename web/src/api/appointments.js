// Appointments API (dashboard builder).
import { api } from './client';

export const getAppointments = (params) => api.get('/appointments', params);
export const getUpcomingAppointments = (params) => api.get('/appointments/upcoming', params);
export const getAppointment = (id) => api.get(`/appointments/${id}`);
export const createAppointment = (body) => api.post('/appointments', body);
export const updateAppointment = (id, patch) => api.patch(`/appointments/${id}`, patch);
export const deleteAppointment = (id) => api.del(`/appointments/${id}`);
export const getAppointmentBriefing = (id, refresh = false) => api.get(`/appointments/${id}/briefing`, refresh ? { refresh: 1 } : undefined);
export const logAppointmentOutcome = (id, { outcome, feedback }) => api.post(`/appointments/${id}/outcome`, { outcome, feedback });
export const getWorkSchedule = () => api.get('/work-schedule');
export const saveWorkSchedule = (body) => api.put('/work-schedule', body);
export const setScheduleOverride = (date, body) => api.put(`/work-schedule/override/${date}`, body);
export const clearScheduleOverride = (date) => api.del(`/work-schedule/override/${date}`);
