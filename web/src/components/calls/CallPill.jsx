// CallPill — the minimized live call (RevMatch CallPill), floating at the top
// of every screen while the call screen is closed: pulsing dot + name + timer
// (tap to return), mute, and an arm-then-confirm hang-up so a stray tap never
// drops a client. After a call ends while minimized it offers the recap.
// Device mode: "Calling <name> on your phone…" with Log (open the log screen
// now — e.g. on a desktop with no phone app) and × (keep it as dialed).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import { nav, useNav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { callStore, useCallState } from './callStore';
import { fmtClock } from './callUtil';
import '../../styles/calls.css';

export default function CallPill() {
  const st = useCallState();
  const { overlays } = useNav();
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const armTimer = useRef(null);

  useEffect(() => { callStore.restore(); }, []);
  const call = st.call;
  const live = callStore.isLive(call);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  useEffect(() => () => clearTimeout(armTimer.current), []);

  const screenUp = st.screenOpen || overlays.some((o) => o.type === 'call');
  const dev = st.device;
  if (dev && dev.phase === 'calling' && !screenUp && !callStore.isLive(call)) {
    const who = dev.name ? dev.name.split(' ')[0] : 'them';
    return createPortal(
      <div className="km-call-pill" role="status" aria-label={`Calling ${dev.name || 'them'} on your phone`}>
        <button type="button" className="km-call-pill-main" onClick={() => callStore.openDeviceLog()}>
          <span className="km-call-live is-ringing" />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>Calling {who}…</span>
            <span className="km-truncate" style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>On your phone · tap Log when you hang up</span>
          </span>
        </button>
        <button type="button" className="km-call-pill-log" onClick={() => callStore.openDeviceLog()}>Log</button>
        <button type="button" className="km-call-pill-btn" onClick={() => callStore.dismissDevice()} aria-label="Dismiss"><Icon name="x" size={15} stroke={2.2} /></button>
      </div>,
      document.body,
    );
  }
  const recapWaiting = call && !live && call.answeredAt && (call.recapStatus === 'pending' || (call.suggestions || []).some((s) => !s.status || s.status === 'pending'));
  if (!call || screenUp || (!live && !recapWaiting)) return null;

  const name = (call.client && (call.client.firstName || call.client.name)) || 'Call';
  const open = () => nav.open('call', { callId: call.id, clientId: call.clientId || undefined, name: call.client ? call.client.name : undefined });
  const elapsed = call.answeredAt ? Math.floor((now - new Date(call.answeredAt).getTime()) / 1000) : 0;

  const endTap = () => {
    if (!armed) {
      setArmed(true);
      haptic('warning');
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), 2500);
      return;
    }
    clearTimeout(armTimer.current);
    setArmed(false);
    haptic('heavy');
    callStore.hangup();
  };

  return createPortal(
    <div className="km-call-pill" role="status" aria-label={live ? `On a call with ${name}` : 'Call ended'}>
      <button type="button" className="km-call-pill-main" onClick={open}>
        <span className={`km-call-live ${!call.answeredAt ? 'is-ringing' : ''} ${call.held ? 'is-held' : ''}`} style={live ? null : { background: 'var(--hl)', boxShadow: 'none' }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="km-truncate" style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>{name}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
            {live ? (call.held ? 'On hold' : call.answeredAt ? fmtClock(elapsed) : 'Calling…') : call.recapStatus === 'pending' ? 'Call ended · writing your recap…' : 'Call ended · recap ready'}
          </span>
        </span>
      </button>
      {live ? (
        <>
          <button type="button" className="km-call-pill-btn" onClick={() => callStore.toggleMute()} aria-label={st.muted ? 'Unmute' : 'Mute'} style={st.muted ? { background: '#fff', color: '#06080C' } : null}>
            <Icon name={st.muted ? 'micOff' : 'mic'} size={16} stroke={2} />
          </button>
          <button type="button" className="km-call-pill-btn" onClick={open} aria-label="Return to call"><Icon name="chevronDown" size={16} stroke={2.2} style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" className="km-call-pill-end" onClick={endTap} aria-label={armed ? 'Tap again to end the call' : 'End call'} style={{ minWidth: armed ? 66 : 34 }}>
            <Icon name="phone" size={15} stroke={2} />{armed ? 'End?' : null}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="km-call-pill-btn" onClick={open} aria-label="Open recap" style={{ background: '#fff', color: '#0D0D0D' }}><Icon name="arrowRight" size={16} stroke={2.2} /></button>
          <button type="button" className="km-call-pill-btn" onClick={() => callStore.dismiss()} aria-label="Dismiss"><Icon name="x" size={15} stroke={2.2} /></button>
        </>
      )}
    </div>,
    document.body,
  );
}
