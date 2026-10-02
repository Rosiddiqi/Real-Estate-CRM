// The ONE HTTP client. Every API module goes through `api.*`.
//
// - Access token lives in memory + localStorage (km_at) so reloads are instant.
// - On a 401 the client refreshes ONCE (single-flight, shared by concurrent
//   requests) via the httpOnly refresh cookie — or the stored refresh token on
//   native shells — then retries the original request.
// - A failed refresh emits `auth:logout` (useAuth listens and shows Login).
const AT_KEY = 'km_at';
const BASE_KEY = 'km_api_base';

// API origin. Same-origin ('') for the web/PWA; native (TestFlight) builds bake
// VITE_API_URL, and a tester can override it at runtime (stored in km_api_base).
export function getApiBase() {
  let override = null;
  try { override = localStorage.getItem(BASE_KEY); } catch { /* ignore */ }
  return (override || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
}
export function setApiBase(url) {
  let v = String(url || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`; // bare host → https
  try {
    if (v) localStorage.setItem(BASE_KEY, v);
    else localStorage.removeItem(BASE_KEY);
  } catch { /* ignore */ }
}
const RT_KEY = 'km_rt';

let accessToken = safeGet(AT_KEY);
let refreshPromise = null;
const listeners = new Set();

function safeGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage full/blocked */ }
}

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const NETWORK_MSG = 'Can’t reach KeyMatch — check your connection.';

// fetch() that turns transport failures (offline, DNS, TLS, server down) into
// ApiError(0) so callers can tell "no network" from "not allowed".
async function netFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(0, NETWORK_MSG, { network: true });
  }
}

// No response at all, or the server/proxy is down (502/503/504 while restarting).
export function isNetworkError(err) {
  return !!err && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504);
}

// Is there any stored credential worth retrying with?
export function hasStoredSession() {
  return !!(safeGet(AT_KEY) || safeGet(RT_KEY));
}

export function getAccessToken() {
  return accessToken;
}

export function setTokens({ accessToken: at, refreshToken: rt } = {}) {
  if (at !== undefined) { accessToken = at; safeSet(AT_KEY, at); }
  if (rt !== undefined) safeSet(RT_KEY, rt);
  for (const fn of listeners) { try { fn(accessToken); } catch { /* ignore */ } }
}

export function clearTokens() {
  accessToken = null;
  safeSet(AT_KEY, null);
  safeSet(RT_KEY, null);
  for (const fn of listeners) { try { fn(null); } catch { /* ignore */ } }
}

export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await netFetch(`${getApiBase()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: safeGet(RT_KEY) || undefined }),
      });
      if (!res.ok) throw new ApiError(res.status, 'Session expired');
      const data = await res.json();
      setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data;
    } finally {
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();
  return refreshPromise;
}

function buildUrl(path, params) {
  const url = path.startsWith('http') ? path : `${getApiBase()}/api${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes('?') ? '&' : '?'}${s}` : url;
}

async function request(method, path, { params, body, headers, signal, raw, retry = true } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await netFetch(buildUrl(path, params), {
    method,
    credentials: 'include',
    signal,
    headers: {
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
    } catch (err) {
      // Only a rejected refresh token ends the session; a dropped connection
      // mid-refresh must not sign the user out of the app.
      if (isNetworkError(err)) throw err;
      clearTokens();
      window.dispatchEvent(new CustomEvent('auth:logout'));
      throw new ApiError(401, 'Session expired');
    }
    return request(method, path, { params, body, headers, signal, raw, retry: false });
  }

  if (raw) return res;
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

export const api = {
  get: (path, params, opts) => request('GET', path, { ...opts, params }),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, body, opts) => request('DELETE', path, { ...opts, body }),
  upload: (path, formData, opts) => request('POST', path, { ...opts, body: formData }),
  url: buildUrl,
};

// Absolute URL for an uploaded file / media path returned by the API.
export function mediaUrl(u) {
  if (!u) return u;
  if (/^(https?:|data:|blob:)/.test(u)) return u;
  return `${getApiBase()}${u.startsWith('/') ? '' : '/'}${u}`;
}

export default api;
