// VoicemailCard (RevMatch VoicemailCard): caller, transcript, seeded waveform
// player (HTMLAudio when there's a recording; a still waveform placeholder
// when there isn't), mark heard, call back, text back. Playback is blocked
// while a call is live.
import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { toast } from '../ui/toast';
import { mediaUrl } from '../../api/client';
import { callStore } from './callStore';
import { callName, fmtShort, shortTime } from './callUtil';

const BARS = 30;
function seededBars(id) {
  let h = 2166136261;
  for (const ch of String(id || 'x')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [];
  for (let i = 0; i < BARS; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const r = ((h ^= h >>> 16) >>> 0) / 4294967295;
    const env = Math.sin((i / (BARS - 1)) * Math.PI) * 0.55 + 0.45; // speech-like swell
    out.push(Math.round(5 + r * 19 * env));
  }
  return out;
}

export default function VoicemailCard({ call, onCall, onText, onHeard, onInfo, index = 0 }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const bars = useMemo(() => seededBars(call.id), [call.id]);
  const url = call.voicemailUrl || call.recordingUrl || null;
  const name = callName(call);
  const heard = !!call.voicemailHeard;

  useEffect(() => () => { try { audio.current?.pause(); } catch { /* ignore */ } }, []);

  const toggle = () => {
    if (!url) return;
    if (callStore.isLive()) { toast('You’re on a call — voicemail will play after.'); return; }
    if (!audio.current) {
      const a = new Audio(mediaUrl(url));
      a.preload = 'none';
      a.addEventListener('timeupdate', () => setProgress(a.duration ? a.currentTime / a.duration : 0));
      a.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
      a.addEventListener('pause', () => setPlaying(false));
      a.addEventListener('play', () => setPlaying(true));
      a.addEventListener('error', () => { setPlaying(false); toast.error('Couldn’t play that voicemail'); });
      audio.current = a;
    }
    if (audio.current.paused) {
      audio.current.play().catch(() => setPlaying(false));
      if (!heard) onHeard(call);
    } else audio.current.pause();
  };

  const lit = Math.round(progress * BARS);
  return (
    <div className={`km-vm-card ${heard ? 'is-heard' : ''}`} data-row-id={call.id} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <div className="km-vm-head">
        <button type="button" className="km-press" onClick={() => (call.clientId ? onInfo(call) : null)} aria-label={name}>
          <Avatar name={call.client ? name : null} seed={call.clientId || call.otherNumber} src={call.client?.avatarUrl} size={42} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="km-truncate" style={{ fontSize: 15.5, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 6 }}>
            {!heard ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--hl)', flexShrink: 0 }} /> : null}
            <span className="km-truncate">{name}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="voicemail" size={12} color="var(--violet)" stroke={2.2} />
            Voicemail{call.durationSec ? ` · ${fmtShort(call.durationSec)}` : ''}
          </div>
        </div>
        <span className="km-ph-time">{shortTime(call.startedAt)}</span>
      </div>

      {call.voicemailTranscript ? (
        <button type="button" className={`km-vm-transcript ${expanded ? '' : 'is-clamped'}`} onClick={() => setExpanded((v) => !v)} style={{ textAlign: 'left' }}>
          <span className="km-vm-ai"><Icon name="sparkle" size={10} stroke={2.4} /></span>
          <span className="km-vm-text km-selectable">{call.voicemailTranscript}</span>
        </button>
      ) : null}

      <div className="km-vm-player">
        <button type="button" className="km-vm-play" onClick={toggle} disabled={!url} aria-label={url ? (playing ? 'Pause voicemail' : 'Play voicemail') : 'Recording unavailable'} title={url ? undefined : 'No recording on file — read the transcript'}>
          <Icon name={playing ? 'pause' : 'play'} size={14} stroke={2.4} />
        </button>
        <div className="km-vm-wave" aria-hidden="true">
          {bars.map((h, i) => <span key={i} className={i < lit ? 'is-on' : ''} style={{ height: h }} />)}
        </div>
        <span className="km-vm-dur">{url ? fmtShort(progress ? progress * (call.durationSec || 0) : call.durationSec) : 'no audio'}</span>
      </div>

      <div className="km-vm-actions">
        <button type="button" className="km-vm-btn km-vm-btn--call" onClick={() => onCall(call)}><Icon name="phone" size={15} stroke={2} />Call back</button>
        <button type="button" className="km-vm-btn km-vm-btn--text" onClick={() => onText(call)}><Icon name="message" size={15} stroke={2} />Text</button>
        {!heard ? <button type="button" className="km-vm-btn" onClick={() => onHeard(call)} style={{ flex: 0.8 }}><Icon name="check" size={15} stroke={2.2} />Heard</button> : null}
      </div>
    </div>
  );
}
