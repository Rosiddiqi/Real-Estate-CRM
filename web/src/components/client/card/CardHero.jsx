// CardHero — RevMatch "Ignition" hero, re-geared and dressed in Soul: faint
// HUD rings, relationship halo (highlight arc = real touch strength over 90
// days), Inter Light name, name (tap to copy),
// company/role, tap-to-copy phone/email, money instrument cluster
// (LIFETIME VOLUME · CLOSINGS · AVG PRICE), WHALE toggle + tap stars,
// status/source/type chips, AI status line, five square glass action tiles.
import { useState } from 'react';
import Icon from '../../ui/Icon';
import { mediaUrl } from '../../../api/client';
import { getInitials, formatPhone, moneyCompact } from '../../../lib/format';
import { haptic } from '../../../lib/native';
import { STATUS, TYPE_LABEL, humanize, copyText, displayName } from '../clientKit';

const R = 37;
const CIRC = 2 * Math.PI * R;

function Hud() {
  return (
    <svg className="kc-hud" width="384" height="196" viewBox="0 0 384 196" aria-hidden="true">
      <defs>
        <radialGradient id="kcHudFade" cx="50%" cy="32%" r="56%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.8" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="kcHudMask"><rect width="384" height="196" fill="url(#kcHudFade)" /></mask>
      </defs>
      <g mask="url(#kcHudMask)" stroke="var(--kc-hud)" fill="none">
        {[62, 98, 136, 176].map((r) => <circle key={r} cx="192" cy="62" r={r} strokeWidth="1" />)}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * Math.PI * 2; const r1 = 176; const r2 = i % 5 === 0 ? 163 : 170;
          return <line key={i} x1={192 + r1 * Math.cos(a)} y1={62 + r1 * Math.sin(a)} x2={192 + r2 * Math.cos(a)} y2={62 + r2 * Math.sin(a)} strokeWidth="1" />;
        })}
      </g>
    </svg>
  );
}

function Halo({ client, strength }) {
  const pct = Math.max(0.06, Math.min(1, (strength ?? 60) / 100));
  const initials = getInitials(displayName(client));
  const [badAvatar, setBadAvatar] = useState(null);
  return (
    <div className="kc-halo" title={strength != null ? `Relationship strength ${strength}/100` : undefined}>
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <defs>
          <linearGradient id="kcArc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--hl)" />
            <stop offset="1" stopColor="var(--hl)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i / 36) * Math.PI * 2; const r1 = 41; const r2 = i % 3 === 0 ? 37.2 : 39;
          return <line key={i} x1={42 + r1 * Math.cos(a)} y1={42 + r1 * Math.sin(a)} x2={42 + r2 * Math.cos(a)} y2={42 + r2 * Math.sin(a)} stroke="var(--kc-fillHi)" strokeWidth="1" />;
        })}
        <circle cx="42" cy="42" r={R} fill="none" stroke="var(--kc-fill)" strokeWidth="2.5" />
        <circle
          cx="42" cy="42" r={R} fill="none" stroke="url(#kcArc)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${CIRC * pct} ${CIRC}`} transform="rotate(-90 42 42)"
          style={{ transition: 'stroke-dasharray .8s var(--km-ease)' }}
        />
      </svg>
      <span className="kc-puck">
        {client.avatarUrl && badAvatar !== client.avatarUrl ? <img src={mediaUrl(client.avatarUrl)} alt="" onError={() => setBadAvatar(client.avatarUrl)} /> : initials ? <span className="kc-puck-initials">{initials}</span> : <Icon name="user" size={24} color="var(--text)" />}
      </span>
    </div>
  );
}

function ContactLine({ icon, value, copy }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`kc-cline ${done ? 'kc-cline--copied' : ''}`}
      onClick={() => { copyText(copy || value); haptic('light'); setDone(true); setTimeout(() => setDone(false), 1000); }}
      aria-label={`Copy ${value}`}
    >
      <Icon name={icon} size={12} color="var(--faint)" />
      <span className="km-selectable" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <Icon name={done ? 'check' : 'copy'} size={11} color={done ? 'var(--hl-ink)' : 'var(--ghost)'} stroke={done ? 2 : 1.5} />
    </button>
  );
}

function StarRow({ value, onSet }) {
  return (
    <div style={{ display: 'flex' }} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onSet(i === value ? 0 : i)} aria-label={`${i} star${i > 1 ? 's' : ''}`} style={{ width: 22, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.65 1.13 6.58L12 17.57l-5.9 3.1 1.13-6.58L2.45 9.44l6.6-.96L12 2.5z" fill={i <= value ? 'var(--text)' : 'none'} stroke={i <= value ? 'var(--text)' : 'var(--ghost)'} strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function Act({ icon, label, primary, onTap, disabled }) {
  return (
    <button type="button" className={`kc-act ${primary ? 'kc-act--primary' : ''}`} onClick={onTap} aria-label={label} disabled={disabled} style={{ opacity: disabled ? 0.4 : 1 }}>
      <span className="kc-act-c">
        <Icon name={icon} size={20} stroke={1.5} color="currentColor" />
      </span>
      <span>{label}</span>
    </button>
  );
}

// Hero status line: the stored AI summary's "Status" sentence when there is
// one (richer narrative), else the briefing status line.
export function heroLine(client, briefing) {
  const raw = client && client.aiSummary ? String(client.aiSummary) : '';
  if (raw) {
    const m = /\*\*Status:\*\*\s*([^\n]+)/i.exec(raw);
    const text = (m ? m[1] : raw.replace(/\*\*[^*]+\*\*/g, '').split(/\n/).find((l) => l.trim()) || '').trim();
    const sentence = (/^(.{20,200}?[.!?])(\s|$)/.exec(text) || [null, text.slice(0, 180)])[1];
    if (sentence) return sentence.trim();
  }
  return briefing?.statusLine || null;
}

function fmtClosings(n) {
  if (!n) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function CardHero({ client, briefing, onWhale, onRate, onCall, onText, onEmail, onMeet, onVideo, onSummary, onReferrer }) {
  const [nameCopied, setNameCopied] = useState(false);
  const name = displayName(client);
  const stats = client.stats || {};
  const volume = stats.lifetimeVolume ?? client.lifetimeVolume ?? 0;
  const closings = stats.closings ?? client.transactionsCount ?? 0;
  const avg = stats.avgPrice ?? (closings > 0 && volume ? Math.round(volume / closings) : null);
  const pipeline = stats.pipelineVolume || 0;
  const isPerson = client.contactKind === 'client' || !client.contactKind;
  const role = [client.jobTitle, client.company].filter(Boolean).join(' · ')
    || (!isPerson ? [humanize(client.vendorRole), client.contactKind === 'vendor' ? 'Vendor' : 'Partner'].filter(Boolean).join(' · ') : null);
  const status = STATUS[client.status];
  const summary = heroLine(client, briefing);

  return (
    <div className="kc-hero">
      <Hud />
      <Halo client={client} strength={client.strength?.score} />
      <button
        type="button"
        className={`kc-name ${nameCopied ? 'kc-name--copied' : ''}`}
        onClick={() => { copyText(name); setNameCopied(true); setTimeout(() => setNameCopied(false), 1000); }}
        aria-label={`Copy name ${name}`}
      >
        <span className="km-truncate km-selectable">{name}</span>
        {client.isWhale ? <Icon name="crown" size={16} color="var(--text)" stroke={1.5} /> : null}
        {nameCopied ? <Icon name="check" size={14} color="var(--hl-ink)" stroke={2} /> : null}
      </button>
      {role ? <div className="kc-role km-truncate" style={{ maxWidth: '100%' }}>{role}</div> : null}

      {(client.phone || client.email) ? (
        <div className="kc-contactlines" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 5 }}>
          {client.phone ? <ContactLine icon="phone" value={formatPhone(client.phone)} copy={formatPhone(client.phone)} /> : null}
          {client.email ? <ContactLine icon="mail" value={client.email} /> : null}
        </div>
      ) : null}

      <div className="kc-money">
        <div className="kc-money-grid">
          {[
            // Nothing closed yet but money in motion → show what's in the pipeline.
            !volume && pipeline > 0
              ? ['IN PIPELINE', moneyCompact(pipeline), 'var(--text)', 'none']
              : ['LIFETIME VOLUME', volume ? moneyCompact(volume) : '—', 'var(--text)', 'none'],
            ['CLOSINGS', fmtClosings(closings), 'var(--text)', 'none'],
            ['AVG PRICE', avg ? moneyCompact(avg) : '—', 'var(--text)', 'none'],
          ].map(([label, val, color, glow]) => (
            <div key={label} className="kc-money-cell">
              <span className="kc-money-val" style={{ color, textShadow: glow }}>{val}</span>
              <span className="kc-money-lbl">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="kc-pills">
        <button type="button" className={`kc-whale ${client.isWhale ? 'kc-whale--on' : ''}`} onClick={() => onWhale(!client.isWhale)} aria-pressed={!!client.isWhale}>
          <Icon name="diamond" size={10} stroke={1.8} /> WHALE
        </button>
        <StarRow value={client.rating || 0} onSet={onRate} />
      </div>

      <div className="kc-chiprow">
        {status ? <span className={`kc-chip kc-chip--${status.tone}`}>{status.label}</span> : null}
        {isPerson && TYPE_LABEL[client.type] ? <span className="kc-chip kc-chip--gray">{TYPE_LABEL[client.type]}</span> : null}
        {client.referredBy || (client.leadSource && ![status?.label, TYPE_LABEL[client.type]].some((l) => l && l.toLowerCase() === humanize(client.leadSource).toLowerCase())) ? (
          <button type="button" className="kc-chip kc-chip--gray" onClick={client.referredBy ? onReferrer : undefined}>
            {client.referredBy ? <Icon name="handshake" size={11} stroke={2} /> : null}
            {client.referredBy ? `Referral · ${client.referredBy.firstName || displayName(client.referredBy)}` : humanize(client.leadSource)}
          </button>
        ) : null}
        {client.blocked ? <span className="kc-chip kc-chip--orange"><Icon name="lock" size={10} stroke={2.2} /> Blocked</span> : null}
      </div>

      {summary ? (
        <button type="button" className="kc-summary" onClick={onSummary}>
          <Icon name="sparkle" size={14} color="var(--hl-ink)" stroke={1.7} />
          <span className="km-clamp-2">{summary}</span>
        </button>
      ) : null}

      <div className="kc-seam" />
      <div className="kc-acts">
        <Act icon="phone" label="Call" primary onTap={onCall} disabled={!client.phone} />
        <Act icon="message" label="Text" onTap={onText} />
        <Act icon="mail" label="Email" onTap={onEmail} disabled={!client.email} />
        <Act icon="calendar" label="Meet" onTap={onMeet} />
        <Act icon="video" label="Video" onTap={onVideo} />
      </div>
    </div>
  );
}
