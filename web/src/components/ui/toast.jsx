// Toasts + confirm dialogs — global, callable from anywhere.
//   import { toast, confirm } from '../ui/toast';
//   toast('Showing booked');  toast.error('Couldn’t send');
//   toast('Deal moved to Under Contract', { action: { label: 'Undo', onClick } });
//   if (await confirm({ title: 'Delete client?', message: '…', confirmLabel: 'Delete', destructive: true })) …
// <Toaster /> and <ConfirmHost /> are mounted once by AppShell.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const subs = new Set();
let seq = 0;

export function toast(message, opts = {}) {
  const t = { id: ++seq, message, type: opts.type || 'info', action: opts.action, duration: opts.duration ?? (opts.action ? 5000 : 2600) };
  subs.forEach((fn) => fn({ kind: 'add', toast: t }));
  return t.id;
}
toast.success = (m, o) => toast(m, { ...o, type: 'success' });
toast.error = (m, o) => toast(m, { ...o, type: 'error' });
toast.dismiss = (id) => subs.forEach((fn) => fn({ kind: 'remove', id }));

const ICONS = { success: ['checkCircle', 'var(--hl-ink)'], error: ['alert', 'var(--red)'], info: ['sparkle', 'var(--text)'] };

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (ev) => {
      if (ev.kind === 'add') {
        setItems((xs) => [...xs.slice(-2), ev.toast]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== ev.toast.id)), ev.toast.duration);
      } else if (ev.kind === 'remove') {
        setItems((xs) => xs.filter((x) => x.id !== ev.id));
      }
    };
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return createPortal(
    <div className="km-toast-wrap" aria-live="polite">
      {items.map((t) => {
        const [icon, color] = ICONS[t.type] || ICONS.info;
        return (
          <div key={t.id} className="km-toast km-lg km-lg--menu">
            <Icon name={icon} size={17} color={color} stroke={1.8} />
            <span style={{ flex: 1 }}>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => { t.action.onClick?.(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}
                style={{ color: 'var(--hl-ink)', fontWeight: 500, fontSize: 13.5 }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// ── confirm() — iOS action-sheet style ───────────────────────────────────
const confirmSubs = new Set();
export function confirm(opts) {
  return new Promise((resolve) => {
    confirmSubs.forEach((fn) => fn({ ...opts, resolve }));
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const fn = (r) => { setLeaving(false); setReq(r); };
    confirmSubs.add(fn);
    return () => confirmSubs.delete(fn);
  }, []);
  if (!req) return null;
  const done = (v) => {
    setLeaving(true);
    setTimeout(() => { req.resolve(v); setReq(null); }, 200);
  };
  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--scrim)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center',
        padding: '0 8px calc(var(--safe-bottom) + 12px)',
        animation: leaving ? 'km-fade-out-soft 0.2s ease forwards' : 'km-dim-in 0.2s ease both',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 8, animation: leaving ? 'km-sheet-out 0.2s var(--km-ease) forwards' : 'km-sheet-in 0.36s var(--km-spring) both' }}>
        <div className="km-lg km-lg--menu" style={{ borderRadius: 16, overflow: 'hidden' }}>
          {(req.title || req.message) ? (
            <div style={{ padding: '14px 18px', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
              {req.title ? <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--dim)' }}>{req.title}</div> : null}
              {req.message ? <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 4 }}>{req.message}</div> : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => done(true)}
            style={{ width: '100%', height: 56, fontSize: 18, fontWeight: 500, color: req.destructive ? 'var(--red)' : 'var(--bright)' }}
          >
            {req.confirmLabel || 'Confirm'}
          </button>
        </div>
        <button
          type="button"
          className="km-lg km-lg--menu"
          onClick={() => done(false)}
          style={{ width: '100%', height: 56, borderRadius: 16, fontSize: 18, fontWeight: 600, color: 'var(--bright)' }}
        >
          {req.cancelLabel || 'Cancel'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
