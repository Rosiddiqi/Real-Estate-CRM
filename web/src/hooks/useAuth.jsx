// Auth state for the whole app.
//   const { user, workspace, status, login, logout, refreshMe, updateUser } = useAuth();
// status: 'loading' | 'authed' | 'anon' | 'offline'
//   'offline' = a stored session exists but the server can't be reached yet;
//   the shell shows a reconnect screen and calls retry() (never a sign-out).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearTokens, getAccessToken, hasStoredSession, isNetworkError, refreshSession, setTokens } from '../api/client';
import { ws } from '../api/ws';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, workspace: null });

  const loadMe = useCallback(async () => {
    const me = await api.get('/me');
    setState({ status: 'authed', user: me.user, workspace: me.workspace });
    ws.connect();
    return me;
  }, []);

  // Restore the session: refresh if needed, then load the profile. Transport
  // failures with a stored session land in 'offline' (retryable), not 'anon'.
  const boot = useCallback(async (isCancelled = () => false) => {
    try {
      if (!getAccessToken()) await refreshSession();
      if (!isCancelled()) await loadMe();
    } catch (err) {
      if (isCancelled()) return;
      if (isNetworkError(err) && hasStoredSession()) setState({ status: 'offline', user: null, workspace: null });
      else setState({ status: 'anon', user: null, workspace: null });
    }
  }, [loadMe]);

  useEffect(() => {
    let cancelled = false;
    boot(() => cancelled);
    const onLogout = () => setState({ status: 'anon', user: null, workspace: null });
    window.addEventListener('auth:logout', onLogout);
    return () => { cancelled = true; window.removeEventListener('auth:logout', onLogout); };
  }, [boot]);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return loadMe();
  }, [loadMe]);

  const demoLogin = useCallback(async () => {
    const data = await api.post('/auth/demo', {});
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return loadMe();
  }, [loadMe]);

  const register = useCallback(async (payload) => {
    const data = await api.post('/auth/register', payload);
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    clearTokens();
    ws.disconnect();
    setState({ status: 'anon', user: null, workspace: null });
  }, []);

  const updateUser = useCallback((patch) => {
    setState((s) => ({ ...s, user: s.user ? { ...s.user, ...patch } : s.user }));
  }, []);

  const updateWorkspace = useCallback((patch) => {
    setState((s) => ({ ...s, workspace: s.workspace ? { ...s.workspace, ...patch } : s.workspace }));
  }, []);

  const value = useMemo(() => ({
    ...state,
    login,
    demoLogin,
    register,
    logout,
    refreshMe: loadMe,
    retry: boot,
    updateUser,
    updateWorkspace,
  }), [state, login, demoLogin, register, logout, loadMe, boot, updateUser, updateWorkspace]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default useAuth;
