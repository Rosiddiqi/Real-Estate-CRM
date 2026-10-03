// NotificationsPanel — overlay `notifications`. Grouped by day, an icon per
// type, unread dots, tap → deep link (the right thread, client, deal,
// listing, appointment, voicemail…), mark all read. Live via `notification`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import PushPanel from '../ui/PushPanel';
import Icon from '../ui/Icon';
import { EmptyState, SkeletonRows } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { formatDaySep, relativeTime } from '../../lib/format';
import { getNotifications, readAllNotifications, readNotification, bumpBadges } from '../../api/system';
import { useResync, useSocket } from '../../hooks/useSocket';
import '../../styles/calls.css';

const TYPES = {
  message: { icon: 'message', color: 'var(--text)' },
  call_missed: { icon: 'phoneMissed', color: 'var(--red)' },
  missed_call: { icon: 'phoneMissed', color: 'var(--red)' },
  voicemail: { icon: 'voicemail', color: 'var(--violet)' },
  appointment: { icon: 'calendar', color: 'var(--violet)' },
  showing_feedback_due: { icon: 'calendarCheck', color: 'var(--kind-showing)' },
  match: { icon: 'rings', color: 'var(--kind-match)' },
  price_drop: { icon: 'trendingDown', color: 'var(--amber)' },
  deal: { icon: 'pipeline', color: 'var(--blue)' },
  deal_closed: { icon: 'key', color: 'var(--green)' },
  offer_received: { icon: 'handshake', color: 'var(--amber)' },
  contingency_deadline: { icon: 'clock', color: 'var(--amber)' },
  closing_tomorrow: { icon: 'key', color: 'var(--green)' },
  new_lead: { icon: 'userPlus', color: 'var(--green)' },
  client: { icon: 'user', color: 'var(--green)' },
  campaign: { icon: 'send', color: 'var(--cyan)' },
  campaign_reply_suggestion: { icon: 'reply', color: 'var(--cyan)' },
  task: { icon: 'checklist', color: 'var(--blue)' },
  ai: { icon: 'sparkle', color: 'var(--violet)' },
  serena: { icon: 'sparkle', color: 'var(--violet)' },
  system: { icon: 'bell', color: 'var(--dim)' },
};

function deepLink(n) {
  const d = (n.data && typeof n.data === 'object') ? n.data : {};
  const type = d.kind || n.type;
  if (type === 'message' || type === 'campaign_reply_suggestion') {
    if (d.conversationId || d.clientId) return () => nav.openThread({ conversationId: d.conversationId, clientId: d.clientId });
  }
  if (type === 'call_missed' || type === 'missed_call' || type === 'voicemail') {
    return () => {
      const tab = type === 'voicemail' ? 'voicemail' : 'missed';
      try { localStorage.setItem('km_calls_tab', tab); } catch { /* ignore */ }
      nav.go('phone');
      window.dispatchEvent(new CustomEvent('calls:tab', { detail: { tab } }));
    };
  }
  if (d.appointmentId) return () => nav.openAppointment(d.appointmentId);
  if (type === 'appointment' || type === 'showing_feedback_due') return () => nav.openCalendar();
  if (d.dealId) return () => nav.openDeal(d.dealId);
  if (type === 'deal' || type === 'deal_closed' || type === 'offer_received' || type === 'contingency_deadline' || type === 'closing_tomorrow') return () => nav.openPipeline();
  if (d.listingId && (type === 'price_drop' || !d.clientId)) return () => nav.openListing(d.listingId);
  if (d.campaignId) return () => nav.openCampaign(d.campaignId);
  if (type === 'ai' || type === 'serena') return () => nav.openSerena('chat');
  if (d.clientId) return () => nav.openClient(d.clientId);
  if (d.listingId) return () => nav.openListing(d.listingId);
  return null;
}

export default function NotificationsPanel({ onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getNotifications({ limit: 100 })
      .then((r) => { setRows(r.notifications || []); setError(null); })
      .catch((err) => { setError(err.message || 'Couldn’t load notifications'); setRows((x) => x || []); });
  }, []);
  useEffect(load, [load]);
  useResync(load);
  useSocket('notification', (n) => {
    if (!n || !n.id) return;
    setRows((list) => (list ? [n, ...list.filter((x) => x.id !== n.id)] : list));
  });

  const unread = (rows || []).filter((n) => !n.readAt).length;
  const groups = useMemo(() => {
    const out = [];
    for (const n of rows || []) {
      const label = formatDaySep(n.createdAt);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(n); else out.push({ label, items: [n] });
    }
    return out;
  }, [rows]);

  const markAll = async () => {
    const prev = rows;
    const now = new Date().toISOString();
    setRows((list) => (list || []).map((n) => (n.readAt ? n : { ...n, readAt: now })));
    try { await readAllNotifications(); bumpBadges(); } catch { setRows(prev); toast.error('Couldn’t mark them read'); }
  };

  const open = (n) => {
    if (!n.readAt) {
      setRows((list) => (list || []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      readNotification(n.id).then(bumpBadges).catch(() => {});
    }
    const go = deepLink(n);
    if (go) go();
  };

  return (
    <PushPanel
      onClose={onClose}
      title="Notifications"
      subtitle={unread ? `${unread} unread` : undefined}
      right={unread ? <button type="button" onClick={markAll} style={{ fontSize: 15, fontWeight: 500, color: 'var(--bright)', padding: '6px 4px' }}>Read all</button> : null}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
        {rows === null ? (
          <div style={{ padding: '8px 16px' }}><SkeletonRows n={6} /></div>
        ) : error && !rows.length ? (
          <EmptyState icon="alert" title="Couldn’t load notifications" sub={error} action={<button type="button" className="km-btn km-btn--ghost km-btn--sm" onClick={load}>Try again</button>} />
        ) : !rows.length ? (
          <EmptyState icon="bell" title="You’re all caught up" sub="Missed calls, new matches, offers and deal deadlines land here." />
        ) : groups.map((g) => (
          <section key={g.label}>
            <div className="km-ph-day" style={{ position: 'static', background: 'transparent', padding: '16px 18px 6px' }}>{g.label}</div>
            <div style={{ margin: '0 12px', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)' }}>
              {g.items.map((n, i) => {
                const t = TYPES[(n.data && n.data.kind) || n.type] || TYPES[n.type] || TYPES.system;
                const linked = !!deepLink(n);
                return (
                  <button key={n.id} type="button" onClick={() => open(n)} className="km-row-in"
                    style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px 12px 12px', textAlign: 'left', borderBottom: i < g.items.length - 1 ? '1px solid var(--line)' : 0, animationDelay: `${Math.min(i, 12) * 22}ms`, cursor: linked ? 'pointer' : 'default' }}>
                    <span style={{ width: 8, flexShrink: 0, paddingTop: 15 }}>
                      {!n.readAt ? <span style={{ display: 'block', width: 8, height: 8, borderRadius: 4, background: 'var(--blue)', boxShadow: '0 0 8px var(--glow)' }} /> : null}
                    </span>
                    <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: t.color, background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
                      <Icon name={t.icon} size={18} stroke={2} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span className="km-truncate" style={{ flex: 1, fontSize: 15, fontWeight: n.readAt ? 500 : 650 }}>{n.title}</span>
                        <span style={{ fontSize: 12, color: 'var(--faint)', flexShrink: 0 }}>{relativeTime(n.createdAt).replace(' ago', '')}</span>
                      </span>
                      {n.body ? <span className="km-clamp-2 km-selectable" style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 2, lineHeight: 1.4 }}>{n.body}</span> : null}
                    </span>
                    {linked ? <Icon name="chevronRight" size={15} color="var(--faint)" style={{ marginTop: 11 }} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PushPanel>
  );
}
