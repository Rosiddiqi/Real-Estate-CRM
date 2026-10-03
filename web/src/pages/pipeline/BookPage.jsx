// Book of Business (PushPanel) — two views:
//   Ledger  · every closed side, by month (viewer's time zone), newest first;
//             first visit opens the newest month; same client twice in a month
//             collapses to "+N"; tap the date to edit the closing date.
//   Clients · lifetime roll-up: volume, GCI, transactions, last close; sort by
//             volume · GCI · recent · A–Z · rating · transactions; badges
//             Whale/UHNW · Repeat · Referrer · VIP · Recent · Investor · Anniversary.
// Tapping a person opens their client card.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel from '../../components/ui/PushPanel';
import Avatar from '../../components/ui/Avatar';
import Icon from '../../components/ui/Icon';
import PillTabs from '../../components/ui/PillTabs';
import Sheet from '../../components/ui/Sheet';
import { EmptyState, Spinner } from '../../components/ui/kit';
import { toast } from '../../components/ui/toast';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import { getBookClients, getBookLedger, patchDeal } from '../../api/deals';
import { useResync, useSocket } from '../../hooks/useSocket';
import { MiniStars, dayAgo, first, shortDate, toDateInput, todayInput } from '../../components/pipeline/bits';
import '../../styles/pipeline.css';

const OPEN_KEY = 'km_bookOpenMonths';
const VIEW_KEY = 'km_bookView';
const SORTS = [
  ['volume', 'Lifetime volume'],
  ['gci', 'Lifetime GCI'],
  ['recent', 'Most recent close'],
  ['alpha', 'A–Z'],
  ['rating', 'Rating'],
  ['transactions', 'Transactions'],
];
const BADGES = {
  whale: { label: 'Whale', icon: 'diamond', color: 'var(--text)' },
  repeat: { label: 'Repeat', icon: 'refresh', color: 'var(--dim)' },
  referrer: { label: 'Referrer', icon: 'handshake', color: 'var(--amber)' },
  vip: { label: 'VIP', icon: 'crown', color: 'var(--hl-ink)' },
  recent: { label: 'Recent', icon: 'clock', color: 'var(--green)' },
  investor: { label: 'Investor', icon: 'building', color: 'var(--cyan)' },
  anniversary: { label: 'Anniversary', icon: 'key', color: 'var(--amber)' },
};

const monthKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const readJson = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function Badge({ id }) {
  const b = BADGES[id];
  if (!b) return null;
  return (
    <span className="km-bk-badge" style={{ color: b.color, background: `color-mix(in srgb, ${b.color} 12%, transparent)` }}>
      <Icon name={b.icon} size={9} stroke={2.4} />{b.label}
    </span>
  );
}

function EditDateSheet({ row, onClose, onSaved }) {
  const [date, setDate] = useState(row ? toDateInput(row.closedAt) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (row) { setDate(toDateInput(row.closedAt)); setErr(''); } }, [row]);
  if (!row) return null;
  return (
    <Sheet open={!!row} onClose={onClose} title={`${first(row.name)}’s closing`} subtitle={row.address || undefined} left={false} zIndex={460}>
      <div style={{ fontSize: 13, color: 'var(--dim)', lineHeight: 1.45, marginBottom: 14 }}>
        Filed under {monthLabel(row.closedAt)}. Change the recorded closing date and it moves in Commissions too — it counts toward whichever month it really closed.
      </div>
      <div className="km-pl-field">
        <span className="km-pl-field-l" style={{ fontSize: 14, color: 'var(--text)' }}>Closed on</span>
        <div className="km-pl-amt km-pl-amt--date"><input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} aria-label="Closed on" /></div>
      </div>
      {err ? <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 8 }}>{err}</div> : null}
      <div className="km-pl-btnrow">
        <button type="button" className="km-pl-btn km-press" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="km-pl-btn km-pl-btn--primary km-press"
          style={{ flex: 1.6 }}
          disabled={!date || busy || date === toDateInput(row.closedAt)}
          onClick={async () => {
            setBusy(true); setErr('');
            try {
              const r = await patchDeal(row.dealId, { closedAt: date });
              onSaved(row, r.deal);
            } catch (e) {
              setErr(e && e.message ? e.message : 'Couldn’t move it — try again');
            } finally { setBusy(false); }
          }}
        >
          {busy ? 'Saving…' : 'Save date'}
        </button>
      </div>
    </Sheet>
  );
}

function SortSheet({ open, value, onPick, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sort by" left={false} zIndex={460}>
      <div className="km-pl-optlist">
        {SORTS.map(([id, l]) => (
          <button key={id} type="button" className={`km-pl-opt ${value === id ? 'km-pl-opt--on' : ''}`} onClick={() => { onPick(id); onClose(); }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: value === id ? 500 : 400 }}>{l}</span>
            {value === id ? <Icon name="check" size={16} color="var(--blue)" stroke={2.6} /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Ledger({ data, onEditDate }) {
  const months = useMemo(() => {
    const bucket = new Map();
    for (const r of data.closings) {
      const key = monthKey(r.closedAt);
      if (!bucket.has(key)) bucket.set(key, { key, label: monthLabel(r.closedAt), rows: [], byClient: new Map(), volume: 0 });
      const m = bucket.get(key);
      m.volume += r.price || 0;
      const seen = m.byClient.get(r.clientId);
      if (seen) { seen.alsoCount += 1; continue; }
      const row = { ...r, alsoCount: 0 };
      m.byClient.set(r.clientId, row);
      m.rows.push(row);
    }
    return [...bucket.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [data]);
  const [open, setOpen] = useState(() => new Set(readJson(OPEN_KEY, [])));
  const [touched, setTouched] = useState(() => { try { return !!localStorage.getItem(OPEN_KEY); } catch { return false; } });
  const isOpen = (k) => (touched ? open.has(k) : k === (months[0] && months[0].key));
  const toggle = (k) => {
    const next = new Set(touched ? open : (months[0] ? [months[0].key] : []));
    if (next.has(k)) next.delete(k); else next.add(k);
    setOpen(next); setTouched(true); writeJson(OPEN_KEY, [...next]);
  };
  if (!months.length) {
    return <EmptyState icon="award" title="No closings yet" sub="Move a deal to Closed and the client lands here, filed under the month it closed." />;
  }
  return months.map((m) => {
    const expanded = isOpen(m.key);
    return (
      <section key={m.key}>
        <button type="button" className="km-bk-month" onClick={() => toggle(m.key)} aria-expanded={expanded}>
          <span className="km-bk-month-l">{m.label}</span>
          <span className="km-bk-month-v">{moneyCompact(m.volume)}</span>
          <span className="km-bk-month-n">{String(m.rows.length).padStart(2, '0')}</span>
          <Icon name="chevronRight" size={15} className="km-bk-chev" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }} />
        </button>
        <div className="km-bk-acc" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
          <div>
            <div style={{ padding: '6px 0 10px' }}>
              {m.rows.map((r, i) => (
                <div
                  key={r.dealId}
                  className="km-bk-row km-pressable km-row-in"
                  style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}
                  role="button"
                  tabIndex={0}
                  onClick={() => nav.openClient(r.clientId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') nav.openClient(r.clientId); }}
                >
                  <Avatar name={r.name} seed={r.clientId} src={r.avatarUrl} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {r.name}{r.isWhale ? <Icon name="diamond" size={12} color="var(--bright)" stroke={2} /> : null}
                    </div>
                    <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>
                      {r.verb} · {r.address || r.sideLabel}{r.price ? ` · ${moneyCompact(r.price)}` : ''}{r.alsoCount ? ` +${r.alsoCount}` : ''}
                    </div>
                    {r.rating ? <div style={{ marginTop: 3 }}><MiniStars value={r.rating} size={10} /></div> : null}
                  </div>
                  <button
                    type="button"
                    className="km-bk-date"
                    aria-label={`Edit ${r.name}’s closing date`}
                    onClick={(e) => { e.stopPropagation(); onEditDate(r); }}
                  >
                    {shortDate(r.closedAt)}
                    <Icon name="edit" size={10} stroke={2.2} />
                  </button>
                  <Icon name="chevronRight" size={14} color="var(--faint)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  });
}

function Clients({ sort, setSortOpen, search, setSearch }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    getBookClients({ sort, search: search || undefined }).then((r) => { setData(r); setError(null); }).catch((e) => setError(e));
  }, [sort, search]);
  useEffect(() => { const t = setTimeout(load, search ? 220 : 0); return () => clearTimeout(t); }, [load, search]);
  useSocket(['deal_updated', 'deal_created', 'deal_deleted', 'client_updated'], () => load());
  useResync(load);
  const s = data && data.stats;
  return (
    <>
      <div className="km-bk-stats">
        <div className="km-bk-stat"><div className="km-pl-eyebrow">Clients</div><div className="km-bk-stat-v">{s ? s.clients : '–'}</div></div>
        <div className="km-bk-stat"><div className="km-pl-eyebrow">Lifetime</div><div className="km-bk-stat-v" style={{ color: 'var(--green)' }}>{s ? moneyCompact(s.lifetimeVolume, { digits: 1 }) : '–'}</div></div>
        <div className="km-bk-stat"><div className="km-pl-eyebrow">Avg price</div><div className="km-bk-stat-v" style={{ color: 'var(--blue)' }}>{s ? moneyCompact(s.avgPrice, { digits: 1 }) : '–'}</div></div>
        <div className="km-bk-stat"><div className="km-pl-eyebrow">Repeat</div><div className="km-bk-stat-v" style={{ color: 'var(--violet)' }}>{s ? s.repeat : '–'}</div></div>
      </div>
      <div className="km-bk-sortbar">
        <div className="km-search km-lg km-lg--line" style={{ flex: 1 }}>
          <Icon name="search" size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search past clients" aria-label="Search past clients" />
        </div>
        <button type="button" className="km-pill km-press" onClick={() => setSortOpen(true)} aria-label="Sort">
          <Icon name="sort" size={14} /> {SORTS.find((x) => x[0] === sort)?.[1].replace('Lifetime ', '').replace('Most recent close', 'Recent')}
        </button>
      </div>
      {error && !data ? (
        <div className="km-pl-error">Couldn’t load your clients.<button type="button" onClick={load}>Retry</button></div>
      ) : !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner /></div>
      ) : data.clients.length === 0 ? (
        <EmptyState icon="users" title={search ? 'No matches' : 'No past clients yet'} sub={search ? 'Try another name.' : 'Clients appear here after their first closing with you.'} />
      ) : data.clients.map((c, i) => (
        <div
          key={c.id}
          className="km-bk-crow km-pressable km-row-in"
          style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}
          role="button"
          tabIndex={0}
          onClick={() => nav.openClient(c.id)}
          onKeyDown={(e) => { if (e.key === 'Enter') nav.openClient(c.id); }}
        >
          <Avatar name={c.name} seed={c.id} src={c.avatarUrl} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="km-truncate" style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{c.name}</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--green)', letterSpacing: -0.3 }}>{moneyCompact(c.lifetimeVolume)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span className="km-truncate" style={{ flex: 1, fontSize: 12, color: 'var(--dim)' }}>
                {c.transactions} {c.transactions === 1 ? 'transaction' : 'transactions'} · {moneyCompact(c.lifetimeGci)} GCI
              </span>
              {c.rating ? <MiniStars value={c.rating} size={9} /> : null}
            </div>
            {c.latest ? (
              <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
                {c.latest.address || 'Last close'}{c.lastClosedAt ? ` · ${dayAgo(c.lastClosedAt)}` : ''}
              </div>
            ) : c.lastClosedAt ? <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>Last close {dayAgo(c.lastClosedAt)}</div> : null}
            {c.badges.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {c.badges.map((b) => <Badge key={b} id={b} />)}
                {c.anniversary ? <span style={{ fontSize: 10.5, color: 'var(--faint)', alignSelf: 'center' }}>{c.anniversary.years}y {c.anniversary.days === 0 ? 'today' : `in ${c.anniversary.days}d`}</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}

export default function BookPage({ onClose }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'ledger'; } catch { return 'ledger'; } });
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sort, setSort] = useState('volume');
  const [sortOpen, setSortOpen] = useState(false);
  const [search, setSearch] = useState('');
  const timer = useRef(null);

  const load = useCallback(() => {
    getBookLedger().then((r) => { setLedger(r); setError(null); }).catch((e) => setError(e));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);
  useSocket(['deal_updated', 'deal_created', 'deal_deleted'], () => { clearTimeout(timer.current); timer.current = setTimeout(load, 500); });
  useResync(load);
  useEffect(() => () => clearTimeout(timer.current), []);

  const stats = ledger && ledger.stats;
  return (
    <PushPanel onClose={onClose} title="Book of Business" subtitle={stats ? `${stats.closings} closed · ${stats.clients} clients · ${moneyCompact(stats.volume)}` : undefined}>
      <div style={{ padding: '6px 16px 12px' }}>
        <PillTabs value={view} onChange={setView} items={[{ id: 'ledger', label: 'Ledger' }, { id: 'clients', label: 'Clients' }]} />
      </div>
      {view === 'ledger' ? (
        error && !ledger ? (
          <div className="km-pl-error">Couldn’t load the ledger.<button type="button" onClick={load}>Retry</button></div>
        ) : !ledger ? (
          <div aria-hidden="true" style={{ paddingTop: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="km-row-in" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', animationDelay: `${i * 22}ms` }}>
                <div className="km-skel" style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="km-skel" style={{ width: `${46 + ((i * 17) % 32)}%`, height: 13, marginBottom: 7 }} />
                  <div className="km-skel" style={{ width: `${28 + ((i * 11) % 22)}%`, height: 10 }} />
                </div>
              </div>
            ))}
          </div>
        ) : <Ledger data={ledger} onEditDate={setEditing} />
      ) : (
        <Clients sort={sort} setSortOpen={setSortOpen} search={search} setSearch={setSearch} />
      )}
      <EditDateSheet
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={(row, deal) => {
          setEditing(null);
          setLedger((d) => d && ({ ...d, closings: d.closings.map((x) => (x.dealId === row.dealId ? { ...x, closedAt: deal.closedAt } : x)) }));
          const k = monthKey(deal.closedAt);
          const cur = new Set(readJson(OPEN_KEY, []));
          cur.add(k); writeJson(OPEN_KEY, [...cur]);
          toast.success(`Filed under ${monthLabel(deal.closedAt)}`);
          load();
        }}
      />
      <SortSheet open={sortOpen} value={sort} onPick={setSort} onClose={() => setSortOpen(false)} />
    </PushPanel>
  );
}
