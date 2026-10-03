// CampaignCard — one campaign in the Campaigns list (RevMatch CampaignCard):
// accent spine, trigger icon, name + status pill, audience, progress
// (sent / total), reply rate, and the lane mini-bar. AutomationRow — one
// default automation with its switch. SwipeRow — swipe left to delete.
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { Switch } from '../ui/kit';
import { relativeTime } from '../../lib/format';
import { StatusPill, LaneBar, LaneTally, Progress, campaignPhase, fmtEta, fmtWhen } from './kit';

export const TEMPLATE_ICON = {
  just_listed: 'sign', just_sold: 'key', open_house_invite: 'door', price_improvement: 'trendingDown',
  market_update: 'barChart', home_anniversary: 'cake', coming_soon: 'lock', custom: 'send',
};
const STEP_NAMES = ['Audience', 'Message', 'Event', 'Replies', 'Review'];

export function CampaignCard({ campaign: c, onOpen, index = 0 }) {
  const s = c.stats || {};
  const phase = campaignPhase(c);
  const icon = TEMPLATE_ICON[c.trigger] || 'send';
  const total = s.total || 0;
  const sent = s.sent || 0;
  const draft = c.status === 'draft';
  const builderStage = (c.builder && c.builder.stage) || 0;
  return (
    <button
      type="button"
      className="kp-card km-press km-row-in"
      onClick={onOpen}
      style={{ '--kp-accent': c.accent || '#2E8BFF', animationDelay: `${Math.min(index, 10) * 35}ms` }}
    >
      <span className="kp-card-spine" />
      <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span className="kp-card-icon"><Icon name={icon} size={16} stroke={2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="km-truncate" style={{ display: 'block', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{c.name}</span>
          <span className="km-truncate" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>
            <Icon name="users" size={12} color="var(--faint)" />
            {draft ? (c.audienceSummary || 'No audience yet') : `${total} · ${c.audienceSummary || 'Custom list'}`}
          </span>
        </span>
        <StatusPill status={phase} />
      </span>

      {draft ? (
        <>
          <span className="km-clamp-2" style={{ marginTop: 9, fontSize: 13, lineHeight: 1.42, color: c.brief ? 'var(--dim)' : 'var(--faint)', fontStyle: c.brief ? 'normal' : 'italic' }}>
            {c.brief || 'No message yet, tap to finish'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, fontSize: 12, color: 'var(--bright)' }}>
            <Icon name="compose" size={12} />
            Pick up at {STEP_NAMES[Math.min(builderStage, 4)]}
            <span style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{relativeTime(c.updatedAt)}</span>
          </span>
        </>
      ) : null}

      {phase === 'scheduled' ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>
          <Icon name="clock" size={13} />
          Starts {fmtWhen(c.launchedAt || (c.schedule && c.schedule.startAt), { todayWord: true })}
        </span>
      ) : null}

      {!draft && phase !== 'scheduled' ? (
        <span style={{ display: 'block', marginTop: 11 }}>
          {phase === 'sending' || phase === 'paused' ? <Progress value={sent} total={total} style={{ marginBottom: 8 }} /> : null}
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--dim)' }}>
            <span className="km-num" style={{ fontWeight: 600, color: 'var(--text)' }}>{sent}<span style={{ color: 'var(--faint)', fontWeight: 500 }}>/{total} sent</span></span>
            {sent ? <span><span className="km-num" style={{ color: 'var(--green)', fontWeight: 700 }}>{Math.round(s.replyRate || 0)}%</span> replied</span> : null}
            <LaneTally lanes={s.lanes} />
            {phase === 'sending' && s.eta ? <span className="kp-mono" style={{ marginLeft: 'auto' }}>{fmtEta(s.eta)}</span> : null}
          </span>
          <LaneBar lanes={s.lanes} style={{ marginTop: 9 }} />
          {c.status === 'paused' && c.schedule && c.schedule.pauseReason === 'needs_texting_line' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 11.5, color: 'var(--amber)' }}>
              <Icon name="phone" size={12} />
              Paused — needs a texting line
            </span>
          ) : s.deferred ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 11.5, color: 'var(--amber)' }}>
              <Icon name="shield" size={12} />
              {s.deferred} waiting · {s.deferredReason || 'held for a safe slot'}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

// held: on, but nothing can send ('device' messaging mode, no texting line).
export function AutomationRow({ automation: a, onToggle, onOpen, busy, index = 0, held = false }) {
  const last = a.lastSentAt || a.lastRunAt;
  return (
    <div className="kp-auto km-row-in" style={{ '--kp-accent': a.accent, animationDelay: `${Math.min(index, 10) * 35}ms` }}>
      <button type="button" className="km-press" onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="kp-auto-tile"><Icon name={a.icon || 'zap'} size={17} stroke={2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: a.enabled ? 'var(--text)' : 'var(--dim)' }}>{a.name}</span>
          <span className="km-clamp-2" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 1, lineHeight: 1.35 }}>{a.when}</span>
          {held ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 11.5, color: 'var(--amber)' }}>
              <Icon name="phone" size={11} />
              Paused — needs a texting line
            </span>
          ) : null}
          <span className="kp-mono" style={{ display: held ? 'none' : 'flex', flexWrap: 'wrap', gap: '2px 7px', marginTop: 5, fontSize: 8.5 }}>
            <span>{a.audienceCount} qualify</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ color: a.approval === 'draft' ? 'var(--amber)' : 'var(--faint)' }}>{a.approval === 'draft' ? 'You approve' : 'Auto-send'}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{last ? `Ran ${relativeTime(last)}` : 'Not run yet'}</span>
            {a.sentCount ? <><span style={{ opacity: 0.5 }}>·</span><span>{a.sentCount} sent</span></> : null}
          </span>
        </span>
      </button>
      <Switch checked={a.enabled} disabled={busy} onChange={(v) => onToggle && onToggle(a, v)} label={`${a.name} ${a.enabled ? 'on' : 'off'}`} />
    </div>
  );
}

// Swipe left to reveal Delete (drafts / done campaigns).
export function SwipeRow({ children, onDelete, id, openId, setOpenId, radius = 16, label = 'Delete' }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const open = openId === id;
  const W = 92;
  useEffect(() => { if (!open) setDx(0); }, [open]);
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, base: open ? -W : 0, moved: false, axis: null };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.axis) { if (Math.abs(mx) < 6 && Math.abs(my) < 6) return; d.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'; }
    if (d.axis !== 'x') return;
    d.moved = true;
    setDx(Math.max(-W - 30, Math.min(0, d.base + mx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    if (dx < -W / 2) { setDx(-W); setOpenId(id); } else { setDx(0); if (open) setOpenId(null); }
  };
  return (
    <div style={{ position: 'relative', borderRadius: radius, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onDelete}
        aria-label={label}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'var(--red)', color: '#fff', fontSize: 12.5, fontWeight: 600, opacity: dx < -4 ? 1 : 0, transition: 'opacity 0.15s' }}
      >
        <Icon name="trash" size={18} />
        {label}
      </button>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => { if (dx !== 0) { e.preventDefault(); e.stopPropagation(); setDx(0); setOpenId(null); } }}
        style={{ transform: `translate3d(${dx}px,0,0)`, transition: drag.current ? 'none' : 'transform 0.28s var(--km-ease)', touchAction: 'pan-y', position: 'relative', background: 'var(--bg)', borderRadius: radius }}
      >
        {children}
      </div>
    </div>
  );
}
