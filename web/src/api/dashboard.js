// Dashboard stats API (dashboard builder). Money prefers the pipeline builder's
// /commissions/summary when it exists; /dashboard/stats always carries a
// Deal-row computation as the fallback.
import { api } from './client';

export const getDashboardStats = () => api.get('/dashboard/stats');
export const getCommissionSummary = () => api.get('/commissions/summary');
