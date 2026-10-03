// Sign in / create account / one-tap demo.
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button, TextInput } from '../../components/ui/kit';
import { BrandMark, Wordmark } from '../../components/ui/BrandMark';
import { BRAND } from '../../brand';
import { getApiBase, setApiBase } from '../../api/client';
import { isNative } from '../../lib/native';

export default function Login() {
  const { login, demoLogin, register } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', brokerageName: '' });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Public server info: whether the demo book is offered, and (on native)
  // whether the configured server is reachable at all.
  const [server, setServer] = useState({ checked: false, reachable: true, demoLogin: true });
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    fetch(`${getApiBase()}/api/health`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h) => { if (alive) setServer({ checked: true, reachable: true, demoLogin: h.demoLogin !== false }); })
      .catch(() => { if (alive) setServer({ checked: true, reachable: false, demoLogin: true }); })
      .finally(() => clearTimeout(t));
    return () => { alive = false; ctl.abort(); clearTimeout(t); };
  }, []);

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
      <form
        onSubmit={submit}
        style={{
          position: 'relative', maxWidth: 440, minHeight: '100%', margin: '0 auto',
          padding: 'calc(var(--safe-top) + 44px) 36px calc(var(--safe-bottom) + 28px)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--faint)' }}>
          <BrandMark size={30} />
          <Wordmark size={26} color="var(--faint)" style={{ letterSpacing: '0.14em', marginRight: 0 }} />
        </div>

        <h1 className="km-login-title">
          {mode === 'signin' ? <>Every client,<br />the right home.</> : <>Start your<br />book.</>}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--faint)', marginTop: 14 }}>{BRAND.tagline}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 44 }}>
          {mode === 'register' ? (
            <div className="km-field-row">
              <TextInput label="First name" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" required />
              <TextInput label="Last name" value={form.lastName} onChange={set('lastName')} autoComplete="family-name" />
            </div>
          ) : null}
          <TextInput label="Email" type="email" placeholder="you@brokerage.com" value={form.email} onChange={set('email')} autoComplete="email" required />
          <TextInput label="Password" type="password" placeholder="••••••••" value={form.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />
          {mode === 'register' ? (
            <TextInput label="Brokerage (optional)" value={form.brokerageName} onChange={set('brokerageName')} />
          ) : null}
        </div>
        {error ? <div style={{ color: 'var(--red)', fontSize: 13.5, marginTop: 16 }}>{error}</div> : null}

        <div style={{ flex: 1, minHeight: 44 }} />

        <Button type="submit" size="lg" block loading={busy === 'submit'}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
        {server.demoLogin ? (
          <Button variant="ghost" size="lg" block onClick={demo} loading={busy === 'demo'} style={{ marginTop: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--hl)' }} />
            Explore the demo book
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); }}
          style={{ color: 'var(--dim)', fontSize: 13.5, marginTop: 18, padding: '6px 0' }}
        >
          {mode === 'signin' ? <>New here? <u style={{ textUnderlineOffset: 3 }}>Create an account</u></> : <>Have an account? <u style={{ textUnderlineOffset: 3 }}>Sign in</u></>}
        </button>
        {isNative() ? <div style={{ marginTop: 10, textAlign: 'center' }}><ServerAddress unreachable={server.checked && !server.reachable} /></div> : null}
      </form>
    </div>
  );
}

// Native builds talk to an absolute server URL (baked in at build time). Testers
// can point the app at another KeyMatch server here.
function ServerAddress({ unreachable }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(getApiBase());
  const current = getApiBase();
  return editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <input className="km-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://keymatch.yourdomain.com" autoCapitalize="none" autoCorrect="off" inputMode="url" />
      <Button variant="ghost" onClick={() => { setApiBase(value.trim()); setEditing(false); window.location.reload(); }}>Save</Button>
    </div>
  ) : (
    <button type="button" onClick={() => setEditing(true)} style={{ color: unreachable ? 'var(--amber)' : 'var(--faint)', fontSize: 12.5 }}>
      {unreachable ? 'Can’t reach ' : 'Server: '}{current ? current.replace(/^https?:\/\//, '') : 'not set'} · Change
    </button>
  );
}
