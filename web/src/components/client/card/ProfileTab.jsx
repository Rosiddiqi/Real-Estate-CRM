// ProfileTab — AI briefing (status · next move · ice-breakers · portfolio
// context), the money cluster, deals, contact info, personal touch points,
// financing & timeline, household links, referrals, tags and waitlists.
import { useState } from 'react';
import Icon from '../../ui/Icon';
import Avatar from '../../ui/Avatar';
import { Skeleton, Spinner } from '../../ui/kit';
import { toast, confirm } from '../../ui/toast';
import { nav } from '../../../lib/nav';
import { formatPhone, moneyCompact, formatDate } from '../../../lib/format';
import { deleteLink } from '../../../api/clients';
import {
  SectionTitle, InfoRow, PERSONAL_FIELDS, FINANCING_LABEL, TIMELINE_LABEL, RELATION_LABEL, displayName, copyText, humanize, cap,
} from '../clientKit';

const STAGE = {
  new_lead: ['New lead', 'var(--faint)'], consultation: ['Consult', 'var(--kind-match)'], touring: ['Touring', 'var(--kind-showing)'],
  offer_submitted: ['Offer', 'var(--amber)'], under_contract: ['Under contract', 'var(--violet)'], closed: ['Closed', 'var(--green)'],
  seller_lead: ['Seller lead', 'var(--faint)'], listing_appt: ['Listing appt', 'var(--kind-listing)'], active: ['Listed', 'var(--kind-showing)'],
  offer_received: ['Offer in', 'var(--amber)'], lost: ['Lost', 'var(--red)'], unit_selection: ['Unit selection', 'var(--cyan)'],
  pricing_received: ['Pricing', 'var(--cyan)'], priority_list: ['Priority list', 'var(--cyan)'], reserved: ['Reserved', 'var(--violet)'], building_delivered: ['Delivered', 'var(--green)'],
};

function Briefing({ client, briefing, loading, onRefresh, refreshing }) {
  if (!briefing && loading) {
    return (
      <div className="kc-brief">
        <Skeleton w="42%" h={10} /><Skeleton w="92%" h={13} style={{ marginTop: 12 }} /><Skeleton w="76%" h={13} style={{ marginTop: 8 }} />
      </div>
    );
  }
  if (!briefing) return null;
  const draft = (text) => nav.openThread({ clientId: client.id, draft: text });
  return (
    <div className="kc-brief">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="sparkle" size={13} color="var(--violet)" stroke={2.2} />
        <span className="kc-eyebrow" style={{ color: 'var(--violet)' }}>Briefing</span>
        {briefing.source === 'ai' ? <span className="kc-tag kc-tag--mono kc-tag--violet" style={{ height: 18 }}>AI</span> : null}
        {briefing.pending ? <span style={{ fontSize: 11, color: 'var(--faint)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Spinner size={10} /> refining</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onRefresh} aria-label="Refresh briefing" style={{ display: 'flex', color: 'var(--faint)' }} disabled={refreshing}>
          {refreshing ? <Spinner size={14} /> : <Icon name="refresh" size={15} />}
        </button>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginTop: 8 }}>{briefing.statusLine}</div>
      {briefing.recommendedMove ? (
        <div className="kc-brief-move">
          <div className="kc-eyebrow" style={{ color: 'var(--bright)', marginBottom: 4 }}>Next move</div>
          {briefing.recommendedMove}
          <div style={{ display: 'flex', gap: 14, marginTop: 9 }}>
            <button type="button" className="kc-link" onClick={() => nav.openSerena('chat', `Help me with ${displayName(client)}: ${briefing.recommendedMove}`)}>Ask Serena</button>
            <button type="button" className="kc-link" onClick={() => nav.openThread({ clientId: client.id })}>Open thread</button>
          </div>
        </div>
      ) : null}
      {briefing.iceBreakers?.length ? (
        <div style={{ marginTop: 12 }}>
          <div className="kc-eyebrow" style={{ marginBottom: 2 }}>Open with</div>
          {briefing.iceBreakers.map((q) => <button key={q} type="button" className="kc-quote km-press" onClick={() => draft(q)}>{q}</button>)}
        </div>
      ) : null}
      {briefing.portfolioContext ? <div style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--dim)', lineHeight: 1.4 }}><Icon name="house" size={14} style={{ marginTop: 1 }} /> <span>{briefing.portfolioContext}</span></div> : null}
      {briefing.dealContext ? <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 13, color: 'var(--dim)' }}><Icon name="handshake" size={14} style={{ marginTop: 1 }} /> <span>{briefing.dealContext}</span></div> : null}
      {briefing.toneNotes ? <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--dim)', fontStyle: 'italic' }}>{briefing.toneNotes}</div> : null}
      {briefing.lastContactSummary ? <div style={{ marginTop: 10, fontSize: 12, color: 'var(--faint)' }}>{briefing.lastContactSummary}</div> : null}
    </div>
  );
}

function StatCluster({ client }) {
  const s = client.stats || {};
  const yr = (d) => (d ? `’${String(new Date(d).getFullYear()).slice(2)}` : '—');
  const lastClose = s.lastClosedAt ? new Date(s.lastClosedAt).toLocaleDateString('en-US', { month: 'short' }) + ` ’${String(new Date(s.lastClosedAt).getFullYear()).slice(2)}` : '—';
  return (
    <div className="kc-statcluster">
      <div className="kc-statcluster-band">
        <div>
          <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--green)', textShadow: '0 0 16px rgba(48,210,122,0.3)' }}>{s.lifetimeVolume ? moneyCompact(s.lifetimeVolume) : '$0'}</div>
          <div className="kc-mono" style={{ fontSize: 8, letterSpacing: '0.18em', color: 'var(--faint)', marginTop: 5 }}>LIFETIME VOLUME</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{s.lifetimeGci ? moneyCompact(s.lifetimeGci) : s.avgPrice ? moneyCompact(s.avgPrice) : '—'}</div>
          <div className="kc-mono" style={{ fontSize: 8, letterSpacing: '0.16em', color: 'var(--faint)', marginTop: 4 }}>{s.lifetimeGci ? 'LIFETIME GCI' : 'AVG PRICE'}</div>
        </div>
      </div>
      <div className="kc-statcluster-rail">
        {[['BOUGHT', s.bought ?? 0], ['SOLD', s.sold ?? 0], ['LAST CLOSE', lastClose], ['CLIENT', yr(s.clientSince || client.createdAt)]].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{v}</div>
            <div className="kc-mono" style={{ fontSize: 6.5, letterSpacing: '0.12em', color: 'var(--faint)', marginTop: 3, whiteSpace: 'nowrap' }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Deals({ client }) {
  const deals = client.deals || [];
  const open = deals.filter((d) => !['closed', 'lost'].includes(d.stage));
  const closed = deals.filter((d) => d.stage === 'closed');
  const shown = [...open, ...closed].slice(0, 6);
  return (
    <>
      <SectionTitle action={<button type="button" className="kc-link" onClick={() => nav.newDeal({ clientId: client.id, side: client.type === 'seller' ? 'listing' : 'buyer' })}>+ Deal</button>}>
        Deals{open.length ? ` · ${open.length} open` : ''}
      </SectionTitle>
      {shown.length === 0 ? (
        <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>No deals yet — start one when they’re ready to move.</div>
      ) : (
        <div className="km-list" style={{ padding: 0 }}>
          {shown.map((d) => {
            const [label, color] = STAGE[d.stage] || [humanize(d.stage), 'var(--blue)'];
            const price = d.salePrice || d.contractPrice || d.price || d.listPrice;
            return (
              <button key={d.id} type="button" className="kc-dealrow km-press" onClick={() => nav.openDeal(d.id)}>
                <span className="kc-dot" style={{ width: 8, height: 8, background: color, boxShadow: `0 0 8px ${color}` }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{d.propertyLabel || d.propertyAddress || d.title || (d.side === 'listing' ? 'Listing' : 'Purchase')}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{label} · {cap(d.side === 'buyer' ? 'Buy side' : d.side === 'listing' ? 'List side' : humanize(d.side))}{d.closedAt ? ` · ${formatDate(d.closedAt, { month: 'short', year: 'numeric' })}` : ''}</span>
                </span>
                {price ? <span className="kc-mono" style={{ fontSize: 13, fontWeight: 600, color: d.stage === 'closed' ? 'var(--green)' : 'var(--text)' }}>{moneyCompact(price)}</span> : null}
                <Icon name="chevronRight" size={14} color="var(--faint)" />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function Household({ client, onAddLink, onChanged }) {
  const links = client.links || [];
  const remove = async (l) => {
    if (!(await confirm({ title: `Unlink ${displayName(l.client)}?`, confirmLabel: 'Remove link', destructive: true }))) return;
    try { await deleteLink(client.id, l.id); onChanged(); } catch (e) { toast.error(e.message || 'Couldn’t remove'); }
  };
  return (
    <>
      <SectionTitle action={<button type="button" className="kc-link" onClick={onAddLink}>+ Link</button>}>Household & circle</SectionTitle>
      {links.length === 0 ? (
        <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>Link a spouse, partner, assistant or family office — they open each other’s cards.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {links.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="km-press" onClick={() => nav.openClient(l.client.id)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', textAlign: 'left' }}>
                <Avatar name={displayName(l.client)} seed={l.client.id} src={l.client.avatarUrl} size={32} channel={l.client.deviceMode || undefined} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{displayName(l.client)}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>{RELATION_LABEL[l.relation] || humanize(l.relation)}{l.notes ? ` · ${l.notes}` : ''}</span>
                </span>
                {l.client.isWhale ? <Icon name="crown" size={13} color="var(--amber)" /> : null}
              </button>
              <button type="button" onClick={() => remove(l)} aria-label="Remove link" style={{ display: 'flex', color: 'var(--faint)', padding: 6 }}><Icon name="x" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ProfileTab({ client, briefing, briefingLoading, refreshing, onRefreshBriefing, onEdit, onAddLink, onChanged, onScroll }) {
  const [copied, setCopied] = useState(false);
  const hasDetail = !!client._detail;
  const p = (client.personal && typeof client.personal === 'object') ? client.personal : {};
  const touch = PERSONAL_FIELDS.filter((f) => p[f.key]);
  const address = [client.street ? `${client.street}${client.unit ? ` #${client.unit}` : ''}` : null, [client.city, [client.state, client.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  const birthday = client.birthday ? (client.birthday.startsWith('--') ? new Date(`2000-${client.birthday.slice(2)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : new Date(`${client.birthday}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })) : null;
  const copyAll = () => {
    copyText([displayName(client), client.company, formatPhone(client.phone), client.email, address].filter(Boolean).join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="kc-pane" style={{ position: 'relative' }}>
      <div className="kc-pane-scroll km-scroll" onScroll={onScroll}>
        <div className="kc-pane-inner">
          <Briefing client={client} briefing={briefing} loading={briefingLoading} onRefresh={onRefreshBriefing} refreshing={refreshing} />
          {hasDetail ? <StatCluster client={client} /> : <Skeleton h={110} r={14} style={{ marginTop: 12 }} />}
          {hasDetail ? <Deals client={client} /> : null}

          <button type="button" className={`kc-copyall ${copied ? 'kc-copyall--done' : ''}`} onClick={copyAll}>
            <Icon name={copied ? 'check' : 'copy'} size={15} stroke={copied ? 2.3 : 1.8} /> {copied ? 'Copied all contact info' : 'Copy all contact info'}
          </button>

          <SectionTitle action={<button type="button" className="kc-link" onClick={() => onEdit('contact')}>Edit</button>}>Contact</SectionTitle>
          <div>
            <InfoRow label="Mobile" value={client.phone ? formatPhone(client.phone) : null} action={client.phone ? <a className="kc-iconbtn" href={`tel:${client.phone}`} aria-label="Call"><Icon name="phone" size={15} /></a> : null} />
            <InfoRow label="Other phone" value={client.phoneAlt ? formatPhone(client.phoneAlt) : null} />
            <InfoRow label="Email" value={client.email} action={client.email ? <a className="kc-iconbtn" href={`mailto:${client.email}`} aria-label="Email"><Icon name="mail" size={15} /></a> : null} />
            <InfoRow label="Other email" value={client.emailAlt} />
            <InfoRow label="Company" value={[client.jobTitle, client.company].filter(Boolean).join(' · ') || null} />
            <InfoRow label="Address" value={address || null} action={address ? <a className="kc-iconbtn" href={`maps:?q=${encodeURIComponent(address.replace('\n', ', '))}`} aria-label="Map"><Icon name="mapPin" size={15} /></a> : null} />
            <InfoRow label="Neighborhood" value={client.neighborhood} />
            <InfoRow label="Birthday" value={birthday} />
            <InfoRow label="Prefers" value={client.preferredChannel ? cap(client.preferredChannel) : client.deviceMode ? (client.deviceMode === 'imessage' ? 'iMessage' : 'SMS') : null} />
            <InfoRow label="Client since" value={formatDate(client.createdAt, { month: 'long', year: 'numeric' })} />
          </div>

          <SectionTitle action={<button type="button" className="kc-link" onClick={() => onEdit('personal')}>{touch.length ? 'Edit' : '+ Add'}</button>}>Personal touch points</SectionTitle>
          {touch.length ? (
            <div className="kc-touch">
              {touch.map((f) => (
                <span key={f.key} className="km-selectable"><Icon name={f.icon} size={12} color="var(--faint)" /><em>{f.label}</em> {Array.isArray(p[f.key]) ? p[f.key].join(', ') : String(p[f.key])}</span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>Spouse, kids, pets, clubs, the wine they love — the details that make a call feel personal.</div>
          )}

          {(client.contactKind === 'client' || !client.contactKind) ? (
            <>
              <SectionTitle action={<button type="button" className="kc-link" onClick={() => onEdit('financing')}>Edit</button>}>Financing & timeline</SectionTitle>
              {client.financing || client.preApprovalAmount || client.lenderName || client.timeline || client.motivation || client.purchasePower ? (
                <div>
                  <InfoRow label="Financing" value={client.financing ? FINANCING_LABEL[client.financing] || humanize(client.financing) : null} />
                  <InfoRow label="Pre-approval" value={client.preApprovalAmount ? `${moneyCompact(client.preApprovalAmount)}${client.preApprovalExpires ? ` · expires ${formatDate(client.preApprovalExpires)}` : ''}` : null} />
                  <InfoRow label="Lender" value={client.lenderName} />
                  <InfoRow label="Buying power" value={client.purchasePower ? moneyCompact(client.purchasePower) : null} />
                  <InfoRow label="Timeline" value={client.timeline ? TIMELINE_LABEL[client.timeline] || humanize(client.timeline) : null} />
                  <InfoRow label="Motivation" value={client.motivation} />
                </div>
              ) : (
                <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>How they’re paying, who’s lending, and why now.</div>
              )}
            </>
          ) : null}

          {hasDetail ? <Household client={client} onAddLink={onAddLink} onChanged={onChanged} /> : null}

          {hasDetail && (client.referredBy || (client.referrals || []).length) ? (
            <>
              <SectionTitle>Referrals</SectionTitle>
              {client.referredBy ? (
                <button type="button" className="kc-info km-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.openClient(client.referredBy.id)}>
                  <div style={{ flex: 1 }}>
                    <div className="kc-info-l">Referred by</div>
                    <div className="kc-info-v">{displayName(client.referredBy)}</div>
                  </div>
                  <Icon name="chevronRight" size={14} color="var(--faint)" />
                </button>
              ) : null}
              {(client.referrals || []).length ? (
                <div style={{ marginTop: 8 }}>
                  <div className="kc-info-l" style={{ marginBottom: 8 }}>Sent you {client.referrals.length} {client.referrals.length === 1 ? 'client' : 'clients'}</div>
                  <div className="kc-touch">
                    {client.referrals.map((r) => (
                      <button key={r.id} type="button" className="km-press" onClick={() => nav.openClient(r.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 999, background: 'var(--kc-fill)', fontSize: 13 }}>
                        <Avatar name={displayName(r)} seed={r.id} src={r.avatarUrl} size={22} /> {displayName(r)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          <SectionTitle action={<button type="button" className="kc-link" onClick={() => onEdit('source')}>Edit</button>}>Source & tags</SectionTitle>
          <div>
            <InfoRow label="Lead source" value={client.leadSource} />
          </div>
          {(client.tags || []).length ? (
            <div className="kc-touch" style={{ marginTop: 10 }}>
              {client.tags.map((t) => <span key={t}>{t}</span>)}
            </div>
          ) : <div style={{ fontSize: 13.5, color: 'var(--faint)', marginTop: 6 }}>No tags yet.</div>}

          {hasDetail && (client.waitlists || []).length ? (
            <>
              <SectionTitle action={<button type="button" className="kc-link" onClick={() => nav.openWaitlists()}>Open</button>}>Waitlists</SectionTitle>
              <div className="kc-touch">
                {client.waitlists.map((w) => (
                  <span key={w.entryId}><Icon name="checklist" size={12} color="var(--faint)" /> {w.name}{w.status === 'got_one' ? ' · got one' : ''}</span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
