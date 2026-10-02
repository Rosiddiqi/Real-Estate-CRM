// Clients-area kit — vocab, formatters and small primitives shared by the
// Clients tab, client card, Portfolio, Waitlists and Import.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import { moneyCompact, relativeTime, formatPhone } from '../../lib/format';

// ── vocab ────────────────────────────────────────────────────────────────
export const KIND_TABS = [
  { id: 'client', label: 'Clients' },
  { id: 'partner', label: 'Partners' },
  { id: 'vendor', label: 'Vendors' },
];
export const KIND_SINGULAR = { client: 'client', partner: 'partner', vendor: 'vendor' };

export const CLIENT_TYPES = [
  { value: 'buyer', label: 'Buyer' }, { value: 'seller', label: 'Seller' }, { value: 'buyer_seller', label: 'Buyer & seller' },
  { value: 'investor', label: 'Investor' }, { value: 'renter', label: 'Renter' }, { value: 'landlord', label: 'Landlord' },
  { value: 'developer', label: 'Developer' }, { value: 'sphere', label: 'Sphere' },
];
export const TYPE_LABEL = Object.fromEntries(CLIENT_TYPES.map((t) => [t.value, t.label]));

export const STATUSES = [
  { value: 'lead', label: 'Lead', tone: 'orange' }, { value: 'active', label: 'Active', tone: 'blue' },
  { value: 'past_client', label: 'Past client', tone: 'green' }, { value: 'sphere', label: 'Sphere', tone: 'violet' },
  { value: 'inactive', label: 'Inactive', tone: 'gray' },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.value, s]));

export const LEAD_SOURCES = ['Referral', 'Sphere', 'Past client', 'Open house', 'Zillow', 'Website', 'Instagram', 'Sign call', 'Broker network', 'Developer', 'Relocation', 'Other'];
export const VENDOR_ROLES = ['Lender', 'Attorney', 'Inspector', 'Title', 'Appraiser', 'Stager', 'Photographer', 'Contractor', 'Designer', 'Insurance', 'Architect', 'Mover'];
export const PARTNER_ROLES = ['Co-op agent', 'Referral agent', 'Relocation partner', 'Private banker', 'Wealth manager', 'Family office', 'Concierge', 'Developer rep'];

export const RELATIONS = [
  { value: 'spouse', label: 'Spouse' }, { value: 'partner', label: 'Partner' }, { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' }, { value: 'sibling', label: 'Sibling' }, { value: 'assistant', label: 'Assistant' },
  { value: 'business_partner', label: 'Business partner' }, { value: 'family_office', label: 'Family office' },
  { value: 'attorney', label: 'Attorney' }, { value: 'other', label: 'Other' },
];
export const RELATION_LABEL = {
  ...Object.fromEntries(RELATIONS.map((r) => [r.value, r.label])),
  employer: 'Works for', principal: 'Principal', client: 'Client',
};

export const PERSONAL_FIELDS = [
  { key: 'spouse', label: 'Spouse / partner', icon: 'rings', placeholder: 'Camille' },
  { key: 'kids', label: 'Kids', icon: 'heart', placeholder: 'Léa (11), Marius (8)' },
  { key: 'pets', label: 'Pets', icon: 'heart', placeholder: 'Otis — Bernese mountain dog' },
  { key: 'hobbies', label: 'Hobbies', icon: 'flag', placeholder: 'Offshore sailing, padel' },
  { key: 'clubs', label: 'Clubs', icon: 'award', placeholder: 'Grove Harbour Yacht Club' },
  { key: 'favoriteRestaurants', label: 'Restaurants', icon: 'star', placeholder: 'Le Petit Quai, Osteria Vela' },
  { key: 'wine', label: 'Wine', icon: 'wine', placeholder: 'White Burgundy — Meursault' },
  { key: 'boats', label: 'Boats', icon: 'anchor', placeholder: 'Belle Rive · 82′ motor yacht' },
  { key: 'art', label: 'Art', icon: 'image', placeholder: 'Large-format seascapes' },
  { key: 'coffee', label: 'Coffee', icon: 'sun', placeholder: 'Cortado, oat milk' },
  { key: 'languages', label: 'Languages', icon: 'globe', placeholder: 'French, English' },
  { key: 'anniversary', label: 'Anniversary', icon: 'calendar', placeholder: 'June 12' },
  { key: 'other', label: 'Other', icon: 'sparkle', placeholder: 'Anything worth remembering' },
];
// Keys never surfaced (protected-class adjacent; Fair Housing).
export const PERSONAL_HIDDEN = new Set(['origin', 'nationality', 'religion', 'ethnicity', 'race']);

// Render any personal value (string · list · {name, age, …} · [{…}]) as text.
export function fmtPersonal(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(fmtPersonal).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.name && v.lengthFt) return `${v.name} · ${v.lengthFt}′${v.kind ? ` ${v.kind}` : ''}`;
    if (v.name && v.age != null) return `${v.name} (${v.age})`;
    if (v.name) return v.name;
    return Object.values(v).filter((x) => typeof x === 'string' || typeof x === 'number').join(' · ');
  }
  return String(v);
}

export const FINANCING = [
  { value: 'cash_pof', label: 'Cash · proof of funds' }, { value: 'preapproved', label: 'Pre-approved' },
  { value: 'prequalified', label: 'Pre-qualified' }, { value: 'contingent', label: 'Contingent on sale' }, { value: 'unknown', label: 'Unknown' },
];
export const FINANCING_LABEL = { ...Object.fromEntries(FINANCING.map((f) => [f.value, f.label])), cash: 'All cash', jumbo: 'Jumbo loan', '1031_exchange': '1031 exchange', bridge: 'Bridge loan', undecided: 'Undecided' };
export const TIMELINES = [
  { value: 'asap', label: 'ASAP' }, { value: '30d', label: '30 days' }, { value: '90d', label: '3 mo' },
  { value: '6mo', label: '6 mo' }, { value: '12mo', label: '12 mo' }, { value: 'someday', label: 'Someday' },
];
export const TIMELINE_LABEL = { asap: 'ASAP', '30d': 'Within 30 days', '90d': 'Within 3 months', '6mo': 'Within 6 months', '12mo': 'Within a year', someday: 'Opportunistic' };

// ── formatters ───────────────────────────────────────────────────────────
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
export const humanize = (s) => (s ? cap(String(s).replace(/_/g, ' ')) : '');

export function displayName(c) {
  if (!c) return '';
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.name || c.company || formatPhone(c.phone) || c.email || 'Unknown';
}

export function lastTouch(c) {
  const ds = [c.lastContactedAt, c.lastInboundAt, c.lastOutboundAt].filter(Boolean).map((d) => new Date(d).getTime());
  return ds.length ? new Date(Math.max(...ds)) : null;
}

// "Buyer · Bal Harbour · 3d ago" / "Lender · First Republic"
export function subLine(c, { withKind = false } = {}) {
  if (!c) return '';
  if (c.contactKind === 'vendor' || c.contactKind === 'partner') {
    return [withKind ? cap(c.contactKind) : null, c.vendorRole ? humanize(c.vendorRole) : null, c.company, !c.company && c.neighborhood ? c.neighborhood : null].filter(Boolean).join(' · ') || formatPhone(c.phone);
  }
  const t = lastTouch(c);
  const when = t ? (t.getTime() > Date.now() ? 'today' : relativeTime(t)) : null;
  return [TYPE_LABEL[c.type] || null, c.neighborhood || c.city || null, when].filter(Boolean).join(' · ') || formatPhone(c.phone);
}

export const money = (n) => (n ? moneyCompact(n) : '—');

export function copyText(t) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(t));
    const ta = document.createElement('textarea');
    ta.value = String(t); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  } catch { /* ignore */ }
  return Promise.resolve();
}

// RE money input parse (spec §8.7): bare < 100 = millions, 100–9,999 = thousands.
export function parseMoneyInput(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|m|mm|b)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'k') return Math.round(n * 1e3);
  if (m[2] === 'm' || m[2] === 'mm') return Math.round(n * 1e6);
  if (m[2] === 'b') return Math.round(n * 1e9);
  if (n < 100) return Math.round(n * 1e6);
  if (n < 10000) return Math.round(n * 1e3);
  return Math.round(n);
}

// ── ActionSheet (iOS) ────────────────────────────────────────────────────
export function ActionSheet({ open, title, actions = [], onClose }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { if (open) setLeaving(false); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  function close(after) {
    setLeaving(true);
    setTimeout(() => { onClose?.(); after?.(); }, 190);
  }
  return createPortal(
    <div className={`kc-as ${leaving ? 'kc-as--out' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="kc-as-stack">
        <div className="kc-as-group km-lg km-lg--menu">
          {title ? <div className="kc-as-title">{title}</div> : null}
          {actions.filter(Boolean).map((a) => (
            <button key={a.label} type="button" className={`kc-as-row ${a.danger ? 'kc-as-row--danger' : ''}`} onClick={() => close(a.onClick)}>
              {a.icon ? <Icon name={a.icon} size={19} stroke={1.9} /> : null}
              {a.label}
            </button>
          ))}
        </div>
        <div className="kc-as-group km-lg km-lg--menu">
          <button type="button" className="kc-as-row" style={{ fontWeight: 600 }} onClick={() => close()}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── SwipeRow: swipe left to reveal actions (axis lock after 7px) ─────────
//   actions: [{ label, icon, color, onClick }] — widths 84 (tiles) / 88 (rows)
export function SwipeRow({ id, openId, setOpenId, actions, width = 88, fullSwipe, children, radius = 0, bg = 'var(--bg)' }) {
  const [drag, setDrag] = useState(null);
  const start = useRef(null);
  const suppress = useRef(false);
  const open = openId === id;
  const reveal = width * actions.length;
  const base = open ? -reveal : 0;
  const x = drag !== null ? drag : base;

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('[data-hscroll]')) return;
    start.current = { x: e.clientX, y: e.clientY, axis: null, base, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (s.axis === 'x') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    }
    if (s.axis !== 'x') return;
    setDrag(Math.max(-reveal * (fullSwipe ? 1.9 : 1.25), Math.min(0, s.base + dx)));
  };
  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== 'x') { setDrag(null); return; }
    suppress.current = true;
    setTimeout(() => { suppress.current = false; }, 140);
    const settled = drag !== null ? drag : base;
    setDrag(null);
    if (fullSwipe && settled <= -reveal * 1.7) { setOpenId(null); fullSwipe(); return; }
    if (settled <= -reveal * 0.45) setOpenId(id);
    else setOpenId((cur) => (cur === id ? null : cur));
  };
  const onClickCapture = (e) => {
    if (suppress.current) { e.stopPropagation(); e.preventDefault(); return; }
    if (open) { e.stopPropagation(); e.preventDefault(); setOpenId(null); }
  };
  return (
    <div className="kc-swipe" style={{ borderRadius: radius }}>
      <div className="kc-swipe2-acts" style={{ opacity: x < -8 ? 1 : 0, transition: 'opacity .18s ease' }}>
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={() => { setOpenId(null); a.onClick(); }} style={{ width, background: a.bg || 'transparent', color: a.color || '#fff' }}>
            {a.icon ? <Icon name={a.icon} size={20} stroke={2} /> : null}
            <span style={{ fontSize: a.icon ? 11 : 13.5, fontWeight: a.icon ? 700 : 600 }}>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        className="kc-swipe-body"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{ transform: `translate3d(${x}px,0,0)`, transition: drag !== null ? 'none' : 'transform .28s var(--km-nav-ease)', background: bg, borderRadius: radius }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Segmented (forms) ────────────────────────────────────────────────────
export function Seg({ value, onChange, options, style }) {
  return (
    <div className="kc-seg" role="tablist" style={style}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'kc-on' : ''} onClick={() => onChange(o.value)} aria-selected={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── ChipInput: multi-value text chips with suggestions ───────────────────
export function ChipInput({ value = [], onChange, suggestions = [], placeholder = 'Add…', max = 40, format }) {
  const [text, setText] = useState('');
  const set = new Set(value.map((v) => v.toLowerCase()));
  const add = (raw) => {
    const v = String(raw || '').trim().replace(/,$/, '');
    if (!v || set.has(v.toLowerCase()) || value.length >= max) { setText(''); return; }
    onChange([...value, format ? format(v) : v]);
    setText('');
  };
  const q = text.trim().toLowerCase();
  const sugs = suggestions.filter((s) => !set.has(String(s).toLowerCase()) && (!q || String(s).toLowerCase().includes(q))).slice(0, q ? 8 : 10);
  return (
    <div>
      <div className="kc-chipinput" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
        {value.map((v) => (
          <span key={v} className="kc-ci-chip">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)); }} style={{ display: 'flex', padding: 3, color: 'inherit' }}>
              <Icon name="x" size={12} stroke={2.4} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) add(v); else setText(v); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(text); }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (text.trim()) add(text); }}
          enterKeyHint="done"
        />
      </div>
      {sugs.length ? (
        <div className="kc-sugs">
          {sugs.map((s) => (
            <button key={s} type="button" className="kc-sug km-press" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── MoneyInput: "8.5" → $8,500,000 (RE rule). Compact when idle ($8.5M),
// full digits while editing, live hint of what the shorthand means.
export function MoneyInput({ value, onChange, placeholder = '$', style, inputStyle, label }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const parsed = parseMoneyInput(text);
  const idle = value != null && value !== '' ? moneyCompact(Number(value)).replace(/^\$/, '') : '';
  return (
    <label className="km-field" style={style}>
      {label ? <span className="km-field-label">{label}</span> : null}
      <span style={{ position: 'relative', display: 'block' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)', fontSize: 15 }}>$</span>
        <input
          className="km-input"
          inputMode="decimal"
          value={focused ? text : idle}
          placeholder={placeholder}
          style={{ paddingLeft: 26, paddingRight: focused && parsed ? 66 : 14, ...inputStyle }}
          onFocus={(e) => {
            setFocused(true);
            setText(value != null && value !== '' ? Number(value).toLocaleString('en-US') : '');
            const t = e.target;
            setTimeout(() => { try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ } }, 300);
          }}
          onChange={(e) => { setText(e.target.value); onChange(parseMoneyInput(e.target.value)); }}
          onBlur={() => setFocused(false)}
        />
        {focused && parsed ? (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12.5, fontWeight: 600, color: 'var(--bright)', pointerEvents: 'none' }}>{moneyCompact(parsed)}</span>
        ) : null}
      </span>
    </label>
  );
}

// ── Section title with optional action ─────────────────────────────────────
export function SectionTitle({ children, action, style }) {
  return (
    <div className="kc-section-title" style={style}>
      <h3>{children}</h3>
      {action || null}
    </div>
  );
}

export function InfoRow({ label, value, action, selectable = true }) {
  if (value == null || value === '') return null;
  return (
    <div className="kc-info">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kc-info-l">{label}</div>
        <div className={`kc-info-v ${selectable ? 'km-selectable' : ''}`}>{value}</div>
      </div>
      {action || null}
    </div>
  );
}
