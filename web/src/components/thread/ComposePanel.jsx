// New Message (overlay `compose`) — push panel: "To:" field with client search
// (or a raw phone number), then the real thread + composer for that person:
// an existing conversation shows its history (iMessage behavior), a new one is
// created by the first send. Props: { to, clientId, body, listingId }.
import { useCallback, useEffect, useRef, useState } from 'react';
import PushPanel from '../ui/PushPanel';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { api } from '../../api/client';
import { nav } from '../../lib/nav';
import { formatPhone, fullName, normalizePhone } from '../../lib/format';
import ThreadView from './ThreadView';
import { listingSnapshot } from './ListingSheet';
import { inbox } from '../inbox/useInbox';
import '../../styles/thread.css';

function toRecents(list) {
  return (list || []).filter((c) => c.clientId && !c.isGroup && c.client && c.client.phone).slice(0, 8).map((c) => ({
    id: c.clientId, name: c.name, phone: c.client.phone, avatarUrl: c.client.avatarUrl, isWhale: c.client.isWhale, contactKind: c.client.contactKind,
  }));
}

const phoneLike = (s) => /^[\d\s()+.-]{7,}$/.test(String(s || '').trim()) && normalizePhone(s).length === 10;

function recipientFromClient(c) {
  if (!c) return null;
  return {
    clientId: c.id,
    name: c.name || fullName(c),
    phone: c.phone || null,
    email: c.email || null,
    avatarUrl: c.avatarUrl || null,
    isWhale: !!c.isWhale,
  };
}

export default function ComposePanel({ to, clientId, body, listingId, onClose }) {
  const [recipient, setRecipient] = useState(null);
  const [query, setQuery] = useState(() => (to && !phoneLike(to) ? String(to) : ''));
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [conv, setConv] = useState(null);
  const [booting, setBooting] = useState(!!clientId || phoneLike(to));
  const inputRef = useRef(null);
  const composerRef = useRef(null);
  const seq = useRef(0);

  // ── prefill (client id, or a phone number in `to`) ─────────────────────
  useEffect(() => {
    let alive = true;
    if (clientId) {
      api.get(`/clients/${clientId}`)
        .then((r) => { if (alive && r && r.client) setRecipient(recipientFromClient(r.client)); })
        .catch(() => {})
        .finally(() => { if (alive) setBooting(false); });
    } else if (phoneLike(to)) {
      const handle = normalizePhone(to);
      // A saved client with this number? Text them as the client.
      api.get('/clients', { search: handle, limit: 1 })
        .then((r) => {
          if (!alive) return;
          const hit = r && r.clients && r.clients.find((c) => normalizePhone(c.phone) === handle);
          setRecipient(hit ? recipientFromClient(hit) : { handle, name: formatPhone(handle), phone: handle });
        })
        .catch(() => { if (alive) setRecipient({ handle, name: formatPhone(handle), phone: handle }); })
        .finally(() => { if (alive) setBooting(false); });
    }
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── listing seed (arrives async → pushed into the composer) ─────────────
  const [listing, setListing] = useState(undefined);
  useEffect(() => {
    if (!listingId) { setListing(null); return undefined; }
    let alive = true;
    api.get(`/listings/${listingId}`)
      .then((r) => { if (alive) setListing(r && r.listing ? listingSnapshot(r.listing) : null); })
      .catch(() => { if (alive) setListing(null); });
    return () => { alive = false; };
  }, [listingId]);
  useEffect(() => {
    if (listing && recipient && composerRef.current) composerRef.current.setListing(listing);
  }, [listing, recipient]);

  // ── search ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (recipient || q.length < 1) { seq.current += 1; setResults(null); setSearching(false); return undefined; }
    const my = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      api.get('/clients', { search: q, limit: 12 })
        .then((r) => { if (my === seq.current) setResults((r && r.clients) || []); })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setSearching(false); });
    }, 200);
    return () => clearTimeout(t);
  }, [query, recipient]);

  useEffect(() => {
    if (recipient || booting) return undefined;
    const t = setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch { /* ignore */ } }, 420);
    return () => clearTimeout(t);
  }, [recipient, booting]);

  // Recent people (no query yet): newest conversations with a saved client.
  const [recents, setRecents] = useState(() => toRecents(inbox.getState().conversations));
  useEffect(() => {
    if (recents.length) return undefined;
    let alive = true;
    api.get('/conversations', { tab: 'clients', limit: 12 })
      .then((r) => { if (alive) setRecents(toRecents(r && r.conversations)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((c) => {
    if (!c) return;
    setRecipient(recipientFromClient(c));
    setQuery('');
    setConv(null);
  }, []);
  const pickNumber = useCallback((raw) => {
    const handle = normalizePhone(raw);
    if (handle.length !== 10) return;
    const known = (results || []).find((c) => normalizePhone(c.phone) === handle);
    if (known) return pick(known);
    setRecipient({ handle, name: formatPhone(handle), phone: handle });
    setQuery('');
    setConv(null);
  }, [results, pick]);

  const clearRecipient = () => {
    setRecipient(null);
    setConv(null);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
  };

  const q = query.trim();
  const numberRow = q && phoneLike(q) ? normalizePhone(q) : null;
  const list = q ? (results || []) : recents;
  const title = conv && conv.name ? conv.name : 'New Message';

  return (
    <PushPanel onClose={onClose} title={title} scroll={false} background="var(--km-compose-bg)" className="km-compose">
      <div className="km-compose-to">
        <span className="km-compose-to-label">To:</span>
        {recipient ? (
          <button type="button" className="km-compose-chip km-press" onClick={clearRecipient} aria-label={`Remove ${recipient.name}`}>
            {recipient.name}
            <Icon name="x" size={13} stroke={2.6} />
          </button>
        ) : (
          <input
            ref={inputRef}
            className="km-compose-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (numberRow) pickNumber(q);
              else if (list[0] && list[0].phone) pick(list[0]);
            }}
            placeholder={booting ? '' : 'Name or phone number'}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            aria-label="To"
          />
        )}
        {booting ? <Spinner size={16} /> : null}
        {recipient && !recipient.clientId ? (
          <button type="button" className="km-compose-add km-press" onClick={() => nav.newClient({ phone: recipient.handle })}>
            <Icon name="userPlus" size={14} stroke={2} />
            Add
          </button>
        ) : null}
      </div>

      {recipient ? (
        listingId && listing === undefined ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <ThreadView
              key={recipient.clientId || recipient.handle}
              clientId={recipient.clientId}
              handle={recipient.clientId ? undefined : recipient.handle}
              name={recipient.name}
              variant="panel"
              showBriefing={false}
              initialDraft={body}
              initialListing={listing || undefined}
              composerRef={composerRef}
              autoFocus
              onConversation={setConv}
            />
          </div>
        )
      ) : (
        <div className="km-compose-results km-scroll">
          {numberRow ? (
            <button type="button" className="km-compose-row km-press" onClick={() => pickNumber(q)}>
              <span className="km-compose-numtile"><Icon name="message" size={16} stroke={1.8} color="currentColor" /></span>
              <span className="km-compose-row-main">
                <span className="km-compose-row-name">Text {formatPhone(numberRow)}</span>
                <span className="km-compose-row-sub">New conversation</span>
              </span>
            </button>
          ) : null}
          {!q && list.length ? <div className="km-compose-eyebrow">Recent</div> : null}
          {list.map((c, i) => {
            const textable = !!c.phone;
            return (
              <button
                key={c.id}
                type="button"
                className="km-compose-row km-press"
                disabled={!textable}
                onClick={() => pick(c)}
                style={{ animationDelay: `${Math.min(i, 5) * 30}ms` }}
              >
                <Avatar name={c.name || fullName(c)} seed={c.id} src={c.avatarUrl} size={34} style={c.isWhale ? { boxShadow: '0 0 0 1.5px rgba(var(--accent-rgb), 0.85)' } : undefined} />
                <span className="km-compose-row-main">
                  <span className="km-compose-row-name">{c.name || fullName(c)}</span>
                  <span className="km-compose-row-sub">{textable ? formatPhone(c.phone) : (c.email ? `${c.email} · no mobile number` : 'No mobile number')}</span>
                </span>
                {c.contactKind && c.contactKind !== 'client' ? <span className="km-compose-kind">{c.contactKind === 'partner' ? 'Partner' : 'Vendor'}</span> : null}
              </button>
            );
          })}
          {q && results && !results.length && !numberRow && !searching ? (
            <div className="km-compose-empty">No clients match “{q}”. Type a phone number to text someone new.</div>
          ) : null}
          {searching && !(results && results.length) ? <div className="km-compose-empty"><Spinner size={16} /></div> : null}
        </div>
      )}
    </PushPanel>
  );
}
