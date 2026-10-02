// KeypadSheet — iOS dial pad in a floating sheet (RevMatch KeypadSheet):
// live-formatted number, contact suggestions as you type (recents + book),
// big green call button, backspace (long-press clears). In-call it becomes a
// DTMF pad (no call button).
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { api } from '../../api/client';
import { formatPhone, formatPhoneInput } from '../../lib/format';
import { haptic } from '../../lib/native';

const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];

export default function KeypadSheet({ open, onClose, onDial, recents = [], mode = 'dial', title }) {
  const [digits, setDigits] = useState('');
  const [book, setBook] = useState([]);
  const hold = useRef(null);

  useEffect(() => { if (open) setDigits(''); }, [open]);

  const plain = digits.replace(/\D/g, '');
  useEffect(() => {
    if (mode !== 'dial' || plain.length < 3) { setBook([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/clients', { search: plain, limit: 4 }).then((r) => setBook(r.clients || [])).catch(() => setBook([]));
    }, 180);
    return () => clearTimeout(t);
  }, [plain, mode]);

  const matches = useMemo(() => {
    if (mode !== 'dial' || plain.length < 3) return [];
    const out = new Map();
    for (const c of recents) {
      const n = String(c.otherNumber || '').replace(/\D/g, '');
      if (n && n.includes(plain)) out.set(c.clientId || n, { clientId: c.clientId, name: c.client ? c.client.name : null, phone: c.otherNumber });
    }
    for (const c of book) {
      const n = String(c.phone || '').replace(/\D/g, '');
      if (n && n.includes(plain)) out.set(c.id, { clientId: c.id, name: c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' '), phone: c.phone });
    }
    return [...out.values()].slice(0, 3);
  }, [plain, recents, book, mode]);

  const press = (k) => {
    haptic('selection');
    setDigits((d) => (d.replace(/\D/g, '').length >= 15 ? d : d + k));
  };
  const back = () => setDigits((d) => d.slice(0, -1));
  const exact = matches.find((m) => String(m.phone || '').replace(/\D/g, '').slice(-10) === plain.slice(-10) && plain.length >= 10);

  return (
    <Sheet open={open} onClose={onClose} title={title || (mode === 'dtmf' ? 'Keypad' : 'Keypad')} left={false} right={{ label: 'Done', onClick: onClose }}>
      <div className="km-kp-display">{formatPhoneInput(digits) || <span style={{ color: 'var(--faint)' }}>{mode === 'dtmf' ? 'Tones' : 'Enter a number'}</span>}</div>
      <div className="km-kp-match">
        {exact ? <><Icon name="userCheck" size={14} stroke={2} />{exact.name}</> : mode === 'dial' && plain.length >= 4 && !matches.length ? <span style={{ color: 'var(--faint)' }}>No matching client</span> : null}
      </div>
      {mode === 'dial' && matches.length && !exact ? (
        <div className="km-kp-suggest">
          {matches.map((m) => (
            <button key={m.clientId || m.phone} type="button" className="km-press" onClick={() => setDigits(String(m.phone || '').replace(/\D/g, '').slice(-10))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', borderRadius: 12, textAlign: 'left' }}>
              <Avatar name={m.name} seed={m.clientId || m.phone} size={30} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{m.name || formatPhone(m.phone)}</span>
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>{formatPhone(m.phone)}</span>
              </span>
              <Icon name="arrowUpRight" size={14} color="var(--faint)" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="km-kp-grid">
        {KEYS.map(([k, letters]) => (
          <button key={k} type="button" className="km-kp-key" onClick={() => press(k)} aria-label={k}>
            <span className="km-kp-digit">{k}</span>
            <span className="km-kp-letters">{letters}</span>
          </button>
        ))}
      </div>
      <div className="km-kp-actions">
        <span />
        {mode === 'dial' ? (
          <button type="button" className="km-kp-call" disabled={plain.length < 7} aria-label="Call"
            onClick={() => { haptic('medium'); onDial({ phone: plain, clientId: exact ? exact.clientId : undefined, name: exact ? exact.name : undefined }); }}>
            <Icon name="phone" size={30} stroke={1.8} />
          </button>
        ) : <span />}
        {digits ? (
          <button type="button" aria-label="Delete" onClick={back}
            onPointerDown={() => { hold.current = setTimeout(() => setDigits(''), 600); }}
            onPointerUp={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)}
            style={{ width: 76, height: 76, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>
            <Icon name="arrowLeft" size={26} stroke={1.8} />
          </button>
        ) : <span />}
      </div>
    </Sheet>
  );
}
