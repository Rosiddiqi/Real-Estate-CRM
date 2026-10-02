// CallSearchSheet — search your call history by name or number.
import { useEffect, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { EmptyState, SkeletonRows } from '../ui/kit';
import { listCalls } from '../../api/calls';
import CallRow from './CallRow';

export default function CallSearchSheet({ open, onClose, onCall, onInfo, onSave }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const seq = useRef(0);
  const input = useRef(null);

  useEffect(() => { if (open) { setQ(''); setRows(null); setTimeout(() => input.current?.focus(), 320); } }, [open]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows(null); return undefined; }
    const my = (seq.current += 1);
    const t = setTimeout(() => {
      listCalls({ q: term, limit: 40 }).then((r) => { if (my === seq.current) setRows(r.calls || []); }).catch(() => { if (my === seq.current) setRows([]); });
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet open={open} onClose={onClose} title="Search calls" maxHeight="88%" padded={false}>
      <div style={{ padding: '4px 16px 8px' }}>
        <div className="km-search km-lg km-lg--line" style={{ height: 40 }}>
          <Icon name="search" size={16} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number" aria-label="Search calls" />
          {q ? <button type="button" onClick={() => setQ('')} aria-label="Clear"><Icon name="x" size={15} /></button> : null}
        </div>
      </div>
      <div style={{ minHeight: 260 }}>
        {q.trim().length < 2 ? (
          <EmptyState icon="phone" title="Search your calls" sub="Find a call by the client’s name or any part of the number." />
        ) : rows === null ? (
          <div style={{ padding: '0 16px' }}><SkeletonRows n={4} /></div>
        ) : !rows.length ? (
          <EmptyState icon="search" title={`No calls for “${q.trim()}”`} sub="Try a first name, last name or the last four digits." />
        ) : rows.map((c, i) => (
          <CallRow key={c.id} call={c} index={i} onCall={(x) => { onClose(); onCall(x); }} onInfo={(x) => { onClose(); onInfo(x); }} onSave={(x) => { onClose(); onSave(x); }} />
        ))}
      </div>
    </Sheet>
  );
}
