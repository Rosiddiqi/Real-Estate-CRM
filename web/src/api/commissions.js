// Commissions + pay plan REST client (pipeline builder).
import { api } from './client';

export const getCommissionSummary = () => api.get('/commissions/summary');
export const getPayPlan = () => api.get('/commissions/pay-plan');
export const savePayPlan = (plan) => api.put('/commissions/pay-plan', plan);
// ICA → draft terms (never saved by the server; the sheet shows them for review).
export const parseIca = ({ text, url }) => api.post('/commissions/pay-plan/parse', { text, url });
