// EditClientSheet — every client field in one keyboard-safe sheet, opened
// scrolled to the section you tapped. Optimistic: the card + every list
// repaint the moment you tap Save; the PATCH reconciles (rollback on error).
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { TextInput, TextArea, Stars, Switch, ChipSelect } from '../ui/kit';
import { toast } from '../ui/toast';
import { formatPhoneInput, formatPhone } from '../../lib/format';
import { updateClient, clientFacets } from '../../api/clients';
import { uploadFiles } from '../../api/system';
import { mediaUrl } from '../../api/client';
import ClientPicker from './ClientPicker';
import { clientStore } from './clientStore';
import {
  Seg, ChipInput, MoneyInput, CLIENT_TYPES, STATUSES, LEAD_SOURCES, VENDOR_ROLES, PARTNER_ROLES, PERSONAL_FIELDS,
  FINANCING, TIMELINES, displayName,
} from './clientKit';

const KIND_OPTS = [{ value: 'client', label: 'Client' }, { value: 'partner', label: 'Partner' }, { value: 'vendor', label: 'Vendor' }];
const CHANNELS = [{ value: 'imessage', label: 'iMessage' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }, { value: 'call', label: 'Call' }];

function toForm(c) {
  const p = (c.personal && typeof c.personal === 'object') ? c.personal : {};
  return {
    firstName: c.firstName || '', lastName: c.lastName || '', company: c.company || '', jobTitle: c.jobTitle || '',
    contactKind: c.contactKind || 'client', type: c.type || 'buyer', vendorRole: c.vendorRole || '',
    phone: c.phone ? formatPhone(c.phone) : '', phoneAlt: c.phoneAlt ? formatPhone(c.phoneAlt) : '', email: c.email || '', emailAlt: c.emailAlt || '',
    preferredChannel: c.preferredChannel || '', street: c.street || '', unit: c.unit || '', city: c.city || '', state: c.state || '', zip: c.zip || '',
    neighborhood: c.neighborhood || '', birthday: c.birthday && !c.birthday.startsWith('--') ? c.birthday : '', birthdayMD: c.birthday && c.birthday.startsWith('--') ? c.birthday.slice(2) : '',
    personal: Object.fromEntries(PERSONAL_FIELDS.map((f) => [f.key, Array.isArray(p[f.key]) ? p[f.key].join(', ') : (p[f.key] || '')])),
    financing: c.financing || '', preApprovalAmount: c.preApprovalAmount ?? null, preApprovalExpires: c.preApprovalExpires ? String(c.preApprovalExpires).slice(0, 10) : '',
    lenderName: c.lenderName || '', purchasePower: c.purchasePower ?? null, timeline: c.timeline || '', motivation: c.motivation || '',
    status: c.status || 'lead', leadSource: c.leadSource || '', tags: c.tags || [], rating: c.rating || 0, isWhale: !!c.isWhale,
    referredBy: c.referredBy || null, avatarUrl: c.avatarUrl || '',
  };
}

export default function EditClientSheet({ client, section, open, onClose, onSaved }) {
  const initial = useMemo(() => toForm(client), [client.id, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [facets, setFacets] = useState(null);
  const [pickRef, setPickRef] = useState(false);
  const [uploading, setUploading] = useState(false);
  const refs = useRef({});
  const fileRef = useRef(null);
  const closeRef = useRef(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setP = (k, v) => setF((x) => ({ ...x, personal: { ...x.personal, [k]: v } }));

  useEffect(() => { if (open) setF(toForm(client)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !facets) clientFacets().then(setFacets).catch(() => {}); }, [open, facets]);
  useEffect(() => {
    if (!open || !section) return;
    const t = setTimeout(() => { try { refs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* noop */ } }, 420);
    return () => clearTimeout(t);
  }, [open, section]);

  const isClient = f.contactKind === 'client';
  const roleOptions = [...new Set([...(f.contactKind === 'vendor' ? VENDOR_ROLES : PARTNER_ROLES)])];

  const buildPatch = () => {
    const out = {};
    const simple = ['firstName', 'lastName', 'company', 'jobTitle', 'contactKind', 'type', 'email', 'emailAlt', 'preferredChannel', 'street', 'unit', 'city', 'state', 'zip', 'neighborhood',
      'financing', 'lenderName', 'timeline', 'motivation', 'status', 'leadSource', 'rating', 'isWhale', 'avatarUrl'];
    for (const k of simple) {
      const a = f[k]; const b = initial[k];
      if (a !== b) out[k] = typeof a === 'string' ? (a.trim() || (['firstName', 'lastName'].includes(k) ? '' : null)) : a;
    }
    if (f.vendorRole !== initial.vendorRole) out.vendorRole = f.vendorRole ? f.vendorRole.trim().toLowerCase().replace(/[\s-]+/g, '_') : null;
    if (f.phone !== initial.phone) out.phone = f.phone || null;
    if (f.phoneAlt !== initial.phoneAlt) out.phoneAlt = f.phoneAlt || null;
    if (f.preApprovalAmount !== initial.preApprovalAmount) out.preApprovalAmount = f.preApprovalAmount;
    if (f.purchasePower !== initial.purchasePower) out.purchasePower = f.purchasePower;
    if (f.preApprovalExpires !== initial.preApprovalExpires) out.preApprovalExpires = f.preApprovalExpires || null;
    const bday = f.birthday || (f.birthdayMD ? `--${f.birthdayMD}` : '');
    const bday0 = initial.birthday || (initial.birthdayMD ? `--${initial.birthdayMD}` : '');
    if (bday !== bday0) out.birthday = bday || null;
    if (JSON.stringify(f.tags) !== JSON.stringify(initial.tags)) out.tags = f.tags;
    const pp = {};
    for (const fld of PERSONAL_FIELDS) if ((f.personal[fld.key] || '') !== (initial.personal[fld.key] || '')) pp[fld.key] = f.personal[fld.key].trim() || null;
    if (Object.keys(pp).length) out.personal = pp;
    if ((f.referredBy?.id || null) !== (initial.referredBy?.id || null)) out.referredById = f.referredBy?.id || null;
    return out;
  };

  const save = async (close) => {
    if (!f.firstName.trim() && !f.lastName.trim() && !f.company.trim()) { toast.error('A first or last name is required to save.'); return; }
    const patch = buildPatch();
    close();
    if (!Object.keys(patch).length) return;
    const optimistic = { ...patch };
    if (patch.personal) optimistic.personal = { ...(client.personal || {}), ...Object.fromEntries(Object.entries(patch.personal).filter(([, v]) => v != null)) };
    if ('referredById' in patch) optimistic.referredBy = f.referredBy || null;
    if (patch.phone) optimistic.phone = patch.phone.replace(/\D/g, '').slice(-10);
    const undo = clientStore.patch(client.id, optimistic);
    try {
      const r = await updateClient(client.id, patch);
      clientStore.commit(r.client);
      onSaved?.();
    } catch (e) {
      undo();
      toast.error(`${e.message || 'Couldn’t save'} — your change was undone.`);
    }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try { const [up] = await uploadFiles([file]); if (up?.url) set({ avatarUrl: up.url }); } catch (err) { toast.error(err.message || 'Couldn’t upload'); }
    setUploading(false);
  };

  const sec = (key, title) => <span ref={(el) => { refs.current[key] = el; }} className="kc-eyebrow" style={{ display: 'block', margin: '22px 2px 10px' }}>{title}</span>;

  return (
    <Sheet open={open} onClose={onClose} title="Edit client" zIndex={450} maxHeight="90%" right={{ label: 'Save', onClick: () => closeRef.current && save(closeRef.current) }}>
      {({ close }) => { closeRef.current = close; return (
        <div style={{ paddingBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }} ref={(el) => { refs.current.identity = el; }}>
            <button type="button" onClick={() => fileRef.current?.click()} className="km-press" style={{ position: 'relative' }} aria-label="Change photo">
              <Avatar name={displayName({ ...client, firstName: f.firstName, lastName: f.lastName })} seed={client.id} src={f.avatarUrl ? mediaUrl(f.avatarUrl) : undefined} size={64} />
              <span style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>
                <Icon name={uploading ? 'refresh' : 'camera'} size={12} stroke={2.2} />
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
            <div style={{ flex: 1 }}><Seg value={f.contactKind} onChange={(v) => set({ contactKind: v })} options={KIND_OPTS} /></div>
          </div>

          <div className="kc-grid2" style={{ marginTop: 14 }}>
            <TextInput label="First name" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
            <TextInput label="Last name" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </div>
          <div className="kc-grid2" style={{ marginTop: 10 }}>
            <TextInput label="Company" value={f.company} onChange={(e) => set({ company: e.target.value })} />
            <TextInput label="Title" value={f.jobTitle} onChange={(e) => set({ jobTitle: e.target.value })} />
          </div>
          <div style={{ marginTop: 12 }}>
            {isClient ? (
              <ChipSelect multi={false} options={CLIENT_TYPES} value={[f.type]} onChange={(v) => set({ type: v[0] || f.type })} />
            ) : (
              <>
                <ChipSelect multi={false} options={roleOptions} value={f.vendorRole ? [roleOptions.find((r) => r.toLowerCase().replace(/[\s-]+/g, '_') === f.vendorRole.toLowerCase().replace(/[\s-]+/g, '_')) || f.vendorRole] : []} onChange={(v) => set({ vendorRole: v[0] || '' })} />
              </>
            )}
          </div>

          {sec('contact', 'Contact')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="kc-grid2">
              <TextInput label="Mobile" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: formatPhoneInput(e.target.value) })} />
              <TextInput label="Other phone" type="tel" inputMode="tel" value={f.phoneAlt} onChange={(e) => set({ phoneAlt: formatPhoneInput(e.target.value) })} />
            </div>
            <TextInput label="Email" type="email" autoCapitalize="off" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            <TextInput label="Other email" type="email" autoCapitalize="off" value={f.emailAlt} onChange={(e) => set({ emailAlt: e.target.value })} />
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Prefers</span>
              <Seg value={f.preferredChannel} onChange={(v) => set({ preferredChannel: v === f.preferredChannel ? '' : v })} options={CHANNELS} />
            </div>
          </div>

          {sec('address', 'Home address')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
              <TextInput label="Street" value={f.street} onChange={(e) => set({ street: e.target.value })} />
              <TextInput label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 96px', gap: 10 }}>
              <TextInput label="City" value={f.city} onChange={(e) => set({ city: e.target.value })} />
              <TextInput label="State" value={f.state} onChange={(e) => set({ state: e.target.value.toUpperCase().slice(0, 2) })} />
              <TextInput label="ZIP" inputMode="numeric" value={f.zip} onChange={(e) => set({ zip: e.target.value.slice(0, 10) })} />
            </div>
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Neighborhood</span>
              <ChipInput value={f.neighborhood ? [f.neighborhood] : []} onChange={(v) => set({ neighborhood: v[v.length - 1] || '' })} suggestions={(facets?.neighborhoods || []).map((x) => x.value).slice(0, 8)} max={1} placeholder="Coral Gables" />
            </div>
          </div>

          {sec('personal', 'Personal touch points')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="kc-grid2">
              <TextInput label="Birthday" type="date" value={f.birthday} onChange={(e) => set({ birthday: e.target.value, birthdayMD: '' })} />
              <TextInput label="…or month-day" placeholder="06-12" value={f.birthdayMD} onChange={(e) => set({ birthdayMD: e.target.value.replace(/[^\d-]/g, '').slice(0, 5), birthday: '' })} />
            </div>
            {PERSONAL_FIELDS.map((fld) => (
              <TextInput key={fld.key} label={fld.label} value={f.personal[fld.key] || ''} onChange={(e) => setP(fld.key, e.target.value)} placeholder={fld.placeholder} />
            ))}
            <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.4 }}>For rapport only. Never used to choose homes or neighborhoods (Fair Housing).</div>
          </div>

          {isClient ? (
            <>
              {sec('financing', 'Financing & timeline')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ChipSelect multi={false} options={FINANCING} value={f.financing ? [f.financing] : []} onChange={(v) => set({ financing: v[0] || '' })} />
                <div className="kc-grid2">
                  <MoneyInput label="Pre-approval" value={f.preApprovalAmount} onChange={(v) => set({ preApprovalAmount: v })} placeholder="8.5 = $8.5M" />
                  <TextInput label="Expires" type="date" value={f.preApprovalExpires} onChange={(e) => set({ preApprovalExpires: e.target.value })} />
                </div>
                <div className="kc-grid2">
                  <TextInput label="Lender" value={f.lenderName} onChange={(e) => set({ lenderName: e.target.value })} placeholder="Private bank" />
                  <MoneyInput label="Buying power" value={f.purchasePower} onChange={(v) => set({ purchasePower: v })} />
                </div>
                <div>
                  <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Timeline</span>
                  <Seg value={f.timeline} onChange={(v) => set({ timeline: v === f.timeline ? '' : v })} options={TIMELINES} />
                </div>
                <TextArea label="Motivation" rows={2} value={f.motivation} onChange={(e) => set({ motivation: e.target.value })} placeholder="Relocating from NYC; Florida domicile before Jan 1" />
              </div>
            </>
          ) : null}

          {sec('source', 'Status, source & tags')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ChipSelect multi={false} options={STATUSES} value={[f.status]} onChange={(v) => set({ status: v[0] || f.status })} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Stars value={f.rating} onChange={(v) => set({ rating: v })} size={22} gap={4} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                <Icon name="crown" size={15} color="var(--amber)" /> Whale <Switch checked={f.isWhale} onChange={(v) => set({ isWhale: v })} label="Whale" />
              </span>
            </div>
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Lead source</span>
              <ChipSelect multi={false} options={[...new Set([...LEAD_SOURCES, ...((facets?.leadSources || []).map((x) => x.value))])].slice(0, 16)} value={f.leadSource ? [f.leadSource] : []} onChange={(v) => set({ leadSource: v[0] || '' })} />
            </div>
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Referred by</span>
              {f.referredBy ? (
                <div className="kc-dupe" style={{ background: 'var(--tint)', borderColor: 'rgba(46,139,255,0.35)', marginTop: 0 }}>
                  <Avatar name={displayName(f.referredBy)} seed={f.referredBy.id} src={f.referredBy.avatarUrl} size={28} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{displayName(f.referredBy)}</span>
                  <button type="button" onClick={() => set({ referredBy: null })} aria-label="Clear" style={{ display: 'flex', color: 'var(--faint)' }}><Icon name="x" size={16} /></button>
                </div>
              ) : <button type="button" className="km-pill km-press" onClick={() => setPickRef(true)}><Icon name="userPlus" size={14} /> Choose</button>}
            </div>
            <div>
              <span className="km-field-label" style={{ display: 'block', marginBottom: 6 }}>Tags</span>
              <ChipInput value={f.tags} onChange={(v) => set({ tags: v })} suggestions={(facets?.tags || []).map((x) => x.value).slice(0, 12)} placeholder="Waterfront, Relocation…" />
            </div>
          </div>

          <button type="button" className="km-btn km-btn--block km-btn--lg" style={{ marginTop: 22 }} onClick={() => save(close)}>Save changes</button>
          <ClientPicker open={pickRef} onClose={() => setPickRef(false)} onPick={(c) => { if (c.id !== client.id) set({ referredBy: c }); }} title="Referred by" exclude={[client.id]} allowCreate={false} />
        </div>
      ); }}
    </Sheet>
  );
}
