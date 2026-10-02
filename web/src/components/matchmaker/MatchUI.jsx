// Matchmaker atoms — the ONE match UI used everywhere (listing detail
// "Interested buyers", Matchmaker modes, person sheets, Serena digest):
// score dial + tier colors, Active/Dream + WHALE chips, CALL FIRST on #1,
// "Why this rating" factor bars, must-haves (met / missing / verify), the
// signals behind the score, and "Draft text" in the agent's voice.
import { useCallback, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import Sheet from '../ui/Sheet';
import { ScoreDial, Spinner, scoreColor } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import { draftMatchText, sendMatchFeedback } from '../../api/matchmaker';
import { ListingThumb } from '../listings/listingKit';
import '../../styles/matchmaker.css';

export const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';

// ── chips ────────────────────────────────────────────────────────────────
export function BucketChip({ bucket }) {
  if (!bucket) return null;
  const tone = bucket === 'Active' ? 'active' : bucket === 'Inferred' ? 'inferred' : 'dream';
  return <span className={`mm-bucket mm-bucket--${tone}`}>{bucket}</span>;
}
export const WhaleChip = () => <span className="mm-whale">Whale</span>;

const SUBJECT_TONE = {
  mine: ['My listing', '#F2A93B'], mls: ['MLS', '#4DA2FF'], pocket: ['Pocket', '#B98AFF'], whisper: ['Whisper', '#30D27A'],
  newdev: ['New dev', '#5FDCF7'], offmarket: ['Off-market', '#C08BFF'],
};
export function SubjectChip({ lane }) {
  const [label, color] = SUBJECT_TONE[lane] || SUBJECT_TONE.mls;
  return <span className="mm-subject" style={{ color, borderColor: `${color}55`, background: `${color}1A` }}>{label}</span>;
}

// ── why this rating ─────────────────────────────────────────────────────
export function FactorBar({ f }) {
  const col = f.polarity === 'match' ? 'var(--green)' : f.polarity === 'partial' ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="mm-factor">
      <span className="mm-factor-label">{f.label}</span>
      <div className="mm-factor-track"><div style={{ width: `${Math.round(f.quality * 100)}%`, background: col }} /></div>
      <span className="mm-factor-detail">{f.detail}</span>
    </div>
  );
}

const MH_COLOR = { met: 'var(--green)', missing: 'var(--red)', verify: 'var(--amber)' };
export function MustHaveChips({ mustHaves }) {
  if (!mustHaves || !mustHaves.length) return null;
  return (
    <div className="mm-musts">
      {mustHaves.map((m, i) => (
        <span key={`${m.feature}-${i}`} className="mm-must" style={{ borderColor: `color-mix(in srgb, ${MH_COLOR[m.status]} 40%, transparent)` }} title={m.detail || ''}>
          <span className="mm-must-dot" style={{ background: MH_COLOR[m.status] }} />
          {m.dealBreaker ? m.detail.replace(/^Deal-breaker: /, 'Deal-breaker · ') : m.feature}
          <span className="mm-must-status" style={{ color: MH_COLOR[m.status] }}>{m.status}</span>
        </span>
      ))}
    </div>
  );
}

const SIG_ICON = { search: 'target', note: 'file', text: 'message', call: 'phone' };
export function SignalsList({ signals }) {
  if (!signals || !signals.length) return null;
  return (
    <div className="mm-signals">
      {signals.slice(0, 5).map((s, i) => (
        <div key={i} className="mm-signal">
          <span className="mm-signal-ic"><Icon name={SIG_ICON[s.kind] || 'quote'} size={13} stroke={2} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="mm-eyebrow" style={{ fontSize: 8.5 }}>{s.label}</div>
            <div className="mm-signal-text km-selectable">{s.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WhyRating({ result, signals, title = 'Why this rating' }) {
  return (
    <>
      {result.factors && result.factors.length ? (
        <>
          <div className="mm-eyebrow mm-eyebrow--blue" style={{ margin: '12px 0 2px' }}>{title}</div>
          {result.factors.map((f) => <FactorBar key={f.key} f={f} />)}
        </>
      ) : null}
      {result.mustHaves && result.mustHaves.length ? (
        <>
          <div className="mm-eyebrow" style={{ margin: '12px 0 6px' }}>Must-haves</div>
          <MustHaveChips mustHaves={result.mustHaves} />
        </>
      ) : null}
      {signals && signals.length ? (
        <>
          <div className="mm-eyebrow" style={{ margin: '14px 0 6px' }}>Signals behind it</div>
          <SignalsList signals={signals} />
        </>
      ) : null}
    </>
  );
}

// ── draft a text (AI in the agent's voice → seeded thread, never auto-sent) ─
export function draftModeFor({ lane, kind, dropAmount, priceDroppedAt }) {
  if (kind === 'offmarket' || lane === 'offmarket') return 'offmarket_buyer';
  if (lane === 'whisper' || kind === 'whisper') return 'whisper';
  if (dropAmount && (!priceDroppedAt || Date.now() - new Date(priceDroppedAt).getTime() < 21 * 864e5)) return 'price_drop';
  return 'listing';
}

export function useDraftText() {
  const [busy, setBusy] = useState(null);
  const draft = useCallback(async ({ clientId, name, listingId, propertyId, mode = 'listing', before }) => {
    if (!clientId || busy) return;
    const key = `${clientId}|${listingId || propertyId || ''}|${mode}`;
    setBusy(key);
    let text = null;
    try {
      const r = await draftMatchText({ clientId, listingId, propertyId, mode });
      text = r && r.text;
    } catch (err) {
      toast.error(`Couldn't draft it — opening a blank text to ${firstOf(name)}.`);
    } finally {
      setBusy(null);
    }
    if (before) await before();
    nav.openThread({ clientId, name, draft: text || undefined });
  }, [busy]);
  return { busy, draft, isBusy: (clientId, subjectId, mode) => busy === `${clientId}|${subjectId || ''}|${mode}` };
}

// Optimistic dismiss with Undo (+ MatchFeedback telemetry).
export async function dismissMatch({ clientId, listingId, propertyId, matchId, score, name }, { onRemove, onRestore } = {}) {
  onRemove && onRemove();
  const ids = { clientId, listingId: listingId || null, propertyId: propertyId || null, matchId: matchId || null, score };
  try {
    await sendMatchFeedback({ event: 'dismissed', ...ids });
    toast(`Hidden ${firstOf(name)}'s match`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          onRestore && onRestore();
          try { await sendMatchFeedback({ event: 'undismissed', ...ids }); } catch { toast.error("Couldn't restore that match"); }
        },
      },
    });
  } catch {
    onRestore && onRestore();
    toast.error("Couldn't dismiss that match");
  }
}

export function track(event, payload) {
  sendMatchFeedback({ event, ...payload }).catch(() => {});
}

// ── one buyer card (detail sheets) ───────────────────────────────────────
export function MatchRow({ rank, buyer, top, subject, onDismiss, defaultOpen = false, mode, beforeNav }) {
  const [open, setOpen] = useState(defaultOpen);
  const { draft, isBusy } = useDraftText();
  const subjectId = subject.listingId || subject.propertyId;
  const dmode = mode || draftModeFor(subject);
  const busy = isBusy(buyer.clientId, subjectId, dmode);
  const toggle = () => {
    setOpen((o) => !o);
    if (!open) track('opened', { clientId: buyer.clientId, listingId: subject.listingId, propertyId: subject.propertyId, matchId: buyer.matchId });
  };
  return (
    <div className={`mm-card ${top ? 'mm-card--top' : ''}`}>
      {top ? <div className="mm-callfirst">CALL FIRST</div> : null}
      <button type="button" className="mm-row-btn" onClick={toggle} style={{ paddingTop: top ? 17 : 12 }}>
        <span className="mm-rank">{String(rank).padStart(2, '0')}</span>
        <Avatar name={buyer.name} seed={buyer.clientId} src={buyer.avatarUrl} size={38} ring={top ? 'var(--blue)' : undefined} channel={buyer.channel} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mm-name-row">
            <span className="mm-name" role="link" tabIndex={0} onClick={async (e) => { e.stopPropagation(); if (beforeNav) await beforeNav(); nav.openClient(buyer.clientId); }}>{buyer.name}</span>
            <BucketChip bucket={buyer.bucket} />
            {buyer.whale ? <WhaleChip /> : null}
            {buyer.sent ? <span className="mm-sent">Sent</span> : null}
          </div>
          {buyer.crossedBudget ? <div className="mm-crossed"><Icon name="trendingDown" size={12} stroke={2.2} />Just crossed into their budget</div> : null}
          <div className="mm-summary">{buyer.summary}{buyer.searchName ? <span className="mm-faint"> · {buyer.searchName}</span> : null}</div>
        </div>
        <ScoreDial value={buyer.score} size={top ? 52 : 46} stroke={3} label={`${buyer.score}${buyer.verifyHold ? '*' : ''}`} fontSize={top ? 17 : 15} />
      </button>
      {open ? (
        <div className="mm-expand">
          <WhyRating result={buyer} signals={buyer.signals} />
          <div className="mm-btns">
            <button type="button" className="mm-draft" disabled={busy} onClick={() => draft({ clientId: buyer.clientId, name: buyer.name, listingId: subject.listingId, propertyId: subject.propertyId, mode: dmode, before: beforeNav })}>
              {busy ? <><Spinner size={15} color="#fff" /> Writing it in your voice…</> : <><Icon name="message" size={16} stroke={1.9} /> Draft text to {firstOf(buyer.name)}</>}
            </button>
            <button type="button" className="mm-icon-btn" aria-label={`Call ${buyer.name}`} onClick={async () => { if (beforeNav) await beforeNav(); nav.call({ clientId: buyer.clientId, phone: buyer.phone, name: buyer.name }); }}><Icon name="phone" size={17} stroke={1.9} /></button>
            {onDismiss ? <button type="button" className="mm-icon-btn" aria-label="Not a fit" onClick={() => onDismiss(buyer)}><Icon name="eyeOff" size={17} stroke={1.9} /></button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BuyersList({ buyers, subject, onDismiss, emptyTitle = 'No buyers at 80%+ yet', emptySub, threshold = 80, fallback, hiddenCount = 0, closest = [], beforeNav }) {
  if (!buyers.length) {
    return (
      <div>
        <div className="mm-empty-inline">
          <Icon name="rings" size={22} color="var(--faint)" />
          <div className="mm-empty-title">{emptyTitle}</div>
          <div className="mm-empty-sub">{emptySub || 'Tighten a client\'s search or verify must-haves on the feature sheet to sharpen the match.'}</div>
        </div>
        {closest.length ? (
          <div style={{ opacity: 0.82 }}>
            <div className="mm-eyebrow" style={{ margin: '14px 2px 8px' }}>Closest fits</div>
            <div className="mm-stack">{closest.map((b, i) => <MatchRow key={b.clientId} rank={i + 1} buyer={b} subject={subject} onDismiss={onDismiss} beforeNav={beforeNav} />)}</div>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      {fallback ? <div className="mm-fallback">No one scores 80% or higher yet, so here are the closest fits from {threshold} to 80%.</div> : null}
      <div className="mm-stack">
        {buyers.map((b, i) => <MatchRow key={b.clientId} rank={i + 1} top={i === 0} buyer={b} subject={subject} onDismiss={onDismiss} beforeNav={beforeNav} />)}
      </div>
      {hiddenCount ? <div className="kl-more-below">{hiddenCount} more below {threshold}% — hidden by the threshold</div> : null}
    </div>
  );
}

// ── people-first list row ────────────────────────────────────────────────
export function PersonRow({ rank, row, onOpen }) {
  const { client, best } = row;
  const more = row.count - 1;
  const top = rank === 1;
  return (
    <button type="button" className={`mm-person ${top ? 'mm-person--top' : ''} km-row-in`} style={{ animationDelay: `${Math.min(rank - 1, 12) * 30}ms` }} onClick={() => onOpen(row)}>
      {top ? <div className="mm-callfirst">CALL FIRST</div> : null}
      <span className="mm-rank">{String(rank).padStart(2, '0')}</span>
      <Avatar name={client.name} seed={client.id} src={client.avatarUrl} size={38} ring={top ? 'var(--blue)' : undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mm-name-row">
          <span className="mm-name km-truncate" style={{ maxWidth: 150 }}>{client.name}</span>
          <BucketChip bucket={client.bucket} />
          {client.whale ? <WhaleChip /> : null}
        </div>
        <div className="mm-person-sub">
          <SubjectChip lane={best.subject.lane} />
          <span className="km-truncate">{best.subject.label}</span>
        </div>
        {more > 0 ? <div style={{ marginTop: 5 }}><span className="mm-more">+{more} more home{more === 1 ? '' : 's'}</span></div> : null}
      </div>
      <ScoreDial value={best.score} size={46} stroke={3} label={`${best.score}${best.verifyHold ? '*' : ''}`} fontSize={15} />
    </button>
  );
}

export function PeopleList({ rows, onOpen, loading }) {
  if (loading) {
    return (
      <div className="mm-stack">
        {[0, 1, 2].map((i) => <div key={i} className="km-skel" style={{ height: 64, borderRadius: 14, animationDelay: `${i * 0.12}s` }} />)}
      </div>
    );
  }
  return <div className="mm-stack">{rows.map((r, i) => <PersonRow key={r.key} rank={i + 1} row={r} onOpen={onOpen} />)}</div>;
}

// ── per-person detail sheet ──────────────────────────────────────────────
function SubjectMatchCard({ m, client, top, onOpenSubject, onDismiss, beforeNav }) {
  const { draft, isBusy } = useDraftText();
  const s = m.subject;
  const mode = draftModeFor({ lane: s.lane, kind: s.kind, dropAmount: s.dropAmount });
  const subjectId = s.listingId || s.propertyId;
  const busy = isBusy(client.id, subjectId, mode);
  return (
    <div className={`mm-card ${top ? 'mm-card--top' : ''}`}>
      <button type="button" className="mm-subject-head" onClick={() => onOpenSubject(s)}>
        <ListingThumb src={s.photo} seed={s.id} w={56} h={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mm-name-row" style={{ gap: 6 }}>
            <SubjectChip lane={s.lane} />
            {s.price ? <span className="mm-price">{s.kind === 'offmarket' ? `est. ${moneyCompact(s.price)}` : moneyCompact(s.price)}</span> : null}
            {s.dropAmount ? <span className="mm-drop">↓ {moneyCompact(s.dropAmount)}</span> : null}
          </div>
          <div className="mm-subject-label km-truncate">{s.label}</div>
          <div className="mm-eyebrow km-truncate" style={{ marginTop: 2 }}>{s.sub}</div>
        </div>
        <ScoreDial value={m.score} size={top ? 50 : 44} stroke={3} label={`${m.score}${m.verifyHold ? '*' : ''}`} fontSize={top ? 16 : 14} />
      </button>
      <div className="mm-expand" style={{ paddingTop: 2 }}>
        {m.crossedBudget ? <div className="mm-crossed" style={{ marginTop: 10 }}><Icon name="trendingDown" size={12} stroke={2.2} />Just crossed into their budget</div> : null}
        <div className="mm-summary" style={{ marginTop: 10 }}>{m.summary}{m.searchName ? <span className="mm-faint"> · {m.searchName}</span> : null}</div>
        <WhyRating result={m} signals={top ? m.signals : null} title="Why this fits" />
        <div className="mm-btns">
          <button type="button" className="mm-draft" disabled={busy} onClick={() => draft({ clientId: client.id, name: client.name, listingId: s.listingId, propertyId: s.propertyId, mode, before: beforeNav })}>
            {busy ? <><Spinner size={15} color="#fff" /> Writing it in your voice…</> : <><Icon name="message" size={16} stroke={1.9} /> Draft text to {firstOf(client.name)}</>}
          </button>
          {onDismiss ? <button type="button" className="mm-icon-btn" aria-label="Not a fit" onClick={() => onDismiss(m)}><Icon name="eyeOff" size={17} stroke={1.9} /></button> : null}
        </div>
      </div>
    </div>
  );
}

export function PersonSheet({ row, open, onClose, floorLabel = '≥80%', onDismiss }) {
  if (!row) return null;
  const { client } = row;
  const matches = [row.best, ...row.others];
  const openSubject = (s, close) => {
    close();
    setTimeout(() => {
      if (s.kind === 'offmarket') nav.openClient(s.ownerClientId);
      else nav.openListing(s.listingId);
    }, 140);
  };
  return (
    <Sheet open={open} onClose={onClose} left={false} maxHeight="88%">
      {({ close }) => (
        <div>
          <div className="mm-person-head">
            <Avatar name={client.name} seed={client.id} src={client.avatarUrl} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mm-name-row">
                <button type="button" className="mm-person-name" onClick={() => { close(); setTimeout(() => nav.openClient(client.id), 140); }}>{client.name}</button>
                <BucketChip bucket={client.bucket} />
                {client.whale ? <WhaleChip /> : null}
              </div>
              <div className="mm-eyebrow" style={{ color: scoreColor(row.best.score), marginTop: 5 }}>
                {row.count} home{row.count === 1 ? '' : 's'} they'd want · best {row.best.score}%
              </div>
            </div>
            <button type="button" className="mm-icon-btn" aria-label={`Call ${client.name}`} onClick={() => { close(); setTimeout(() => nav.call({ clientId: client.id, phone: client.phone, name: client.name }), 140); }}><Icon name="phone" size={17} stroke={1.9} /></button>
          </div>
          <div className="mm-eyebrow" style={{ margin: '6px 2px 10px' }}>Homes for {firstOf(client.name)} · {floorLabel}</div>
          <div className="mm-stack">
            {matches.map((m, i) => (
              <SubjectMatchCard key={`${m.subject.kind}:${m.subject.id}`} m={m} client={client} top={i === 0} onOpenSubject={(s) => openSubject(s, close)} onDismiss={onDismiss ? (mm) => onDismiss(mm, client) : null} beforeNav={() => { close(); return new Promise((r) => setTimeout(r, 120)); }} />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
