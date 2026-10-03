// SenderGuardCard — the number's health at a glance (RevMatch §21): a green /
// yellow / red light, today's automated budget used vs left, the
// new-conversation budget, the warm-up step, and a plain reason for every text
// that's waiting. Read-only: the rules are enforced server-side.
import { useCallback, useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import { Skeleton } from '../ui/kit';
import { getSenderGuard } from '../../api/campaigns';
import { useResync, useSocket } from '../../hooks/useSocket';
import { MonoLabel } from './kit';
import { fmtTz } from './tz';

const COLOR = { green: 'var(--green)', yellow: 'var(--amber)', red: 'var(--red)' };
const GLOW = { green: 'rgba(48,210,122,0.85)', yellow: 'rgba(242,169,59,0.85)', red: 'rgba(255,90,86,0.85)' };

const fmtTime = (iso) => fmtTz(iso, { hour: 'numeric', minute: '2-digit' });
const fmtWhen = (iso) => fmtTz(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Label on top, the bar, then "4 of 100 · 96 left" — nothing squeezes at 320px.
function Meter({ label, used, limit, left }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = pct >= 100;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="km-truncate" style={{ fontSize: 12, color: 'var(--dim)' }}>{label}</div>
      <div className="kp-meter"><i style={{ width: `${pct}%`, background: full ? 'var(--amber)' : 'var(--blue)', boxShadow: full ? 'none' : '0 0 8px var(--glow)' }} /></div>
      <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 5 }}>
        <span className="km-num" style={{ fontSize: 13, color: full ? 'var(--amber)' : 'var(--text)' }}>{used}</span> of {limit}{left != null ? ` · ${left} left` : ''}
      </div>
    </div>
  );
}

export default function SenderGuardCard({ style, defaultOpen = false }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const load = useCallback(() => {
    getSenderGuard().then((d) => { setS(d); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);
  useSocket('campaign_updated', load);
  useResync(load);

  if (!s) {
    if (error) return null;
    return (
      <div className="kp-guard" style={style}>
        <Skeleton w="55%" h={12} />
        <div style={{ display: 'flex', gap: 14, marginTop: 14 }}><Skeleton h={22} /><Skeleton h={22} /></div>
      </div>
    );
  }

  const health = s.health || 'green';
  const headline = s.paused ? 'AI texting is off'
    : s.breaker ? `Paused until ${fmtWhen(s.breaker.until)}`
      : s.caution ? 'Number health · caution'
        : s.governed ? 'Number health · slowed'
          : 'Number health · good';
  const sub = s.paused ? 'Nothing sends automatically until you turn it back on. Your own texts still work.'
    : s.breaker ? `${s.breaker.reason}. Every automated text is held to protect your number.`
      : s.caution ? `Sending at half speed until ${fmtWhen(s.caution.until)} after a warning sign.`
        : s.governed ? 'Fewer than 30% of people are replying, so new conversations are cut in half for now.'
          : !s.warmup.full ? `Warming up your number: step ${s.warmup.step + 1} of ${s.warmup.of + 1}, up to ${s.warmup.dailyLimit} new conversations a day.`
            : 'Texts are spaced out, capped and sent 9 AM to 8 PM their time, so your number never looks like spam.';
  const tone = s.paused ? 'red' : health;
  const reasons = Object.entries((s.waiting && s.waiting.reasons) || {}).sort((a, b) => b[1] - a[1]);
  const t = s.today;

  return (
    <div className={`kp-guard ${tone !== 'green' ? `kp-guard--${tone}` : ''}`} style={style}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ width: '100%', textAlign: 'left' }} aria-expanded={open}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="kp-dot" style={{ width: 9, height: 9, background: COLOR[tone], boxShadow: `0 0 10px ${GLOW[tone]}` }} />
          <span className="km-truncate" style={{ minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: COLOR[tone] }}>{headline}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Icon name="shield" size={13} />
            <span className="kp-hide-narrow">Sender Guard</span>
            <Icon name="chevronDown" size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s var(--km-ease)' }} />
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.45 }}>{sub}</div>
      </button>

      <div style={{ display: 'flex', gap: 16, marginTop: 13 }}>
        <Meter label="Automated today" used={t.automated} limit={t.automatedLimit} left={t.automatedLeft} />
        <Meter label="New conversations" used={t.newConversations} limit={t.newTarget} left={t.newLeft} />
      </div>

      {s.waiting && s.waiting.count > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--amber)' }}>
          <Icon name="clock" size={13} />
          {s.waiting.count} text{s.waiting.count === 1 ? '' : 's'} waiting for a safe slot
        </div>
      ) : null}

      {open ? (
        <div className="kp-step-in" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <MonoLabel>Warm-up</MonoLabel>
              <div style={{ fontSize: 13, marginTop: 4 }}>{s.warmup.full ? 'Fully warm' : `Step ${s.warmup.step + 1} of ${s.warmup.of + 1}`}</div>
              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                {Array.from({ length: s.warmup.of + 1 }).map((_, i) => (
                  <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= s.warmup.step ? 'var(--green)' : 'var(--line)' }} />
                ))}
              </div>
            </div>
            <div>
              <MonoLabel>SMS (green) today</MonoLabel>
              <div style={{ fontSize: 13, marginTop: 4 }}>{t.green} / {t.greenLimit}</div>
              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>1 minute apart</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.5, marginTop: 11 }}>
            Counts reset at {fmtTime(t.resetsAt)}. Never more than {t.newHardCap} new people a day, {t.automatedLimit} automated texts, or {t.totalLimit} total with your own. 3 texts per person per day at most, 9 AM to 8 PM in their time zone. A STOP or a hard no pauses everything until tomorrow.
          </div>
          {reasons.length ? (
            <div style={{ marginTop: 11 }}>
              <MonoLabel style={{ marginBottom: 6 }}>Why texts are waiting</MonoLabel>
              {reasons.map(([why, n]) => (
                <div key={why} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: 'var(--dim)', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ minWidth: 0 }}>{why}</span>
                  <span className="km-num" style={{ color: 'var(--faint)', flexShrink: 0 }}>{n}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
