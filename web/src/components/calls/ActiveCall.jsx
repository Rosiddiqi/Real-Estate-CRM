// ActiveCall — overlay `call` ({ clientId, phone, name } or { callId } to
// re-open). Full-screen dark call UI (RevMatch C2Transcript + CallControls):
// glass top bar (minimize · live timer · note), caller hero, relationship
// briefing, rolling live transcript (YOU / THEM, signal ticks), co-pilot cue
// cards for objections, and the control dock (mute · keypad · speaker · add ·
// hold · note · end). Hanging up turns the screen into the post-call recap.
// Minimizing keeps the call alive in the CallPill.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import Sheet from '../ui/Sheet';
import { toast } from '../ui/toast';
import { useOverlayDepth, panelZ } from '../ui/depth';
import { haptic } from '../../lib/native';
import { formatPhone } from '../../lib/format';
import { callStore, useCallState } from './callStore';
import { fmtClock } from './callUtil';
import KeypadSheet from './KeypadSheet';
import CallRecap from './CallRecap';
import '../../styles/calls.css';

function Ctl({ icon, label, on, onClick, disabled }) {
  return (
    <div className="km-call-ctl">
      <button type="button" className={`km-call-ctl-btn km-lg km-lg--light ${on ? 'is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={!!on} aria-label={label}>
        <Icon name={icon} size={25} stroke={1.8} />
      </button>
      <span>{label}</span>
    </div>
  );
}

function useElapsed(since, running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)) : 0;
}

export default function ActiveCall({ clientId, phone, name, callId, onClose }) {
  const st = useCallState();
  const depth = useOverlayDepth();
  const [leaving, setLeaving] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [briefOpen, setBriefOpen] = useState(true);
  const started = useRef(false);
  const [attached, setAttached] = useState(false);
  const txRef = useRef(null);

  const call = attached ? st.call : null;
  const live = callStore.isLive(call);
  const ended = attached && !!call && !live && !st.dialing;
  const answered = !!(call && call.answeredAt);
  const held = !!(call && call.held);
  const elapsed = useElapsed(call && call.answeredAt, live && answered);

  // Chrome: hide the tab bar, tell the bubble/pill we're full-screen.
  useEffect(() => {
    document.body.classList.add('km-tabbar-hidden');
    callStore.setScreenOpen(true);
    return () => { document.body.classList.remove('km-tabbar-hidden'); callStore.setScreenOpen(false); };
  }, []);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onClose?.(), 280);
  }, [onClose]);

  // Start a new call, or attach to the one in progress.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const cur = callStore.getState().call;
    if (cur && (callStore.isLive(cur) || (callId && cur.id === callId))) {
      if (callStore.isLive(cur) && (clientId || phone) && cur.clientId !== clientId && !callId) toast('Finish your current call first');
      setAttached(true);
      return;
    }
    if (callId) {
      callStore.restore().then((c) => { if (!c) close(); else setAttached(true); });
      return;
    }
    if (!clientId && !phone) { close(); return; }
    haptic('medium');
    callStore.start({ clientId, phone, name }).catch((err) => { toast.error(err.message || 'Couldn’t place the call'); close(); });
    setAttached(true);
  }, [callId, clientId, phone, name, close]);

  // Collapse the briefing once the conversation is flowing.
  useEffect(() => { if (st.lines.length >= 3) setBriefOpen(false); }, [st.lines.length]);
  useEffect(() => {
    const el = txRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.lines]);

  const done = () => { callStore.dismiss(); close(); };
  const handoff = (fn) => { callStore.dismiss(); setLeaving(true); setTimeout(() => { onClose?.(); setTimeout(fn, 60); }, 280); };
  const end = () => { haptic('heavy'); callStore.hangup(); };

  const displayName = (call && call.client && call.client.name) || name || (call && call.otherNumber ? formatPhone(call.otherNumber) : null) || (phone ? formatPhone(phone) : 'Calling…');
  const seed = (call && (call.clientId || call.otherNumber)) || clientId || phone;
  const brief = call && call.briefing;
  const meta = brief && brief.statusLine ? brief.statusLine : (call && call.client ? '' : formatPhone((call && call.otherNumber) || phone || ''));
  const status = st.dialing ? 'Calling…' : !call ? 'Connecting…' : call.status === 'ringing' ? 'Calling…' : held ? 'On hold' : live ? null : 'Call ended';
  const cue = [...st.cues].reverse().find((c) => !c.dismissed);
  const moreCues = st.cues.filter((c) => !c.dismissed).length - 1;
  const firstName = (call && call.client && call.client.firstName) || (displayName || '').split(' ')[0];

  const body = ended && call ? (
    <CallRecap call={call} lines={st.lines.filter((l) => l.final !== false)} onDone={done} onHandoff={handoff} />
  ) : (
    <>
      <div className="km-call-top">
        <button type="button" className="km-call-round km-lg km-lg--light" onClick={close} aria-label="Minimize call"><Icon name="chevronDown" size={19} stroke={2.2} /></button>
        <div className="km-call-timer km-lg km-lg--light" aria-live="polite">
          <span className={`km-call-live ${!answered ? 'is-ringing' : ''} ${held ? 'is-held' : ''}`} />
          {status || fmtClock(elapsed)}
        </div>
        <button type="button" className="km-call-round km-lg km-lg--light" onClick={() => setNoteOpen(true)} aria-label="Add a note" disabled={!call}><Icon name="edit" size={17} stroke={2} /></button>
      </div>

      <div className="km-call-inner" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className={`km-call-hero ${!answered ? 'km-call-ringing' : 'is-compact'}`}>
          <Avatar name={call && !call.client && !name ? null : displayName} seed={seed} src={call && call.client ? call.client.avatarUrl : null} size={answered ? 52 : 72}
            style={{ boxShadow: '0 0 0 4px rgba(46,139,255,0.14), 0 10px 30px -10px rgba(46,139,255,0.55)', fontSize: answered ? 19 : 26, transition: 'width 0.3s var(--km-ease), height 0.3s var(--km-ease)' }} />
          <div className="km-call-name km-truncate">{displayName}</div>
          {meta ? <div className="km-call-meta km-truncate">{meta}</div> : null}
          {call && call.mode === 'simulated' && !answered ? <div className="km-call-status">Demo line · simulated conversation</div> : null}
        </div>

        <div className="km-call-mid">
          {brief && (brief.recommendedMove || (brief.touchPoints && brief.touchPoints.length) || (brief.iceBreakers && brief.iceBreakers.length)) ? (
            <div className="km-call-brief">
              <button type="button" className="km-call-brief-head" onClick={() => setBriefOpen((v) => !v)}>
                <Icon name="sparkle" size={12} stroke={2.2} />Briefing
                <Icon name={briefOpen ? 'chevronUp' : 'chevronDown'} size={13} stroke={2.2} style={{ marginLeft: 'auto' }} />
              </button>
              {briefOpen ? (
                <>
                  {brief.recommendedMove ? <div className="km-call-brief-move">{brief.recommendedMove}</div> : null}
                  {brief.lastContact ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 5 }} className="km-clamp-2">{brief.lastContact}</div> : null}
                  {[...(brief.touchPoints || []), ...(brief.iceBreakers || [])].length ? (
                    <div className="km-call-brief-points">
                      {[...(brief.touchPoints || []).slice(0, 3), ...(brief.iceBreakers || []).slice(0, 1)].map((t) => <span key={t}>{t}</span>)}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="km-call-tx">
            <div className="km-call-tx-head">
              <span className="km-call-live" style={answered && !held ? null : { background: 'rgba(255,255,255,0.3)', boxShadow: 'none', animation: 'none' }} />
              Live transcript{call && call.mode === 'twilio' ? ' · needs a transcription provider' : ''}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="sparkle" size={11} stroke={2} color="#C29BFF" />Co-pilot on</span>
            </div>
            <div className="km-call-tx-body" ref={txRef}>
              {!st.lines.length ? (
                <div className="km-call-empty">{answered ? 'Listening…' : 'The transcript appears as the call connects.'}</div>
              ) : st.lines.map((l) => {
                const me = l.speaker === 'agent';
                const note = l.speaker === 'note';
                return (
                  <div key={l.id} className="km-call-line" style={{ opacity: l.final === false ? 0.55 : 1 }}>
                    <div className={`km-call-tick ${l.signal || note ? 'is-on' : ''}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="km-call-who" style={{ color: note ? 'var(--bright)' : me ? 'rgba(255,255,255,0.34)' : 'var(--bright)' }}>
                        {note ? 'NOTE' : me ? 'YOU' : (firstName || 'THEM').toUpperCase()}
                        <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: 0 }}>{fmtClock(l.t)}</span>
                      </div>
                      <div className="km-call-text km-selectable" style={{ color: note ? 'var(--bright)' : me ? 'rgba(255,255,255,0.62)' : '#fff' }}>{l.text}</div>
                    </div>
                  </div>
                );
              })}
              {live && answered && !held && st.lines.length ? <div className="km-call-typing" aria-hidden="true"><span /><span /><span /></div> : null}
            </div>
          </div>

          {cue ? (
            <div className="km-cue" key={cue.id} role="status">
              <div className="km-cue-head">
                <Icon name="sparkle" size={12} stroke={2.2} color="#D3B5FF" />
                <span className="km-cue-eyebrow">Co-pilot · {cue.title}</span>
                <button type="button" aria-label="Dismiss" onClick={() => callStore.dismissCue(cue.id)} style={{ color: 'rgba(255,255,255,0.55)' }}><Icon name="x" size={14} stroke={2.2} /></button>
              </div>
              <div className="km-cue-title">{cue.reframe}</div>
              <div className="km-cue-points">{(cue.points || []).slice(0, 2).map((p) => <div key={p}>{p}</div>)}</div>
              {moreCues > 0 ? <div className="km-cue-more">+{moreCues} earlier cue{moreCues === 1 ? '' : 's'}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="km-call-dock">
          <div className="km-call-grid">
            <Ctl icon={st.muted ? 'micOff' : 'mic'} label={st.muted ? 'Unmute' : 'Mute'} on={st.muted} onClick={() => { haptic('light'); callStore.toggleMute(); }} disabled={!call} />
            <Ctl icon="keypad" label="Keypad" onClick={() => setKeypad(true)} disabled={!call} />
            <Ctl icon="volume" label="Speaker" on={st.speaker} onClick={() => { haptic('light'); callStore.toggleSpeaker(); }} disabled={!call} />
            <Ctl icon="userPlus" label="Add" onClick={() => toast(call && call.mode === 'twilio' ? 'Conference calling is coming soon' : 'Adding a caller needs a connected phone line')} disabled={!call} />
            <Ctl icon="pause" label={held ? 'Resume' : 'Hold'} on={held} onClick={() => { haptic('light'); callStore.toggleHold(); }} disabled={!call || !answered} />
          </div>
          <div className="km-call-end-row">
            <button type="button" className="km-call-end" onClick={end} aria-label="End call" disabled={!call && !st.dialing}>
              <Icon name="phone" size={30} stroke={1.8} />
            </button>
          </div>
        </div>
      </div>

      <KeypadSheet open={keypad} onClose={() => setKeypad(false)} mode="dtmf" title="Keypad" />
      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} title={`Note · ${fmtClock(elapsed)}`}
        right={{ label: 'Save', disabled: !noteText.trim(), onClick: () => { callStore.note(noteText.trim()); setNoteText(''); setNoteOpen(false); toast.success('Note added to the call'); } }}>
        <textarea className="km-input" rows={4} autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Type a note — it lands on the call and the recap…" style={{ marginTop: 6 }} />
      </Sheet>
    </>
  );

  return createPortal(
    <div className={`km-call ${leaving ? 'is-leaving' : ''}`} style={{ zIndex: panelZ(depth) }} role="dialog" aria-label={`Call with ${displayName}`}>
      <div className="km-call-ambient" aria-hidden="true" />
      <div className="km-call-floor" aria-hidden="true" />
      {body}
    </div>,
    document.body,
  );
}
