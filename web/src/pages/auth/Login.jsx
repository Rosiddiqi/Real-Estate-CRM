// Sign in / create account / one-tap demo.
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button, TextInput } from '../../components/ui/kit';
import Icon from '../../components/ui/Icon';
import { BRAND } from '../../brand';

export default function Login() {
  const { login, demoLogin, register } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', brokerageName: '' });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy('submit');
    try {
      if (mode === 'signin') await login(form.email, form.password);
      else await register(form);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setError('');
    setBusy('demo');
    try { await demoLogin(); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  return (
    <div className="km-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }}>
      <div className="km-login-hero" aria-hidden="true" />
      <div style={{ position: 'relative', maxWidth: 420, margin: '0 auto', padding: 'calc(var(--safe-top) + 72px) 24px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg, var(--bright), var(--deep))', boxShadow: '0 18px 40px -12px var(--glow), inset 0 1px 0 rgba(255,255,255,0.3)' }}>
            <Icon name="key" size={30} color="#fff" stroke={2} />
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{BRAND.name}</div>
            <div style={{ fontSize: 15, color: 'var(--dim)', marginTop: 6 }}>{BRAND.tagline}</div>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' ? (
            <div className="km-field-row">
              <TextInput placeholder="First name" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" required />
              <TextInput placeholder="Last name" value={form.lastName} onChange={set('lastName')} autoComplete="family-name" />
            </div>
          ) : null}
          <TextInput type="email" placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" required />
          <TextInput type="password" placeholder="Password" value={form.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />
          {mode === 'register' ? (
            <TextInput placeholder="Brokerage (optional)" value={form.brokerageName} onChange={set('brokerageName')} />
          ) : null}
          {error ? <div style={{ color: 'var(--red)', fontSize: 13.5, textAlign: 'center' }}>{error}</div> : null}
          <Button type="submit" size="lg" block loading={busy === 'submit'}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--faint)', fontSize: 12 }}>
          <div className="km-divider" style={{ flex: 1 }} /> OR <div className="km-divider" style={{ flex: 1 }} />
        </div>

        <Button variant="ghost" size="lg" block icon="sparkle" onClick={demo} loading={busy === 'demo'}>
          Explore the demo book
        </Button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); }}
          style={{ color: 'var(--bright)', fontSize: 14.5, fontWeight: 500 }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
