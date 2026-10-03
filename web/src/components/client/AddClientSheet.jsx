// AddClientSheet — "New client" (overlay `newClient`, prefill via nav.newClient({...})).
// Name · phone (live-formatted, duplicate detection) · email · kind · type/role ·
// lead source · referred by · tags · rating · notes · optional "Ask Serena".
// Saves → opens the new client's card.
import { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/clients.css';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { TextInput, TextArea, Stars, Switch, ChipSelect } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { formatPhoneInput } from '../../lib/format';
import { createClient, lookupClient, clientFacets } from '../../api/clients';
import ClientPicker from './ClientPicker';
import { clientStore } from './clientStore';
import { CLIENT_TYPES, LEAD_SOURCES, VENDOR_ROLES, PARTNER_ROLES, Seg, ChipInput, displayName } from './clientKit';
import { useAssistant } from '../../hooks/useAssistant';

const KIND_OPTS = [{ value: 'client', label: 'Client' }, { value: 'partner', label: 'Partner' }, { value: 'vendor', label: 'Vendor' }];

function splitName(s) {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function useDupe(field, value, minLen) {
  const [hit, setHit] = useState(null);
  useEffect(() => {
    const v = String(value || '').trim();
    const ok = field === 'phone' ? v.replace(/\D/g, '').length >= minLen : v.includes('@') && v.length >= minLen;
    if (!ok) { setHit(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      lookupClient({ [field]: v }).then((r) => { if (alive) setHit(r.client || null); }).catch(() => {});
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [field, value, minLen]);
  return hit;
}

function DupeNote({ client, close }) {
  if (!client) return null;
  return (
    <div className="kc-dupe">
      <Avatar name={displayName(client)} seed={client.id} src={client.avatarUrl} size={28} />
      <span style={{ flex: 1, minWidth: 0 }}><b>{displayName(client)}</b> already uses this.</span>
      <button type="button" className="kc-link" onClick={() => { clientStore.seed(client); close(); setTimeout(() => nav.openClient(client.id), 60); }}>Open</button>
    </div>
  );
}

export default function AddClientSheet({ prefill = {}, onClose }) {
  const { name: assistant } = useAssistant();
  const initial = useMemo(() => {
    const n = prefill.name ? splitName(prefill.name) : {};
    return {
      contactKind: ['client', 'partner', 'vendor'].includes(prefill.contactKind) ? prefill.contactKind : 'client',
      firstName: prefill.firstName ?? n.firstName ?? '',
      lastName: prefill.lastName ?? n.lastName ?? '',
      company: prefill.company || '',
      phone: prefill.phone ? formatPhoneInput(prefill.phone) : '',
      email: prefill.email || '',
      type: prefill.type || 'buyer',
      vendorRole: prefill.vendorRole || '',
      leadSource: prefill.leadSource || '',
      tags: prefill.tags || [],
      rating: prefill.rating || 0,
      isWhale: !!prefill.isWhale,
      neighborhood: prefill.neighborhood || '',
      notes: prefill.notes || '',
      jobTitle: '',
      birthday: '',
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [referredBy, setReferredBy] = useState(null);
  const [pickRef, setPickRef] = useState(false);
  const [more, setMore] = useState(false);
  const [serena, setSerena] = useState('');
  const [facets, setFacets] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => { clientFacets().then(setFacets).catch(() => {}); }, []);

  const phoneDupe = useDupe('phone', f.phone, 10);
  const emailDupe = useDupe('email', f.email, 6);

  const isClient = f.contactKind === 'client';
  const roles = f.contactKind === 'vendor' ? VENDOR_ROLES : PARTNER_ROLES;
  const roleFacets = ((f.contactKind === 'vendor' ? facets?.vendorRoles : facets?.partnerRoles) || []).map((x) => x.value);
  const roleOptions = [...new Set([...roles, ...roleFacets.map((r) => r.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase()))])].slice(0, 16);
  const tagSugs = (facets?.tags || []).map((t) => t.value).slice(0, 12);
  const hoodSugs = (facets?.neighborhoods || []).map((t) => t.value);
  const sourceOptions = [...new Set([...LEAD_SOURCES, ...((facets?.leadSources || []).map((x) => x.value))])].slice(0, 16);
  const nounLabel = KIND_OPTS.find((k) => k.value === f.contactKind)?.label || 'Client';

  const canSave = !!(f.firstName.trim() || f.lastName.trim() || f.company.trim()) && !saving;

  const save = async (close) => {
    if (savingRef.current) return;
    if (!f.firstName.trim() && !f.lastName.trim() && !f.company.trim()) { setError('A first or last name is required to save.'); return; }
    savingRef.current = true;
    setSaving(true); setError(null);
    const body = {
      contactKind: f.contactKind,
      firstName: f.firstName.trim(), lastName: f.lastName.trim(),
      company: f.company.trim() || null, jobTitle: f.jobTitle.trim() || null,
      phone: f.phone || null, email: f.email.trim() || null,
      type: isClient ? f.type : (f.contactKind === 'vendor' ? 'sphere' : 'sphere'),
      vendorRole: !isClient && f.vendorRole ? f.vendorRole.trim().toLowerCase().replace(/[\s-]+/g, '_') : null,
      leadSource: f.leadSource || (referredBy ? 'Referral' : null),
      referredById: referredBy?.id || null,
      tags: f.tags, rating: f.rating, isWhale: f.isWhale,
      neighborhood: f.neighborhood.trim() || null,
      birthday: f.birthday || null,
      notes: f.notes.trim() || null,
      status: isClient ? 'lead' : 'active',
    };
    if (!f.firstName.trim() && !f.lastName.trim()) body.displayName = f.company.trim();
    try {
      const r = await createClient(body);
      clientStore.seed(r.client);
      if (r.duplicate) toast(`${displayName(r.client)} already exists — opening their card`);
      else toast.success(`${displayName(r.client)} added`);
      close();
      setTimeout(() => nav.openClient(r.client.id), 60);
      if (serena.trim() && !r.duplicate) {
        setTimeout(() => nav.openSerena('chat', `I just added a new client: ${displayName(r.client)} (client id: ${r.client.id}). ${serena.trim()}`), 700);
      }
    } catch (e) {
      setError(e.message || 'Couldn’t save — try again.');
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`New ${nounLabel.toLowerCase()}`} maxHeight="88%">
      {({ close }) => (
        <div style={{ paddingBottom: 8 }}>
          <Seg value={f.contactKind} onChange={(v) => set({ contactKind: v, vendorRole: '' })} options={KIND_OPTS} />

          <div className="kc-grid2" style={{ marginTop: 14 }}>
            <TextInput label="First name" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} autoFocus autoComplete="off" autoCapitalize="words" />
            <TextInput label="Last name" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="off" autoCapitalize="words" />
          </div>
          {!isClient ? (
            <TextInput style={{ marginTop: 10 }} label="Company" value={f.company} onChange={(e) => set({ company: e.target.value })} placeholder={f.contactKind === 'vendor' ? 'Coastal Title Group' : 'Douglas Elliman'} />
          ) : null}

          <div style={{ marginTop: 10 }}>
            <TextInput label="Mobile" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: formatPhoneInput(e.target.value) })} placeholder="305-555-0142" />
            <DupeNote client={phoneDupe} close={close} />
          </div>
          <div style={{ marginTop: 10 }}>
            <TextInput label="Email" type="email" inputMode="email" autoCapitalize="off" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@domain.com" />
            {emailDupe && emailDupe.id !== phoneDupe?.id ? <DupeNote client={emailDupe} close={close} /> : null}
          </div>

          <div className="kc-form-sec">
            <span className="kc-eyebrow">{isClient ? 'Type' : 'Role'}</span>
            {isClient ? (
              <ChipSelect multi={false} options={CLIENT_TYPES} value={[f.type]} onChange={(v) => set({ type: v[0] || 'buyer' })} />
            ) : (
              <>
                <ChipSelect multi={false} options={roleOptions} value={f.vendorRole ? [roleOptions.find((r) => r.toLowerCase() === f.vendorRole.toLowerCase()) || f.vendorRole] : []} onChange={(v) => set({ vendorRole: v[0] || '' })} />
                <TextInput style={{ marginTop: 8 }} value={roleOptions.some((r) => r.toLowerCase() === f.vendorRole.toLowerCase()) ? '' : f.vendorRole} onChange={(e) => set({ vendorRole: e.target.value })} placeholder={f.contactKind === 'vendor' ? 'Other role (e.g. Pool contractor)' : 'Other role (e.g. Yacht broker)'} />
              </>
            )}
          </div>

          <div className="kc-form-sec">
            <span className="kc-eyebrow">Lead source</span>
            <ChipSelect multi={false} options={sourceOptions} value={f.leadSource ? [f.leadSource] : []} onChange={(v) => set({ leadSource: v[0] || '' })} />
          </div>

          <div className="kc-form-sec">
            <span className="kc-eyebrow">Referred by</span>
            {referredBy ? (
              <div className="kc-dupe" style={{ background: 'var(--tint)', borderColor: 'rgba(var(--accent-rgb), 0.35)' }}>
                <Avatar name={displayName(referredBy)} seed={referredBy.id} src={referredBy.avatarUrl} size={28} />
                <span style={{ flex: 1, fontWeight: 500 }}>{displayName(referredBy)}</span>
                <button type="button" onClick={() => setReferredBy(null)} aria-label="Clear referral" style={{ display: 'flex', color: 'var(--faint)' }}><Icon name="x" size={16} /></button>
              </div>
            ) : (
              <button type="button" className="km-pill km-press" onClick={() => setPickRef(true)}><Icon name="userPlus" size={14} /> Choose who referred them</button>
            )}
          </div>

          <div className="kc-form-sec" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <span className="kc-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Rating</span>
              <Stars value={f.rating} onChange={(v) => set({ rating: v })} size={22} gap={4} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="crown" size={15} color="var(--text)" /> Whale</span>
              <Switch checked={f.isWhale} onChange={(v) => set({ isWhale: v })} label="Whale" />
            </div>
          </div>

          <div className="kc-form-sec">
            <span className="kc-eyebrow">Neighborhood</span>
            <ChipInput value={f.neighborhood ? [f.neighborhood] : []} onChange={(v) => set({ neighborhood: v[v.length - 1] || '' })} suggestions={hoodSugs.slice(0, 10)} placeholder="Where they live" max={1} />
          </div>

          <div className="kc-form-sec">
            <span className="kc-eyebrow">Tags</span>
            <ChipInput value={f.tags} onChange={(v) => set({ tags: v })} suggestions={tagSugs} placeholder="Waterfront, Relocation, VIP…" />
          </div>

          <button type="button" className="kc-link" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setMore((m) => !m)}>
            <Icon name={more ? 'chevronUp' : 'chevronDown'} size={15} /> {more ? 'Fewer details' : 'More details'}
          </button>
          {more ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {isClient ? <TextInput label="Company" value={f.company} onChange={(e) => set({ company: e.target.value })} /> : null}
              <TextInput label="Title" value={f.jobTitle} onChange={(e) => set({ jobTitle: e.target.value })} placeholder="Founder & CEO" />
              <TextInput label="Birthday" type="date" value={f.birthday} onChange={(e) => set({ birthday: e.target.value })} />
              <TextArea label="Notes" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="How you met, what they want, anything worth remembering" />
            </div>
          ) : null}

          <div style={{ marginTop: 16, borderRadius: 'var(--r-card)', padding: 14, background: 'var(--glass-fill)', border: 'var(--hairline) solid var(--hl-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="sparkle" size={14} color="var(--violet)" stroke={2.2} />
              <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: 1.2, color: 'var(--hl-ink)' }}>ASK {String(assistant || 'your assistant').toUpperCase()}</span>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>— optional</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)', margin: '5px 0 8px' }}>Hand {assistant} something to do the second you save.</div>
            <textarea className="km-input" rows={2} value={serena} onChange={(e) => setSerena(e.target.value)} placeholder="“Text her a welcome” · “Set a showing Saturday” · “Remind me to call Friday”" style={{ minHeight: 64 }} />
          </div>

          {error ? <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13.5, background: 'rgba(255,59,48,.1)', border: '1px solid rgba(255,59,48,.3)', color: '#FF6B5E' }}>{error}</div> : null}

          <button type="button" className="km-btn km-btn--block km-btn--lg" style={{ marginTop: 18 }} disabled={!canSave} onClick={() => save(close)}>
            {saving ? 'Saving…' : `Add ${nounLabel.toLowerCase()}`}
          </button>

          <ClientPicker open={pickRef} onClose={() => setPickRef(false)} onPick={(c) => setReferredBy(c)} title="Referred by" allowCreate={false} />
        </div>
      )}
    </Sheet>
  );
}
