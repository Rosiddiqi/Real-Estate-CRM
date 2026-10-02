// ClientPicker — pick a client from a searchable sheet (owned by the clients
// builder; every surface that needs "choose a client" uses this).
//   <ClientPicker open={open} onClose={() => setOpen(false)} onPick={(client) => …}
//                 kind="client" title="Choose client" />
// Optional: exclude={[ids]} (hide), disabled={{ [id]: 'already #2 in line' }} (show greyed),
//           allowCreate (default true) → "+ New client “Ana Ruiz”" creates and picks.
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { SkeletonRows, EmptyState, Spinner, Stars } from '../ui/kit';
import { toast } from '../ui/toast';
import { api } from '../../api/client';
import { fullName, formatPhone } from '../../lib/format';
import { clientStore } from './clientStore';

const TYPE_LABEL = { buyer: 'Buyer', seller: 'Seller', buyer_seller: 'Buyer & seller', investor: 'Investor', renter: 'Renter', landlord: 'Landlord', developer: 'Developer', sphere: 'Sphere' };

function subLine(c) {
  const role = c.contactKind === 'client' || !c.contactKind ? TYPE_LABEL[c.type] : (c.vendorRole ? c.vendorRole.replace(/_/g, ' ') : c.contactKind);
  return [role ? role.charAt(0).toUpperCase() + role.slice(1) : null, c.neighborhood || c.company, formatPhone(c.phone)].filter(Boolean).join(' · ');
}

export default function ClientPicker({ open, onClose, onPick, kind, title = 'Choose a client', exclude, disabled, allowCreate = true }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const picked = useRef(false);

  useEffect(() => {
    if (!open) { setQ(''); setRows(null); picked.current = false; return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api.get('/clients', { search: q || undefined, kind, limit: q ? 40 : 30, sort: q ? 'az' : 'recent' })
        .then((r) => { if (alive) { clientStore.seedMany(r.clients || []); setRows(r.clients || []); } })
        .catch(() => { if (alive) setRows([]); });
    }, q ? 180 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, kind]);

  const excludeSet = useMemo(() => new Set(exclude || []), [exclude]);
  const visible = useMemo(() => (rows || []).filter((c) => !excludeSet.has(c.id)), [rows, excludeSet]);

  const pick = (c, close) => {
    if (picked.current) return;
    picked.current = true;
    onPick?.(c);
    close();
  };

  const create = async (close) => {
    const s = q.trim();
    if (!s || creating) return;
    setCreating(true);
    const digits = s.replace(/\D/g, '');
    const isPhone = digits.length >= 7 && /^[\d\s()+.-]+$/.test(s);
    const isEmail = /@/.test(s);
    const [firstName, ...rest] = s.split(/\s+/);
    const body = isPhone ? { phone: digits, firstName: '', lastName: '', displayName: formatPhone(digits) }
      : isEmail ? { email: s, firstName: s.split('@')[0] }
        : { firstName, lastName: rest.join(' ') };
    if (kind && kind !== 'all') body.contactKind = kind;
    try {
      const r = await api.post('/clients', body);
      if (r.duplicate) toast(`${fullName(r.client)} already exists — picked them`);
      clientStore.seed(r.client);
      pick(r.client, close);
    } catch (e) {
      toast.error(e.message || 'Couldn’t create that client');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} maxHeight="82%" zIndex={520}>
      {({ close }) => (
        <>
          <div className="km-search km-lg km-lg--line" style={{ marginBottom: 10, height: 40 }}>
            <Icon name="search" size={16} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, email"
              enterKeyHint="search"
              onKeyDown={(e) => { if (e.key === 'Enter' && visible[0]) pick(visible[0], close); }}
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} aria-label="Clear" style={{ color: 'var(--faint)', display: 'flex' }}>
                <Icon name="x" size={15} />
              </button>
            ) : null}
          </div>

          {allowCreate && q.trim().length >= 2 ? (
            <button type="button" className="km-row km-press" onClick={() => create(close)} style={{ width: '100%', textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', color: 'var(--bright)', flexShrink: 0 }}>
                {creating ? <Spinner size={16} /> : <Icon name="userPlus" size={17} stroke={2} />}
              </span>
              <span className="km-truncate" style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--bright)' }}>
                New {kind && kind !== 'all' && kind !== 'client' ? kind : 'client'} “{q.trim()}”
              </span>
            </button>
          ) : null}

          {!q && rows && rows.length ? <div className="km-eyebrow" style={{ padding: '10px 2px 2px' }}>Recent</div> : null}

          {rows === null ? <SkeletonRows n={6} /> : visible.length === 0 ? (
            <EmptyState icon="users" title={q ? 'No matches' : 'No clients yet'} sub={q ? 'Try another name or number.' : 'Add your first client from the Clients tab.'} />
          ) : visible.map((c, i) => {
            const reason = disabled && disabled[c.id];
            return (
              <button
                key={c.id}
                type="button"
                disabled={!!reason}
                className={`km-row km-press ${i < 12 ? 'km-row-in' : ''}`}
                style={{ width: '100%', textAlign: 'left', opacity: reason ? 0.45 : 1, animationDelay: `${Math.min(i, 12) * 18}ms` }}
                onClick={() => pick(c, close)}
              >
                <Avatar name={fullName(c)} seed={c.id} src={c.avatarUrl} size={38} channel={c.deviceMode || undefined} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 600 }}>
                    <span className="km-truncate">{fullName(c)}</span>
                    {c.isWhale ? <Icon name="crown" size={13} color="var(--amber)" stroke={2.2} /> : null}
                  </span>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 1 }}>
                    {reason || subLine(c) || ' '}
                  </span>
                </span>
                {c.rating ? <span style={{ flexShrink: 0 }}><Stars value={c.rating} size={10} gap={1} /></span> : null}
              </button>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
