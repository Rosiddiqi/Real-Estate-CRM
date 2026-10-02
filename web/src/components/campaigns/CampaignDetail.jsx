// CampaignDetail — one campaign (RevMatch CampaignDetail): the scoreboard
// (sent · delivered · replied · reply rate · opt-outs), the live line while
// sending, replies waiting for approval, the lane columns (Green · Yellow ·
// Red · No reply · Waiting) with every recipient → their real thread, the
// message / event / reply plan, and pause · resume · stop · duplicate.
// Overlay contract: receives { id, overlayId, onClose }.
import { useMemo, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import GlassButton from '../ui/GlassButton';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Button, EmptyState, Skeleton, SkeletonRows } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { relativeTime, moneyCompact } from '../../lib/format';
import { haptic } from '../../lib/native';
import { mediaUrl } from '../../api/client';
import {
  pauseCampaign, resumeCampaign, stopCampaign, duplicateCampaign, deleteCampaign, updateCampaign,
  setRecipientLane, muteRecipient,
} from '../../api/campaigns';
import { StatusPill, LaneDot, LANE_META, MonoLabel, Eyebrow, InfoNote, NeedsLineBanner, Progress, campaignPhase, fmtWhen, fmtIn, fmtEta } from './kit';
import SuggestionCard from './SuggestionCard';
import TrafficLanes, { normalizeLanes } from './TrafficLanes';
import { useCampaign, useMessagingMode } from './useCampaignsData';
import { fmtTz, useCampaignTz } from './tz';

const COLS = ['green', 'yellow', 'red', 'gray', 'waiting'];
const PAGE = 30;
const REC_STATUS = {
  pending: ['Queued', 'var(--faint)'], scheduled: ['Queued', 'var(--faint)'], drafting: ['Writing', 'var(--bright)'],
  rate_deferred: ['Waiting', 'var(--amber)'], sent: ['Sent', 'var(--bright)'], replied: ['Replied', 'var(--green)'],
  taken_over: ['Yours now', 'var(--violet)'], opted_out: ['Opted out', 'var(--red)'], failed: ['Failed', 'var(--red)'],
  muted: ['Muted', 'var(--faint)'], canceled: ['Not sent', 'var(--faint)'],
};
const STATUS_LABEL = { sending: 'Sending', listening: 'Listening for replies', scheduled: 'Scheduled', paused: 'Paused', completed: 'Done', stopped: 'Stopped', draft: 'Draft', on: 'On', off: 'Off' };

function activityLine(r) {
  if (r.status === 'opted_out') return r.error || 'Asked not to be texted';
  if (r.status === 'rate_deferred') return r.error || 'Waiting for a safe slot';
  if (r.status === 'failed') return r.error || 'Did not go out';
  if (r.status === 'canceled') return r.error || 'Never sent';
  if (r.status === 'muted') return 'Muted. Nothing else goes to them';
  if (r.awaitingApproval) return 'Draft waiting for your OK';
  if (r.repliedAt && r.lastReplyKind === 'off_topic') return `Off-topic reply · ${relativeTime(r.repliedAt)}`;
  if (r.repliedAt && r.lastReplyKind === 'question') return `Asked a question ${relativeTime(r.repliedAt)}`;
  if (r.status === 'taken_over') return r.repliedAt ? `Replied ${relativeTime(r.repliedAt)} · you took over` : 'You took this conversation over';
  if (r.repliedAt) return `Replied ${relativeTime(r.repliedAt)}`;
  if (!r.lastSentAt && r.nextSendAt) return `Goes out ${fmtIn(r.nextSendAt)}`;
  if (r.lastSentAt && r.nextKind === 'gray_check') return `Sent ${relativeTime(r.lastSentAt)} · nudge ${fmtIn(r.nextSendAt)}`;
  if (r.lastSentAt && r.nextKind === 'lane_step') return `Follow-up ${fmtIn(r.nextSendAt)}`;
  if (r.lastSentAt && r.nextKind === 'reminder_step') return `Reminder ${fmtIn(r.nextSendAt)}`;
  if (r.lastSentAt) return `Sent ${relativeTime(r.lastSentAt)}`;
  return 'Queued';
}

// "Right away: offer two private showing times · +1 more"
function laneSummary(steps) {
  const first = steps[0] || {};
  const label = String(first.label || '').toLowerCase();
  const brief = String(first.brief || '').replace(/\s+/g, ' ').trim();
  const head = [label ? label.charAt(0).toUpperCase() + label.slice(1) : null, brief ? brief.charAt(0).toLowerCase() + brief.slice(1) : null].filter(Boolean).join(': ');
  return `${head || '1 text'}${steps.length > 1 ? ` · +${steps.length - 1} more` : ''}`;
}

function Tile({ label, value, color, sub }) {
  return (
    <div className="kc-tile">
      <div className="kc-tile-num" style={{ color, fontSize: String(value).length > 3 ? 17 : undefined }}>{value}</div>
      <div className="kc-tile-label">{label}</div>
      {sub ? <div className="kc-tile-sub">{sub}</div> : null}
    </div>
  );
}

function RecipientRow({ r, onMore }) {
  const [label, color] = REC_STATUS[r.status] || ['', 'var(--faint)'];
  const open = () => nav.openThread({ conversationId: r.conversationId || undefined, clientId: r.clientId, name: r.name });
  return (
    <div className="kc-li" style={{ alignItems: 'flex-start', paddingRight: 6 }}>
      <button type="button" className="km-press" onClick={open} style={{ display: 'flex', gap: 11, flex: 1, minWidth: 0, textAlign: 'left' }}>
        <Avatar name={r.name} seed={r.clientId} src={r.avatarUrl} size={38} channel={r.channel} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="km-truncate" style={{ fontSize: 14.5, fontWeight: 600, minWidth: 0 }}>{r.name}</span>
            {r.laneLockedByAgent ? <Icon name="pin" size={11} color="var(--faint)" title="Lane set by you" /> : null}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span className="kc-dot" style={{ width: 5, height: 5, background: color }} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>{label}</span>
            </span>
          </span>
          <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: r.status === 'rate_deferred' ? 'var(--amber)' : 'var(--dim)', marginTop: 2 }}>{activityLine(r)}</span>
          {r.lastReply && r.lastReply.body ? (
            <span style={{ display: 'block', marginTop: 6, padding: '7px 11px', borderRadius: '15px 15px 15px 5px', background: 'var(--bubble-in)', width: 'fit-content', maxWidth: '100%' }}>
              <span className="km-clamp-2 km-selectable" style={{ fontSize: 13, lineHeight: 1.38, color: 'var(--bubble-in-text)' }}>{r.lastReply.body}</span>
            </span>
          ) : null}
        </span>
      </button>
      <button type="button" className="km-icon-btn km-icon-btn--sm km-press" onClick={() => onMore(r)} aria-label={`More for ${r.name}`} style={{ marginTop: 3, flexShrink: 0 }}>
        <Icon name="more" size={17} color="var(--faint)" />
      </button>
    </div>
  );
}

function ActionRow({ icon, dot, label, onClick, danger, sub }) {
  return (
    <button type="button" className="kc-li km-press" onClick={onClick} style={{ minHeight: 50 }}>
      {dot ? <span style={{ width: 20, display: 'flex', justifyContent: 'center' }}><LaneDot lane={dot} size={10} /></span> : <Icon name={icon} size={18} color={danger ? 'var(--red)' : 'var(--bright)'} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15.5, color: danger ? 'var(--red)' : 'var(--text)' }}>{label}</span>
        {sub ? <span style={{ display: 'block', fontSize: 12, color: 'var(--faint)', marginTop: 1 }}>{sub}</span> : null}
      </span>
    </button>
  );
}

// Hands the panel's animated close to handlers that live outside the body.
function CloseBridge({ target }) {
  const { requestClose } = usePanel();
  target.current = requestClose;
  return null;
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton h={168} r={16} />
      <div style={{ height: 22 }} />
      <Skeleton w={140} h={12} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 6, margin: '12px 0' }}>
        {COLS.map((k) => <Skeleton key={k} h={66} r={12} />)}
      </div>
      <SkeletonRows n={5} />
    </div>
  );
}

export default function CampaignDetail({ id, onClose }) {
  useCampaignTz();
  const { data, error, loading, reload, setData } = useCampaign(id);
  const closeRef = useRef(onClose);
  const [col, setCol] = useState(null);
  const [menu, setMenu] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  const [lanesDraft, setLanesDraft] = useState(null);
  const [savingLanes, setSavingLanes] = useState(false);
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(null);
  const [limit, setLimit] = useState(PAGE);

  const gone = !!(error && error.status === 404);
  const c = data && !gone ? data.campaign : null;
  const isAuto = !!(c && c.kind === 'automation');
  const recipients = useMemo(() => (data && data.recipients) || [], [data]);
  const suggestions = (data && data.suggestions) || [];
  const s = (c && c.stats) || {};
  const phase = campaignPhase(c && isAuto ? { ...c, enabled: c.status === 'running' } : c);
  const counts = useMemo(() => {
    const m = { green: 0, yellow: 0, red: 0, gray: 0, waiting: 0 };
    recipients.forEach((r) => { m[r.bucket] = (m[r.bucket] || 0) + 1; });
    return m;
  }, [recipients]);
  const activeCol = col || COLS.find((k) => counts[k]) || 'waiting';
  const colRows = recipients.filter((r) => r.bucket === activeCol);
  const live = !!(c && ['running', 'scheduled'].includes(c.status));
  const stoppable = !!(c && !isAuto && ['running', 'scheduled', 'paused'].includes(c.status));
  const hasEvent = !!(c && c.event && c.event.enabled !== false && c.event.startAt);
  const aiDraft = !!(c && c.lanes && c.lanes.aiReply && c.lanes.aiReply.mode === 'draft');
  // 'device' messaging mode: no business texting line, nothing automated sends.
  const needsLine = useMessagingMode() === 'device';
  const lineHeld = !!(c && c.status === 'paused' && c.schedule && c.schedule.pauseReason === 'needs_texting_line');
  const lanesEditable = !!(c && !isAuto && c.status !== 'completed');

  const patchCampaign = (patch) => setData((d) => (d ? { ...d, campaign: { ...d.campaign, ...patch } } : d));

  // Optimistic action with rollback.
  const act = async (key, fn, optimistic, okMsg) => {
    if (busy) return;
    setBusy(key);
    const prev = data;
    if (optimistic) patchCampaign(optimistic);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      reload();
    } catch (e) {
      setData(prev);
      toast.error(e.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const pause = () => act('pause', () => pauseCampaign(id), { status: 'paused' }, 'Paused. Nothing goes out until you resume');
  const resume = () => act('resume', () => resumeCampaign(id), { status: 'running' }, 'Sending again');
  const stop = async () => {
    const ok = await confirm({ title: 'Stop this campaign?', message: 'Unsent texts are canceled and no follow-ups go out. Replies still reach your inbox.', confirmLabel: 'Stop campaign', destructive: true });
    if (ok) act('stop', () => stopCampaign(id), { status: 'completed', schedule: { ...(c.schedule || {}), canceledAt: new Date().toISOString() } }, 'Campaign stopped');
  };
  const duplicate = async () => {
    if (busy) return;
    setBusy('dup');
    try {
      const { campaign: copy } = await duplicateCampaign(id);
      toast.success('Copied to a new draft');
      nav.newCampaign({ campaignId: copy.id });
    } catch (e) { toast.error(e.message || 'Could not duplicate'); } finally { setBusy(null); }
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete “${c.name}”?`, message: 'Its stats and lanes go away. Texts already sent stay in each thread.', confirmLabel: 'Delete campaign', destructive: true });
    if (!ok) return;
    try {
      await deleteCampaign(id);
      toast('Campaign deleted');
      closeRef.current();
    } catch (e) { toast.error(e.message || 'Could not delete'); }
  };

  const openLanes = () => { setLanesDraft(normalizeLanes(c.lanes)); setLanesOpen(true); };
  const saveLanes = async () => {
    if (savingLanes) return;
    setSavingLanes(true);
    try {
      const r = await updateCampaign(id, { lanes: lanesDraft });
      patchCampaign({ lanes: r.campaign.lanes });
      toast.success(live || (c && c.status === 'paused') ? 'Reply plan saved. Queued follow-ups re-timed' : 'Reply plan saved');
      setLanesOpen(false);
    } catch (e) { toast.error(e.message || 'Could not save'); } finally { setSavingLanes(false); }
  };

  const moveLane = async (r, lane) => {
    const prev = data;
    setData((d) => (d ? { ...d, recipients: d.recipients.map((x) => (x.id === r.id ? { ...x, lane, bucket: lane, laneLockedByAgent: true } : x)) } : d));
    setCol(lane);
    try {
      await setRecipientLane(id, r.id, lane);
      haptic('light');
      toast.success(`${r.firstName || r.name} moved to ${LANE_META[lane].short}`);
      reload();
    } catch (e) { setData(prev); toast.error(e.message || 'Could not move them'); }
  };
  const toggleMute = async (r) => {
    const muted = r.status !== 'muted';
    const prev = data;
    setData((d) => (d ? { ...d, recipients: d.recipients.map((x) => (x.id === r.id ? { ...x, status: muted ? 'muted' : (x.lastSentAt ? 'sent' : 'pending'), nextSendAt: muted ? null : x.nextSendAt } : x)) } : d));
    try {
      await muteRecipient(id, r.id, muted);
      toast(muted ? `${r.firstName || r.name} muted for this campaign` : `${r.firstName || r.name} unmuted`);
      reload();
    } catch (e) { setData(prev); toast.error(e.message || 'Could not update'); }
  };

  const openThread = (r) => nav.openThread({ conversationId: r.conversationId || undefined, clientId: r.clientId, name: r.name });

  const subtitle = c ? [c.template && c.template.label, s.total ? `${s.total} ${s.total === 1 ? 'person' : 'people'}` : null].filter(Boolean).join(' · ') : undefined;
  const headerRight = c ? <GlassButton icon="more" label="Campaign actions" onClick={() => setMenu(true)} /> : null;

  return (
    <PushPanel onClose={onClose} title={c ? c.name : 'Campaign'} subtitle={subtitle || undefined} right={headerRight} bodyStyle={{ padding: '6px 16px 0' }}>
      <CloseBridge target={closeRef} />
      <div className="kc-wide">
        {gone ? (
          <EmptyState icon="send" title="This campaign is gone" sub="It was deleted. Texts that went out are still in each thread." action={<Button size="sm" variant="ghost" onClick={() => closeRef.current()}>Back</Button>} />
        ) : null}
        {!gone && loading && !c ? <DetailSkeleton /> : null}
        {!gone && error && !c ? (
          <EmptyState icon="alert" title="Couldn’t load this campaign" sub={error.message} action={<Button size="sm" variant="ghost" icon="refresh" onClick={reload}>Try again</Button>} />
        ) : null}
        {c && needsLine && !isAuto ? <NeedsLineBanner style={{ marginBottom: 10 }} /> : null}
        {c ? (
          <>
            {/* Scoreboard */}
            <div className="kc-card" style={{ '--kc-accent': c.accent, padding: '14px 14px 14px 18px' }}>
              <span className="kc-card-spine" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <StatusPill status={phase} />
                <span className="km-truncate" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)', minWidth: 0 }}>
                  {c.status === 'scheduled' && (c.schedule && c.schedule.startAt) ? `Starts ${fmtWhen(c.schedule.startAt, { todayWord: true })}`
                    : c.launchedAt ? `Started ${fmtWhen(c.launchedAt, { todayWord: true })}` : `Created ${relativeTime(c.createdAt)}`}
                </span>
              </div>
              <div className="kc-tiles" style={{ marginTop: 12 }}>
                <Tile label="Sent" value={s.sent || 0} />
                <Tile label="Delivered" value={s.delivered || 0} />
                <Tile label="Replied" value={s.replied || 0} color={s.replied ? 'var(--green)' : undefined} />
                <Tile label="Reply rate" value={`${Math.round(s.replyRate || 0)}%`} color={(s.replyRate || 0) >= 30 ? 'var(--green)' : undefined} />
                <Tile label="Opt-outs" value={s.optedOut || 0} color={s.optedOut ? 'var(--red)' : undefined} />
              </div>
              {!isAuto && s.total ? (
                <div style={{ marginTop: 13 }}>
                  <Progress value={s.sent || 0} total={s.total || 0} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 7 }}>
                    <MonoLabel>{s.sent || 0}/{s.total} sent · {c.pacing === 'all_now' ? 'all at once' : 'safe pace'}</MonoLabel>
                    {phase === 'sending' && s.eta ? <MonoLabel style={{ flexShrink: 0 }}>{fmtEta(s.eta)}</MonoLabel> : null}
                  </div>
                </div>
              ) : null}
              {phase === 'sending' && s.nextSendAt ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
                  <span className="kc-dot kc-pulse" style={{ width: 7, height: 7, background: 'var(--green)', boxShadow: '0 0 8px var(--green)' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--green)', textTransform: 'uppercase' }}>Live · next text {fmtIn(s.nextSendAt)}</span>
                </div>
              ) : null}
              {c.status === 'paused' && !isAuto ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>
                  <Icon name="pause" size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>{lineHeld ? 'Paused — needs a texting line. Nothing goes out until one is connected; replies still reach you.' : 'Paused. Nothing goes out, and replies still reach you.'}</span>
                </div>
              ) : null}
              {s.deferred ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>
                  <Icon name="shield" size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>{s.deferred} waiting for a safe slot{s.deferredReason ? `: ${s.deferredReason.replace(/\.$/, '')}` : ''}</span>
                </div>
              ) : null}
              {!isAuto ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {c.status === 'paused' ? <Button size="sm" icon="play" onClick={resume} loading={busy === 'resume'} disabled={!!busy || needsLine} style={{ flex: 1 }}>Resume</Button> : null}
                  {live ? <Button size="sm" variant="ghost" icon="pause" onClick={pause} loading={busy === 'pause'} disabled={!!busy} style={{ flex: 1 }}>Pause</Button> : null}
                  {!live && c.status !== 'paused' ? <Button size="sm" variant="ghost" icon="copy" onClick={duplicate} loading={busy === 'dup'} disabled={!!busy} style={{ flex: 1 }}>Duplicate</Button> : null}
                  {stoppable ? <Button size="sm" variant="ghost" icon="x" onClick={stop} loading={busy === 'stop'} disabled={!!busy} style={{ flex: 1, color: 'var(--red)' }}>Stop</Button> : null}
                </div>
              ) : null}
            </div>

            {suggestions.length ? (
              <>
                <Eyebrow blue icon="sparkle" style={{ marginTop: 22 }}>Waiting for your OK · {suggestions.length}</Eyebrow>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {suggestions.map((x) => (
                    <SuggestionCard key={x.id} s={x} showCampaign={false}
                      onResolved={(sid) => setData((d) => (d ? { ...d, suggestions: d.suggestions.filter((y) => y.id !== sid) } : d))}
                      onRestore={() => reload()} />
                  ))}
                </div>
              </>
            ) : null}

            {/* Lane columns */}
            <Eyebrow icon="users" style={{ marginTop: 22 }}>Who said what</Eyebrow>
            <div className="kc-lanecols" style={{ marginTop: 10 }} role="tablist" aria-label="Reply lanes">
              {COLS.map((k) => {
                const m = LANE_META[k];
                const on = activeCol === k;
                return (
                  <button key={k} type="button" role="tab" aria-selected={on} aria-pressed={on} className="kc-lanecol km-press" onClick={() => { setCol(k); setLimit(PAGE); }} style={{ '--kc-c': m.hex }}>
                    <span style={{ display: 'flex', justifyContent: 'center' }}><LaneDot lane={k} size={8} glow={on || counts[k] > 0} /></span>
                    <div className="kc-lanecol-num" style={{ color: counts[k] ? 'var(--text)' : 'var(--faint)' }}>{counts[k]}</div>
                    <div className="km-truncate" style={{ fontSize: 10.5, fontWeight: 600, color: on ? m.color : 'var(--faint)' }}>{m.short}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', margin: '9px 2px 9px' }}>
              {LANE_META[activeCol].sub}.{activeCol === 'red' && s.optedOut ? ' Opt-outs are permanent until they text START.' : ''}
              {activeCol === 'gray' && colRows.some((r) => r.lastReplyKind === 'off_topic') ? ' Off-topic replies stop the campaign for that person; answer them in the thread.' : ''}
            </div>
            {colRows.length ? (
              <div className="kc-list">
                {colRows.slice(0, limit).map((r) => <RecipientRow key={r.id} r={r} onMore={setRec} />)}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '22px 12px', borderRadius: 14, border: '1px dashed var(--line)', fontSize: 13, color: 'var(--faint)' }}>
                {activeCol === 'waiting' ? (recipients.length ? 'Everyone has been texted.' : 'No one has been added yet.') : activeCol === 'gray' ? 'No one is sitting on a text right now.' : 'No one here yet.'}
              </div>
            )}
            {colRows.length > limit ? (
              <button type="button" className="km-press" onClick={() => setLimit((n) => n + 60)} style={{ display: 'block', margin: '12px auto 0', fontSize: 13.5, fontWeight: 600, color: 'var(--bright)' }}>
                Show {Math.min(60, colRows.length - limit)} more of {colRows.length}
              </button>
            ) : null}

            {/* The message */}
            <Eyebrow icon="send" style={{ marginTop: 26 }}>The message</Eyebrow>
            <div className="kc-section" style={{ marginTop: 10, padding: 13 }}>
              <MonoLabel>{isAuto ? 'What your AI writes about' : 'Your brief · AI writes each text from it'}</MonoLabel>
              <div className="km-selectable" style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.45, marginTop: 6 }}>{c.brief || 'No brief yet.'}</div>
              {c.listing ? (
                <button type="button" className="km-press" onClick={() => nav.openListing(c.listing.id)} style={{ display: 'flex', gap: 11, alignItems: 'center', width: '100%', textAlign: 'left', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <PropertyPhoto src={c.listing.photo} seed={c.listing.id} height={54} radius={10} style={{ width: 72, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.listing.street || c.listing.address}</span>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{[c.listing.price ? moneyCompact(c.listing.price) : null, c.listing.specs].filter(Boolean).join(' · ')}</span>
                    <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{c.includePhoto ? 'Photo rides the first text (never to cold contacts)' : 'Text only, no photo'}</span>
                  </span>
                  <Icon name="chevronRight" size={15} color="var(--faint)" />
                </button>
              ) : null}
            </div>

            {hasEvent ? (
              <>
                <Eyebrow icon="calendar" style={{ marginTop: 22 }}>The event</Eyebrow>
                <div className="kc-section" style={{ marginTop: 10, padding: 13, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 46, borderRadius: 11, overflow: 'hidden', border: '1px solid var(--line)', textAlign: 'center', flexShrink: 0, background: 'var(--surfaceHi)' }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: '#fff', background: 'var(--kind-openhouse)', padding: '3px 0' }}>{fmtTz(c.event.startAt, { month: 'short' }).toUpperCase()}</div>
                    <div className="km-num" style={{ fontSize: 19, padding: '3px 0 4px' }}>{fmtTz(c.event.startAt, { day: 'numeric' })}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 600 }}>{c.event.title || 'Event'}</div>
                    <div className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{fmtWhen(c.event.startAt, { todayWord: true })}{c.event.address ? ` · ${c.event.address}` : ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 5, fontSize: 12, color: 'var(--faint)', flexWrap: 'wrap' }}>
                      {c.event.rsvp !== false ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><LaneDot lane="green" size={6} />{counts.green} said yes</span> : null}
                      {c.invite && c.invite.url ? (
                        <a href={mediaUrl(c.invite.url)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--bright)', fontWeight: 600 }}>
                          <Icon name="calendarCheck" size={12} />Calendar invite
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            <Eyebrow icon="reply" style={{ marginTop: 22 }} right={lanesEditable ? <button type="button" onClick={openLanes} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bright)', letterSpacing: 0, textTransform: 'none' }}>Edit</button> : null}>After they reply</Eyebrow>
            <button type="button" className={`kc-section ${lanesEditable ? 'km-press' : ''}`} onClick={lanesEditable ? openLanes : undefined} disabled={!lanesEditable} style={{ marginTop: 10, padding: '10px 13px', width: '100%', textAlign: 'left', display: 'block', color: 'inherit' }}>
              {['green', 'yellow', 'red', 'gray'].map((k) => {
                const l = (c.lanes || {})[k] || {};
                const steps = Array.isArray(l.steps) ? l.steps : [];
                const off = l.enabled === false;
                const text = off ? 'Off'
                  : k === 'gray' ? (String(l.text || '').trim() ? `Quiet for ${String(l.timerText || '2 days').toLowerCase()}, then one nudge` : 'No nudge')
                    : steps.length ? laneSummary(steps) : (String(l.action || '').trim() || 'No follow-up');
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', fontSize: 13, color: off ? 'var(--faint)' : 'var(--dim)' }}>
                    <LaneDot lane={k} size={7} glow={!off} />
                    <span style={{ width: 76, flexShrink: 0, color: off ? 'var(--faint)' : 'var(--text)', fontWeight: 600 }}>{LANE_META[k].short}</span>
                    <span className="km-truncate" style={{ minWidth: 0 }}>{text}</span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: aiDraft ? 'var(--bright)' : 'var(--faint)', marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <Icon name={aiDraft ? 'sparkle' : 'user'} size={12} />
                {aiDraft ? 'Questions get an AI-drafted answer for your OK' : 'Questions come straight to you'}
              </div>
            </button>

            <InfoNote kind="route" style={{ marginTop: 16 }}>Campaign texts stay out of your main inbox. When someone replies, their thread moves to your inbox. Text anyone yourself and the automation stands down for them for good.</InfoNote>
            <div style={{ height: 20 }} />
          </>
        ) : null}
      </div>

      {/* Campaign actions */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={c ? c.name : ''} subtitle={c ? (STATUS_LABEL[phase] || '') : ''} left={false}>
        {({ close }) => (c ? (
          <div className="kc-list">
            {c.status === 'paused' && !isAuto && !needsLine ? <ActionRow icon="play" label="Resume sending" onClick={() => { close(); resume(); }} /> : null}
            {live && !isAuto ? <ActionRow icon="pause" label="Pause sending" sub="Queued texts and follow-ups wait" onClick={() => { close(); pause(); }} /> : null}
            {!isAuto ? <ActionRow icon="copy" label="Duplicate as a draft" onClick={() => { close(); duplicate(); }} /> : null}
            {lanesEditable ? <ActionRow icon="reply" label="Edit the reply plan" onClick={() => { close(); setTimeout(openLanes, 260); }} /> : null}
            {isAuto ? <ActionRow icon="zap" label="Open automations" onClick={() => { close(); nav.openCampaigns(); }} /> : null}
            {stoppable ? <ActionRow icon="x" label="Stop campaign" sub="Cancels unsent texts and follow-ups" danger onClick={() => { close(); stop(); }} /> : null}
            {!isAuto && c.status !== 'running' ? <ActionRow icon="trash" label="Delete campaign" danger onClick={() => { close(); setTimeout(remove, 260); }} /> : null}
          </div>
        ) : null)}
      </Sheet>

      {/* Reply plan editor */}
      <Sheet open={lanesOpen} onClose={() => setLanesOpen(false)} title="After they reply" maxHeight="92%"
        right={{ label: savingLanes ? 'Saving' : 'Save', disabled: savingLanes, onClick: saveLanes }}>
        {lanesDraft ? (
          <div>
            <InfoNote style={{ marginBottom: 12 }}>Changes apply to everyone still in a lane. Queued follow-ups are re-timed. Texts already sent stay as they were.</InfoNote>
            <TrafficLanes value={lanesDraft} onChange={setLanesDraft} hasEvent={hasEvent} />
            <Button block style={{ marginTop: 16 }} onClick={saveLanes} loading={savingLanes}>Save reply plan</Button>
          </div>
        ) : null}
      </Sheet>

      {/* Recipient actions */}
      <Sheet open={!!rec} onClose={() => setRec(null)} title={rec ? rec.name : ''} subtitle={rec ? activityLine(rec) : ''} left={false}>
        {({ close }) => (rec ? (
          <>
            <div className="kc-list">
              <ActionRow icon="messageSquare" label="Open thread" onClick={() => { close(); openThread(rec); }} />
              <ActionRow icon="user" label="Open client card" onClick={() => { close(); nav.openClient(rec.clientId); }} />
            </div>
            {!isAuto && !['opted_out', 'muted', 'canceled', 'failed'].includes(rec.status) && rec.lastSentAt ? (
              <>
                <MonoLabel style={{ display: 'block', margin: '16px 4px 8px' }}>Wrong lane? Put them in</MonoLabel>
                <div className="kc-list">
                  {['green', 'yellow', 'red'].map((k) => (
                    <ActionRow key={k} dot={k} label={LANE_META[k].title} sub={rec.lane === k ? 'Current lane' : LANE_META[k].sub}
                      onClick={() => { close(); if (rec.lane !== k) moveLane(rec, k); }} />
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--faint)', margin: '8px 4px 0', lineHeight: 1.4 }}>
                  {rec.status === 'taken_over' ? 'You have this thread, so only event reminders still go out.' : 'Their follow-ups switch to that lane’s plan.'}
                </div>
              </>
            ) : null}
            {!['opted_out', 'canceled'].includes(rec.status) ? (
              <div className="kc-list" style={{ marginTop: 14 }}>
                <ActionRow icon={rec.status === 'muted' ? 'volume' : 'bell'} label={rec.status === 'muted' ? 'Unmute' : 'Mute for this campaign'} sub={rec.status === 'muted' ? null : 'Nothing else from this campaign goes to them'}
                  danger={rec.status !== 'muted'} onClick={() => { close(); toggleMute(rec); }} />
              </div>
            ) : null}
          </>
        ) : null)}
      </Sheet>
    </PushPanel>
  );
}
