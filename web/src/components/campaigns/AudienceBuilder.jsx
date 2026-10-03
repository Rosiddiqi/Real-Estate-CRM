// AudienceBuilder — step 1 of the campaign builder. Describe them in plain
// English (AI/keywords → filters) or build the segment directly: who (groups),
// place & price (neighborhoods, buyers searching in X / price band, owners in
// X), relationship (rating, whales, past clients, sphere), types & tags.
// Live count + preview avatars; opted-out / blocked / do-not-text / no-phone
// are always excluded, and anyone can be excluded by hand.
// Fair Housing: only property attributes, price, places and relationships.
import { useMemo, useState } from 'react';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Stars, Switch, Spinner } from '../ui/kit';
import { Eyebrow, ComposerField, SparkButton, MonoLabel } from './kit';

const GROUPS = [
  ['everyone', 'Everyone'], ['buyers', 'Buyers'], ['sellers', 'Sellers'], ['owners', 'Homeowners'], ['investors', 'Investors'],
  ['renters', 'Renters'], ['sphere', 'Sphere'], ['past_clients', 'Past clients'], ['whales', 'Whales'], ['leads', 'Leads'],
];

function toggle(list, v) { const s = new Set(list || []); if (s.has(v)) s.delete(v); else s.add(v); return [...s]; }
function toM(n) { return n ? String(Math.round((n / 1e6) * 100) / 100) : ''; }
function fromM(s) { const v = parseFloat(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) : null; }

function Pills({ options, value, onToggle, limit = 14, color }) {
  const [all, setAll] = useState(false);
  const list = all ? options : options.slice(0, limit);
  const sel = new Set(value || []);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {list.map((o) => {
        const on = sel.has(o.value);
        return (
          <button key={o.value} type="button" className={`km-pill km-press ${on ? 'km-pill--on' : ''}`} onClick={() => onToggle(o.value)} style={{ height: 32, ...(on && color ? { color } : null) }}>
            {on ? <Icon name="check" size={12} stroke={2.4} /> : null}
            {o.label || o.value}
            {o.count != null ? <span style={{ fontSize: 11, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{o.count}</span> : null}
          </button>
        );
      })}
      {options.length > limit ? (
        <button type="button" className="km-pill km-press" onClick={() => setAll((v) => !v)} style={{ height: 32, borderStyle: 'dashed', color: 'var(--bright)' }}>
          {all ? 'Fewer' : `+${options.length - limit} more`}
        </button>
      ) : null}
    </div>
  );
}

function RefineCard({ title, icon, summary, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="kp-section">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', textAlign: 'left' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--tint)', color: 'var(--bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={15} stroke={2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{title}</span>
          <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: summary ? 'var(--bright)' : 'var(--faint)', marginTop: 1 }}>{summary || 'Any'}</span>
        </span>
        <Icon name="chevronDown" size={15} color="var(--faint)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s var(--km-ease)' }} />
      </button>
      {open ? <div className="kp-step-in" style={{ padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div> : null}
    </div>
  );
}

function money(n) { return n >= 1e6 ? `$${Math.round((n / 1e6) * 100) / 100}M` : `$${Math.round(n / 1e3)}K`; }

export default function AudienceBuilder({ name, onName, audience, onChange, options, preview, previewLoading, onFind, finding, findText, onFindText }) {
  const a = audience || {};
  const [showAll, setShowAll] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const set = (patch) => onChange({ ...a, ...patch });
  const opts = options || { neighborhoods: [], ownerNeighborhoods: [], searchNeighborhoods: [], tags: [], types: [], statuses: [] };
  const people = (preview && preview.people) || [];
  const count = (preview && preview.count) || 0;
  const excl = (preview && preview.excluded) || {};
  const excludedPeople = (preview && preview.excludedPeople) || [];
  const exclBits = [
    excl.optedOut ? `${excl.optedOut} opted out` : null,
    excl.doNotText ? `${excl.doNotText} do-not-text` : null,
    excl.blocked ? `${excl.blocked} blocked` : null,
    excl.noPhone ? `${excl.noPhone} no phone` : null,
    excl.manual ? `${excl.manual} excluded by you` : null,
  ].filter(Boolean);

  const buyersIn = a.buyersIn || null;
  const ownersIn = a.ownersIn || null;
  const placeSummary = [
    (a.neighborhoods || []).length ? a.neighborhoods.join(', ') : null,
    buyersIn ? `Searching${buyersIn.neighborhoods && buyersIn.neighborhoods.length ? ` ${buyersIn.neighborhoods.join(', ')}` : ''}${buyersIn.priceMin || buyersIn.priceMax ? ` ${buyersIn.priceMin ? money(buyersIn.priceMin) : ''}–${buyersIn.priceMax ? money(buyersIn.priceMax) : ''}` : ''}` : null,
    ownersIn ? `Owners${ownersIn.neighborhoods && ownersIn.neighborhoods.length ? ` in ${ownersIn.neighborhoods.join(', ')}` : ''}` : null,
  ].filter(Boolean).join(' · ');
  const relSummary = [a.minRating ? `${a.minRating}★+` : null, a.whales ? 'Whales' : null, a.pastClients ? 'Past clients' : null, a.sphere ? 'Sphere' : null].filter(Boolean).join(' · ');
  const typeSummary = [...(a.types || []).map((t) => t.replace('_', '/')), ...(a.statuses || []).map((s) => s.replace('_', ' ')), ...(a.tags || []).map((t) => `#${t}`)].join(' · ');
  const visible = showAll ? people : people.slice(0, 8);
  const stack = useMemo(() => people.slice(0, 7), [people]);

  return (
    <div>
      <Eyebrow blue>Call it something</Eyebrow>
      <input className="kp-input" value={name} onChange={(e) => onName(e.target.value.slice(0, 120))} placeholder={'"Grove buyers, new listing", "Fall open house"…'} style={{ marginTop: 10 }} aria-label="Campaign name" />

      <Eyebrow blue icon="users" style={{ marginTop: 22 }}>Who should get this</Eyebrow>
      <ComposerField
        style={{ marginTop: 10 }}
        rows={2}
        value={findText}
        onChange={onFindText}
        placeholder={'Describe them: "buyers searching the Grove at $4-8M"'}
        action={<SparkButton label={finding ? 'Finding…' : 'Find'} disabled={!String(findText || '').trim()} busy={finding} onClick={onFind} />}
      />
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 7, lineHeight: 1.45 }}>
        Describe them by what they own, what they’re searching for, price, place, or how you know them. Fair Housing: KeyMatch never targets by family status, age, religion, origin or similar.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
        {GROUPS.map(([v, label]) => {
          const on = (a.groups || []).includes(v);
          return (
            <button key={v} type="button" className={`km-pill km-press ${on ? 'km-pill--on' : ''}`} style={{ height: 34 }}
              onClick={() => set({ groups: v === 'everyone' ? (on ? [] : ['everyone']) : toggle((a.groups || []).filter((g) => g !== 'everyone'), v) })}>
              {on ? <Icon name="check" size={12} stroke={2.4} /> : null}{label}
            </button>
          );
        })}
      </div>

      {/* Live count */}
      <div className="kp-pop-in" style={{ marginTop: 14, borderRadius: 14, padding: '13px 15px', background: 'rgba(var(--accent-rgb), 0.08)', border: '1px solid rgba(var(--accent-rgb), 0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="km-num" style={{ fontSize: 32, lineHeight: 1 }}>{count}</span>
          <span style={{ fontSize: 13.5, color: 'var(--dim)' }}>will receive</span>
          {previewLoading ? <Spinner size={14} color="var(--bright)" /> : null}
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex' }}>
            {stack.map((p, i) => <Avatar key={p.id} name={p.name} seed={p.id} src={p.avatarUrl} size={28} style={{ marginLeft: i ? -9 : 0, border: '2px solid var(--bg)', zIndex: 10 - i }} />)}
          </span>
        </div>
        {exclBits.length ? (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 8, fontSize: 12, color: 'var(--faint)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Icon name="shield" size={12} /> Never texted: {exclBits.join(' · ')}
          </div>
        ) : null}
      </div>

      <Eyebrow icon="sliders" style={{ marginTop: 22 }}>Refine</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        <RefineCard title="Place & price" icon="mapPin" summary={placeSummary} defaultOpen={!!placeSummary}>
          <div>
            <MonoLabel style={{ marginBottom: 8 }}>Connected to (lives, owns or searching)</MonoLabel>
            <Pills options={opts.neighborhoods} value={a.neighborhoods} onToggle={(v) => set({ neighborhoods: toggle(a.neighborhoods, v) })} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <MonoLabel>Buyers with active searches in</MonoLabel>
              <Switch checked={!!buyersIn} onChange={(on) => set({ buyersIn: on ? { enabled: true, neighborhoods: [], priceMin: null, priceMax: null } : null })} label="Buyers with active searches" />
            </div>
            {buyersIn ? (
              <>
                <Pills options={opts.searchNeighborhoods} value={buyersIn.neighborhoods} onToggle={(v) => set({ buyersIn: { ...buyersIn, enabled: true, neighborhoods: toggle(buyersIn.neighborhoods, v) } })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <input className="kp-input" inputMode="decimal" placeholder="Min $M" defaultValue={toM(buyersIn.priceMin)} onBlur={(e) => set({ buyersIn: { ...buyersIn, enabled: true, priceMin: fromM(e.target.value) } })} aria-label="Minimum price in millions" />
                  <span style={{ color: 'var(--faint)' }}>–</span>
                  <input className="kp-input" inputMode="decimal" placeholder="Max $M" defaultValue={toM(buyersIn.priceMax)} onBlur={(e) => set({ buyersIn: { ...buyersIn, enabled: true, priceMax: fromM(e.target.value) } })} aria-label="Maximum price in millions" />
                </div>
              </>
            ) : null}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <MonoLabel>Owners in</MonoLabel>
              <Switch checked={!!ownersIn} onChange={(on) => set({ ownersIn: on ? { enabled: true, neighborhoods: [] } : null })} label="Owners in a neighborhood" />
            </div>
            {ownersIn ? <Pills options={opts.ownerNeighborhoods} value={ownersIn.neighborhoods} onToggle={(v) => set({ ownersIn: { ...ownersIn, enabled: true, neighborhoods: toggle(ownersIn.neighborhoods, v) } })} /> : null}
          </div>
        </RefineCard>

        <RefineCard title="Relationship" icon="star" summary={relSummary} defaultOpen={!!relSummary}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14 }}>Minimum rating</span>
            <Stars value={a.minRating || 0} onChange={(n) => set({ minRating: n })} size={20} />
          </div>
          {[['whales', 'Whales only', 'Top clients and $10M+ lifetime'], ['pastClients', 'Past clients only', 'Closed with you before'], ['sphere', 'Sphere only', 'Friends, family, your circle']].map(([k, label, sub]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14 }}>{label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--faint)' }}>{sub}</span>
              </span>
              <Switch checked={!!a[k]} onChange={(v) => set({ [k]: v })} label={label} />
            </div>
          ))}
        </RefineCard>

        <RefineCard title="Types & tags" icon="filter" summary={typeSummary} defaultOpen={!!typeSummary}>
          <div><MonoLabel style={{ marginBottom: 8 }}>Client type</MonoLabel><Pills options={opts.types.filter((t) => t.count)} value={a.types} onToggle={(v) => set({ types: toggle(a.types, v) })} /></div>
          <div><MonoLabel style={{ marginBottom: 8 }}>Status</MonoLabel><Pills options={opts.statuses} value={a.statuses} onToggle={(v) => set({ statuses: toggle(a.statuses, v) })} /></div>
          {opts.tags.length ? <div><MonoLabel style={{ marginBottom: 8 }}>Tags</MonoLabel><Pills options={opts.tags.map((t) => ({ ...t, label: `#${t.value}` }))} value={a.tags} onToggle={(v) => set({ tags: toggle(a.tags, v) })} /></div> : null}
        </RefineCard>
      </div>

      {people.length ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '24px 2px 2px' }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>Who gets it</span>
            <MonoLabel>All {count}</MonoLabel>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--faint)', margin: '0 2px 8px' }}>Tap Exclude on anyone you don’t want to text.</div>
          <div className="kp-list">
            {visible.map((p) => (
              <div key={p.id} className="kp-li">
                <Avatar name={p.name} seed={p.id} src={p.avatarUrl} size={34} channel={p.channel} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                  {p.headline ? <span className="km-truncate" style={{ display: 'block', fontSize: 12, color: 'var(--faint)' }}>{p.headline}</span> : null}
                </span>
                <button type="button" className="km-pill km-press" style={{ height: 30, padding: '0 11px', fontSize: 12.5 }} onClick={() => set({ excludedIds: [...(a.excludedIds || []), p.id] })}>
                  <Icon name="x" size={11} /> Exclude
                </button>
              </div>
            ))}
          </div>
          {people.length > 8 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: 'var(--bright)' }}>
              {showAll ? 'Show fewer' : `Show all ${people.length}`}
            </button>
          ) : null}
        </>
      ) : null}

      {excludedPeople.length ? (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={() => setShowExcluded((v) => !v)} className="kp-mono" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Excluded by you · {excludedPeople.length}
            <Icon name="chevronRight" size={11} style={{ transform: showExcluded ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }} />
          </button>
          {showExcluded ? (
            <div className="kp-list kp-step-in" style={{ marginTop: 8 }}>
              {excludedPeople.map((p) => (
                <div key={p.id} className="kp-li" style={{ opacity: 0.7 }}>
                  <Avatar name={p.name} seed={p.id} size={30} />
                  <span className="km-truncate" style={{ flex: 1, fontSize: 14, textDecoration: 'line-through', color: 'var(--dim)' }}>{p.name}</span>
                  <button type="button" className="km-pill km-press" style={{ height: 30, fontSize: 12.5, color: 'var(--green)' }} onClick={() => set({ excludedIds: (a.excludedIds || []).filter((x) => x !== p.id) })}>Add back</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
