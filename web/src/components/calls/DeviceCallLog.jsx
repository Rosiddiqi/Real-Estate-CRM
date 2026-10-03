// DeviceCallLog — the agent is back from a call their own phone placed (device
// mode: no Twilio, not the demo line). How did it go (Talked · Voicemail · No
// answer), how long (estimated from the time away, editable) and notes. Save
// logs it to the client's timeline; with notes, the usual post-call recap
// follows (summary + one-at-a-time follow-ups). "Not now" keeps it as dialed.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { useOverlayDepth, panelZ } from '../ui/depth';
import { haptic } from '../../lib/native';
import { formatPhone } from '../../lib/format';
import { callStore, useCallState } from './callStore';
import { fmtShort } from './callUtil';
import CallRecap from './CallRecap';
import '../../styles/calls.css';
import { useAssistant } from '../../hooks/useAssistant';

const OUTCOMES = [
  { id: 'talked', label: 'Talked', icon: 'phone' },
  { id: 'voicemail', label: 'Voicemail', icon: 'voicemail' },
  { id: 'no_answer', label: 'No answer', icon: 'phoneMissed' },
];
const LOGGED = { talked: 'Talked', voicemail: 'Left a voicemail', no_answer: 'No answer' };

// "4:12" · "4" (minutes) · "4m" · "45s" → seconds
function parseDur(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return null;
  let m = /^(\d{1,3}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Math.min(59, Number(m[2]));
  m = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds)$/.exec(t);
  if (m) return Math.round(Number(m[1]));
  m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

export default function DeviceCallLog({ onClose }) {
  const { name: assistant } = useAssistant();
  const st = useCallState();
  const depth = useOverlayDepth();
  const dev = useRef(st.device).current; // snapshot — the store clears it once logged
  const away = dev ? Math.max(0, dev.awaySec ?? Math.round((Date.now() - dev.at) / 1000)) : 0;
  const [outcome, setOutcome] = useState(away >= 45 ? 'talked' : null);
  const [durText, setDurText] = useState(fmtShort(away));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    document.body.classList.add('km-tabbar-hidden');
    callStore.setScreenOpen(true);
    return () => { document.body.classList.remove('km-tabbar-hidden'); callStore.setScreenOpen(false); };
  }, []);
  useEffect(() => { if (!dev) onClose?.(); }, [dev, onClose]);

  const close = () => { setLeaving(true); setTimeout(() => onClose?.(), 280); };
  const notNow = () => { callStore.dismissDevice(); close(); };
  const done = () => { callStore.dismiss(); close(); };
  const handoff = (fn) => { callStore.dismiss(); setLeaving(true); setTimeout(() => { onClose?.(); setTimeout(fn, 60); }, 280); };

  const durSec = parseDur(durText);
  const bump = (delta) => {
    const next = Math.max(0, Math.min(6 * 3600, (durSec ?? away) + delta));
    setDurText(fmtShort(next));
    haptic('selection');
  };

  const save = async () => {
    if (!outcome || saving) return;
    setSaving(true);
    try {
      const call = await callStore.logDevice({ outcome, durationSec: outcome === 'no_answer' ? 0 : (durSec ?? away), notes: notes.trim() });
      haptic('success');
      if (notes.trim()) {
        setLogged(call);
      } else {
        toast.success(`Logged · ${LOGGED[outcome]}${outcome === 'talked' ? ` ${fmtShort(call.durationSec)}` : ''}`);
        close();
      }
    } catch (err) {
      toast.error(err.message || 'Couldn’t log the call');
      setSaving(false);
    }
  };

  if (!dev) return null;
  const base = dev.call;
  const name = dev.name || (base.client && base.client.name) || (base.otherNumber ? formatPhone(base.otherNumber) : 'Unknown');
  const recapCall = logged ? (st.call && st.call.id === logged.id ? st.call : logged) : null;

  const body = recapCall ? (
    <CallRecap call={recapCall} lines={[]} onDone={done} onHandoff={handoff} />
  ) : (
    <>
      <div className="km-call-top">
        <button type="button" className="km-call-round km-lg km-lg--light" onClick={notNow} aria-label="Not now"><Icon name="x" size={18} stroke={2.2} /></button>
        <div className="km-call-timer km-lg km-lg--light"><Icon name="phone" size={13} stroke={2.2} color="var(--green)" />From your phone · {fmtShort(away)}</div>
        <span style={{ width: 40 }} />
      </div>
      <div className="km-recap-body km-dlog">
        <div className="km-call-inner">
          <div className="km-call-hero" style={{ paddingTop: 14, paddingBottom: 12 }}>
            <Avatar name={base.client || dev.name ? name : null} seed={base.clientId || base.otherNumber} src={base.client ? base.client.avatarUrl : null} size={60} />
            <div className="km-call-name" style={{ fontSize: 23 }}>{name}</div>
            <div className="km-call-meta">Outgoing call{base.otherNumber ? ` · ${formatPhone(base.otherNumber)}` : ''}</div>
          </div>

          <div className="km-recap-card">
            <div className="km-recap-eyebrow">How did it go?</div>
            <div className="km-dlog-outcomes" role="radiogroup" aria-label="Call outcome">
              {OUTCOMES.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id} className={`km-dlog-chip ${outcome === o.id ? 'is-on' : ''} km-dlog-chip--${o.id}`}
                  onClick={() => { setOutcome(o.id); haptic('selection'); }}>
                  <Icon name={o.icon} size={17} stroke={2} />{o.label}
                </button>
              ))}
            </div>
            {outcome !== 'no_answer' ? (
              <div className="km-dlog-dur">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="km-dlog-label">{outcome === 'voicemail' ? 'Voicemail length' : 'Duration'}</div>
                  <div className="km-dlog-hint">Estimated from your time away</div>
                </div>
                <button type="button" className="km-dlog-step" onClick={() => bump(-60)} aria-label="One minute less"><Icon name="minus" size={16} stroke={2.4} /></button>
                <input className="km-dlog-durinput" value={durText} onChange={(e) => setDurText(e.target.value)} onBlur={() => { if (durSec != null) setDurText(fmtShort(durSec)); }}
                  inputMode="text" aria-label="Call length (m:ss)" aria-invalid={durSec == null} />
                <button type="button" className="km-dlog-step" onClick={() => bump(60)} aria-label="One minute more"><Icon name="plus" size={16} stroke={2.4} /></button>
              </div>
            ) : null}
          </div>

          <div className="km-recap-card" style={{ marginTop: 12 }}>
            <div className="km-recap-eyebrow"><Icon name="sparkle" size={12} stroke={2.2} color="var(--hl)" />Notes</div>
            <textarea className="km-dlog-notes km-selectable" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={outcome === 'no_answer' ? 'Anything to remember? (optional)' : 'What did you cover? Dates, next steps, anything you promised…'} />
            <div className="km-dlog-hint" style={{ marginTop: 8 }}>{assistant} turns your notes into follow-ups — the showing to book, the to-dos you promised, a text to send.</div>
          </div>

          <div className="km-sg-actions" style={{ marginTop: 16 }}>
            <button type="button" className="km-sg-btn km-lg km-lg--light" onClick={notNow} disabled={saving}>Not now</button>
            <button type="button" className="km-sg-btn km-sg-btn--yes" onClick={save} disabled={!outcome || saving || (outcome !== 'no_answer' && durSec == null)}>
              {saving ? <Spinner size={16} color="currentColor" /> : null}{notes.trim() ? 'Save & get follow-ups' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(
    <div className={`km-call ${leaving ? 'is-leaving' : ''}`} style={{ zIndex: panelZ(depth) }} role="dialog" aria-label={`Log your call with ${name}`}>
      <div className="km-call-ambient" aria-hidden="true" />
      <div className="km-call-floor" aria-hidden="true" />
      {body}
    </div>,
    document.body,
  );
}
