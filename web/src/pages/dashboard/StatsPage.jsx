// Stats — page 1 of Home. Fully wired (RevMatch's was half-wired):
//   02 Scoreboard  — pace ring (closings vs monthly goal), volume bar, GCI MTD
//                    + projected EOM; MTD / YTD squares open chart pop-ups
//   03 Pipeline    — mini-funnel by phase + hot deals (offer / under contract)
//   04 Pipeline health — stale open deals with the GCI they hold
//   05 Follow-ups  — silent top clients, upcoming closings, deadlines
//   06 Inbox       — unread messages · missed calls glance
// Money prefers the pipeline builder's /commissions/summary; /dashboard/stats
// carries a Deal-row computation as the fallback. Refreshes when the page
// becomes active, on realtime events and on reconnect — holding the previous
// render (dimmed) instead of flashing skeletons.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/ui/Icon';
import Avatar from '../../components/ui/Avatar';
import { Stars } from '../../components/ui/kit';
import { nav } from '../../lib/nav';
import { useResync, useSocket } from '../../hooks/useSocket';
import { getDashboardStats, getCommissionSummary } from '../../api/dashboard';
import { moneyCompact, listTime } from '../../lib/format';
import { BrandMark } from '../../components/ui/BrandMark';
import PageDots from '../../components/battleplan/PageDots';
import Scoreboard from '../../components/dashboard/Scoreboard';
import PipelineHealth from '../../components/dashboard/PipelineHealth';

const ChartSheet = lazy(() => import('../../components/dashboard/ChartSheet'));

function SectionHead({ num, label, trailing }) {
  return (
    <div className="bp-sechead" style={{ padding: '0 24px', marginBottom: 12 }}>
      <span className="bp-sechead-num">{num}</span>
      <span className="bp-sechead-label">{label}</span>
      <span className="bp-sechead-line" />
      {trailing ? <span className="bp-sechead-trail">{trailing}</span> : null}
    </div>
  );
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Prefer the pipeline builder's summary; fall back to our Deal-row numbers.
function mergeMoney(stats, summary) {
  const own = stats.money || {};
  const s = summary && summary.mtd ? summary : null;
  const pick = (a, b) => (num(a) != null ? a : b);
  const mtdGci = pick(s && s.mtd.gci, own.mtd && own.mtd.gci);
  return {
    source: s ? 'commissions' : 'deals',
    mtdGci,
    mtdNet: pick(s && s.mtd.net, own.mtd && own.mtd.net),
    mtdSides: pick(s && s.mtd.sides, own.mtd && own.mtd.sides),
    mtdVolume: pick(s && s.mtd.volume, own.mtd && own.mtd.volume),
    ytdGci: pick(s && s.ytd && s.ytd.gci, own.ytd && own.ytd.gci),
    ytdSides: pick(s && s.ytd && s.ytd.sides, own.ytd && own.ytd.sides),
    ytdVolume: pick(s && s.ytd && s.ytd.volume, own.ytd && own.ytd.volume),
    lastMonthGci: pick(s && s.lastMonth && s.lastMonth.gci, own.lastMonth && own.lastMonth.gci),
    // Projection: the Commissions ledger's own EOM number when it has one (so
    // Home and Commissions agree), else MTD + this month's weighted pipeline.
    weighted: s && s.projected && num(s.projected.eomPending) != null ? s.projected.eomPending : (own.projected ? own.projected.weighted : 0),
    projected: s && s.projected && num(s.projected.eom) != null ? s.projected.eom : (mtdGci || 0) + (own.projected ? own.projected.weighted : 0),
    annualGciGoal: (s && s.goals && s.goals.annualGci) || (stats.goals && stats.goals.annualGci) || null,
  };
}

function Funnel({ phases }) {
  const max = Math.max(1, ...phases.map((p) => p.count));
  return (
    <div style={{ padding: '0 20px' }}>
      <button type="button" className="st-plain km-press" onClick={() => nav.openPipeline()} style={{ width: '100%', padding: '12px 14px', textAlign: 'left' }}>
        {phases.map((p, i) => {
          const closed = p.key === 'closed';
          const col = closed ? 'var(--kind-closing)' : `color-mix(in srgb, var(--blue) ${45 + i * 13}%, transparent)`;
          return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ width: 92, fontSize: 12, color: closed ? 'var(--text)' : 'var(--dim)', fontWeight: closed ? 500 : 500 }} className="km-truncate">{p.label}</span>
              <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bp-fill)', position: 'relative' }}>
                <span className="st-funnel-bar" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(p.count ? 4 : 0, (p.count / max) * 100)}%`, background: col }} />
              </span>
              <span style={{ width: 22, textAlign: 'right', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{p.count}</span>
              <span style={{ width: 56, textAlign: 'right', fontSize: 11, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{p.volume ? moneyCompact(p.volume) : '—'}</span>
            </div>
          );
        })}
      </button>
    </div>
  );
}

function HotDeals({ deals }) {
  if (!deals.length) return null;
  return (
    <div style={{ padding: '10px 20px 0' }}>
      <div className="st-plain" style={{ padding: '4px 14px' }}>
        {deals.map((d) => {
          const soon = d.daysToClose != null && d.daysToClose <= 7;
          return (
            <button key={d.id} type="button" className="st-row km-press" onClick={() => nav.openPipeline(d.id)}>
              <Avatar name={d.clientName} seed={d.clientId} src={d.avatarUrl} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span className="km-truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{d.clientName}</span>
                  {d.whale ? <Icon name="crown" size={12} color="var(--text)" /> : null}
                </div>
                <div className="km-truncate" style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{[d.stageLabel, d.property].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: -0.2 }}>{d.price ? moneyCompact(d.price) : '—'}</div>
                <div style={{ fontSize: 10, fontWeight: 500, marginTop: 2, color: soon ? 'var(--amber)' : 'var(--faint)' }}>
                  {d.daysToClose != null ? (d.daysToClose <= 0 ? 'Closes today' : `Closes in ${d.daysToClose}d`) : `${moneyCompact(d.gci)} GCI`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FollowUps({ f }) {
  const items = [];
  for (const d of f.deadlines || []) {
    items.push({
      key: `dl-${d.dealId}-${d.label}`, icon: 'alert', color: d.days <= 1 ? 'var(--red)' : 'var(--amber)',
      title: `${d.label} deadline · ${d.clientName}`, sub: [d.property, d.days <= 0 ? 'today' : `in ${d.days} day${d.days === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      onClick: () => nav.openPipeline(d.dealId),
    });
  }
  for (const d of f.upcomingClosings || []) {
    items.push({
      key: `cl-${d.id}`, icon: 'key', color: 'var(--kind-closing)',
      title: `Closing · ${d.clientName}`, sub: [d.property, d.daysToClose <= 0 ? 'today' : `in ${d.daysToClose} day${d.daysToClose === 1 ? '' : 's'}`, d.gci ? `${moneyCompact(d.gci)} GCI` : null].filter(Boolean).join(' · '),
      onClick: () => nav.openPipeline(d.id),
    });
  }
  for (const c of f.silentClients || []) {
    items.push({
      key: `sc-${c.id}`, avatar: c, title: c.name, stars: c.rating, whale: c.whale,
      sub: c.daysSilent != null ? `${c.daysSilent} days without a touch` : 'Never contacted',
      onClick: () => nav.openClient(c.id),
      action: c.phone ? { icon: 'message', label: 'Text', onClick: () => nav.openThread({ clientId: c.id }) } : null,
    });
  }
  if (!items.length) {
    return (
      <div style={{ padding: '0 20px' }}>
        <div className="st-plain" style={{ padding: '16px', fontSize: 12.5, color: 'var(--dim)', textAlign: 'center' }}>
          Nothing slipping — every top client has heard from you in the last three weeks.
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: '0 20px' }}>
      <div className="st-plain" style={{ padding: '4px 14px' }}>
        {items.slice(0, 8).map((it) => (
          <div key={it.key} className="st-row">
            <button type="button" onClick={it.onClick} className="km-press" style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, textAlign: 'left' }}>
              {it.avatar ? <Avatar name={it.avatar.name} seed={it.avatar.id} src={it.avatar.avatarUrl} size={34} /> : (
                <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${it.color} 14%, transparent)` }}>
                  <Icon name={it.icon} size={16} color={it.color} stroke={2} />
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span className="km-truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{it.title}</span>
                  {it.whale ? <Icon name="crown" size={12} color="var(--text)" /> : null}
                  {it.stars ? <Stars value={it.stars} size={9} gap={1} /> : null}
                </span>
                <span className="km-truncate" style={{ display: 'block', fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{it.sub}</span>
              </span>
            </button>
            {it.action ? (
              <button type="button" className="km-press" onClick={it.action.onClick} aria-label={it.action.label} style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', color: 'var(--text)' }}>
                <Icon name={it.action.icon} size={15} stroke={2} />
              </button>
            ) : <Icon name="chevronRight" size={14} color="var(--faint)" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxGlance({ inbox }) {
  const tile = (icon, color, value, label, sub, onClick) => (
    <button type="button" className="st-square km-press" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        <Icon name={icon} size={18} color={color} stroke={2} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--font-num)', fontSize: 22, fontWeight: 300, letterSpacing: -0.6, lineHeight: 1 }}>{value}</span>
        <span className="km-truncate" style={{ display: 'block', fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{label}</span>
        {sub ? <span className="km-truncate" style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)', marginTop: 1 }}>{sub}</span> : null}
      </span>
    </button>
  );
  return (
    <div style={{ padding: '0 20px' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {tile('message', 'var(--text)', inbox.unreadMessages, 'Unread', inbox.unreadConversations ? `${inbox.unreadConversations} thread${inbox.unreadConversations === 1 ? '' : 's'}` : null, () => nav.go('inbox'))}
        {tile('phoneMissed', 'var(--red)', inbox.missedCalls, 'Missed calls', null, () => nav.go('phone'))}
      </div>
      {(inbox.recentUnread || []).length ? (
        <div className="st-plain" style={{ padding: '4px 14px', marginTop: 10 }}>
          {inbox.recentUnread.map((c) => (
            <button key={c.id} type="button" className="st-row km-press" onClick={() => nav.openThread({ conversationId: c.id })}>
              <Avatar name={c.name} seed={c.clientId || c.id} src={c.avatarUrl} size={34} channel={c.channel === 'sms' ? 'sms' : 'imessage'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="km-truncate" style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{listTime(c.at)}</span>
                </div>
                <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>{c.preview || 'New message'}</div>
              </div>
              <span className="km-badge" style={{ flexShrink: 0 }}>{c.unread}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="km-skel" style={{ height: 300, borderRadius: 18 }} />
      <div style={{ display: 'flex', gap: 10 }}><div className="km-skel" style={{ flex: 1, height: 96, borderRadius: 16 }} /><div className="km-skel" style={{ flex: 1, height: 96, borderRadius: 16 }} /></div>
      <div className="km-skel" style={{ height: 180, borderRadius: 16 }} />
    </div>
  );
}

export default function StatsPage({ page, onSelectPage, active, topInset = 0 }) {
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [chart, setChart] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [a, b] = await Promise.allSettled([getDashboardStats(), getCommissionSummary()]);
    if (a.status === 'fulfilled') { setStats(a.value); setStatus('ready'); } else setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    setSummary(b.status === 'fulfilled' ? b.value : null);
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (active && status === 'ready') load(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocket(['deal_updated', 'deal_created', 'deal_deleted', 'message_received', 'conversation_read', 'call_updated', 'appointment_updated', 'client_updated'], () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 1500);
  });
  useResync(load);
  useEffect(() => () => clearTimeout(timer.current), []);

  const m = useMemo(() => (stats ? mergeMoney(stats, summary) : null), [stats, summary]);

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', paddingTop: topInset, paddingBottom: 'calc(var(--tabbar-clearance) + var(--safe-bottom) + 12px)' }}>
      <PageDots page={page} onSelectPage={onSelectPage} style={{ padding: '10px 0 14px' }} />
      {status === 'loading' && !stats ? <StatsSkeleton /> : null}
      {status === 'error' && !stats ? (
        <div className="km-empty">
          <div className="km-tile" style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="barChart" size={26} color="var(--faint)" stroke={1.5} /></div>
          <div className="km-empty-title">Stats are catching up</div>
          <div className="km-empty-sub">We couldn’t load your numbers. <button type="button" onClick={load} style={{ color: 'var(--text)', fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }}>Try again</button></div>
        </div>
      ) : null}
      {stats && m ? (
        <div style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity 0.2s' }}>
          <SectionHead num="02" label="Scoreboard" trailing={`${stats.month.label} · DAY ${stats.month.dayOfMonth}/${stats.month.daysInMonth}`} />
          <Scoreboard
            closings={{ units: m.mtdSides ?? stats.closings.mtd, goal: stats.closings.goal, pace: stats.closings.pace }}
            volume={{ units: m.mtdVolume ?? stats.volume.mtd, goal: stats.volume.goal, pace: stats.volume.pace }}
            gci={{ mtd: m.mtdGci, net: m.mtdNet, projected: m.projected, weighted: m.weighted }}
            northStar={stats.northStar}
            monthLabel={stats.month.label}
            onOpenCommissions={() => nav.openCommissions()}
          />
          <div style={{ display: 'flex', gap: 10, padding: '10px 20px 0' }}>
            <button type="button" className="st-square" onClick={() => setChart('mtd')} aria-label="Open month-to-date chart">
              <div className="st-eyebrow">MTD · {stats.month.label}</div>
              <div className="st-value">{moneyCompact(m.mtdGci || 0)}</div>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{Math.round((m.mtdSides || 0) * 10) / 10} sides · {moneyCompact(m.mtdVolume || 0)}</div>
              {(() => {
                // Same point last month (cumulative GCI by this day-of-month).
                const last = (stats.charts && stats.charts.dailyLastMonth) || [];
                const day = Math.min(stats.month.dayOfMonth, last.length || stats.month.dayOfMonth);
                let byNow = 0;
                for (const d of last) if (d.day <= day) byNow += d.gci || 0;
                const mtd = m.mtdGci || 0;
                const up = mtd > byNow; const down = mtd < byNow;
                const lm = String((stats.charts && stats.charts.lastMonthLabel) || 'last month').slice(0, 3);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 10.5, color: 'var(--faint)' }}>
                    <Icon name={up ? 'trendingUp' : down ? 'trendingDown' : 'minus'} size={12} color={up ? 'var(--hl-ink)' : down ? 'var(--amber)' : 'var(--faint)'} />
                    <span className="km-truncate">vs {moneyCompact(byNow)} by {lm} {day}</span>
                  </div>
                );
              })()}
            </button>
            <button type="button" className="st-square" onClick={() => setChart('ytd')} aria-label="Open year-to-date chart">
              <div className="st-eyebrow">YTD · {stats.charts.year}</div>
              <div className="st-value">{moneyCompact(m.ytdGci || 0)}</div>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{Math.round((m.ytdSides || 0) * 10) / 10} sides · {moneyCompact(m.ytdVolume || 0)}</div>
              {m.annualGciGoal ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 4, borderRadius: 2, background: 'rgba(var(--accent-rgb), 0.10)' }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(100, ((m.ytdGci || 0) / m.annualGciGoal) * 100)}%`, background: 'var(--hl)' }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 4 }}>{Math.round(((m.ytdGci || 0) / m.annualGciGoal) * 100)}% of {moneyCompact(m.annualGciGoal)} goal</div>
                </div>
              ) : null}
            </button>
          </div>

          <div style={{ height: 26 }} />
          <SectionHead num="03" label="Pipeline" trailing={`${stats.pipeline.active} ACTIVE · ${moneyCompact(stats.pipeline.weightedGci)} WEIGHTED`} />
          <Funnel phases={stats.pipeline.phases} />
          <HotDeals deals={stats.pipeline.hot} />

          <div style={{ height: 26 }} />
          <SectionHead num="04" label="Pipeline health" trailing={stats.pipeline.atRisk.length ? `${stats.pipeline.atRisk.length} AT RISK` : 'CLEAR'} />
          <PipelineHealth deals={stats.pipeline.atRisk} trapped={stats.pipeline.trappedGci} />

          <div style={{ height: 26 }} />
          <SectionHead num="05" label="Follow-ups" trailing={(stats.followUps.silentClients || []).length ? `${stats.followUps.silentClients.length} GOING COLD` : null} />
          <FollowUps f={stats.followUps} />

          <div style={{ height: 26 }} />
          <SectionHead num="06" label="Inbox" trailing="QUICK GLANCE" />
          <InboxGlance inbox={stats.inbox} />

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 40, color: 'var(--ghost)' }}><BrandMark size={22} dot={false} /></div>
        </div>
      ) : null}

      {chart ? (
        <Suspense fallback={null}>
          <ChartSheet open={!!chart} kind={chart} stats={stats} money={m} onClose={() => setChart(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}

