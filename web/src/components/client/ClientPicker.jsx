// ClientPicker — pick a client from a searchable sheet (owned by the clients
// builder; this is the baseline implementation).
//   <ClientPicker open={open} onClose={() => setOpen(false)} onPick={(client) => …} kind="client" title="Choose client" />
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { SkeletonRows, EmptyState } from '../ui/kit';
import { api } from '../../api/client';
import { fullName, formatPhone } from '../../lib/format';

export default function ClientPicker({ open, onClose, onPick, kind, title = 'Choose a client' }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      api.get('/clients', { search: q || undefined, kind, limit: 40 })
        .then((r) => { if (alive) setRows(r.clients || []); })
        .catch(() => { if (alive) setRows([]); });
    }, q ? 180 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, kind]);

  return (
    <Sheet open={open} onClose={onClose} title={title} maxHeight="80%">
      <div className="km-search km-lg km-lg--line" style={{ marginBottom: 12 }}>
        <Icon name="search" size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email" />
      </div>
      {rows === null ? <SkeletonRows n={6} /> : rows.length === 0 ? (
        <EmptyState icon="users" title="No matches" sub="Try another name or number." />
      ) : rows.map((c) => (
        <button
          key={c.id}
          type="button"
          className="km-row km-press"
          style={{ width: '100%', textAlign: 'left' }}
          onClick={() => { onPick?.(c); onClose?.(); }}
        >
          <Avatar name={fullName(c)} seed={c.id} src={c.avatarUrl} size={36} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="km-truncate" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{fullName(c)}</span>
            <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)' }}>
              {[formatPhone(c.phone), c.neighborhood].filter(Boolean).join(' · ')}
            </span>
          </span>
          {c.isWhale ? <Icon name="crown" size={15} color="var(--amber)" /> : null}
        </button>
      ))}
    </Sheet>
  );
}
