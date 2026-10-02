// iMessage-style voice note: channel-colored bubble, play/pause, seekable
// waveform (seeded per file so it never jumps), remaining-time readout.
// Never autoplays (a playing bubble would grab the iOS audio session).
import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../../api/client';
import Icon from '../ui/Icon';
import { fmtDuration } from './threadUtils';

const BARS = 30;

function seededBars(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = [];
  for (let i = 0; i < BARS; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const r = ((h >>> 0) % 1000) / 1000;
    const env = Math.sin((i / (BARS - 1)) * Math.PI) * 0.55 + 0.45;
    out.push(Math.max(0.18, Math.min(1, r * env * 1.25)));
  }
  return out;
}

let current = null; // only one voice note plays at a time

export default function VoiceNote({ att, side = 'recv', channel = 'imsg' }) {
  const src = mediaUrl(att.url);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(att.durationMs ? att.durationMs / 1000 : 0);
  const bars = useMemo(() => seededBars(String(att.url || att.id || 'x')), [att.url, att.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    const onMeta = () => { if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
    const onTime = () => { if (a.duration) setProgress(a.currentTime / a.duration); };
    const onEnd = () => { setPlaying(false); setProgress(0); };
    const onPause = () => setPlaying(false);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', onPause);
    return () => {
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('pause', onPause);
      if (current === a) { a.pause(); current = null; }
    };
  }, []);

  const toggle = (e) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); return; }
    if (current && current !== a) current.pause();
    current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const seek = (e) => {
    e.stopPropagation();
    const a = audioRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX ?? (e.touches && e.touches[0].clientX)) - rect.left;
    const p = Math.max(0, Math.min(1, x / rect.width));
    setProgress(p);
    if (a && a.duration) a.currentTime = p * a.duration;
  };

  const shown = playing || progress > 0 ? duration * (1 - progress) : duration;
  return (
    <div className={`km-voice km-voice--${side} km-voice--${channel}`} onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="km-voice-btn km-press" onClick={toggle} aria-label={playing ? 'Pause' : 'Play voice note'}>
        <Icon name={playing ? 'pause' : 'play'} size={15} stroke={0} color="currentColor" style={{ fill: 'currentColor', marginLeft: playing ? 0 : 2 }} />
      </button>
      <div className="km-voice-wave" onPointerDown={seek} role="slider" aria-label="Seek" aria-valuenow={Math.round(progress * 100)}>
        {bars.map((h, i) => (
          <i key={i} className={i / BARS < progress ? 'on' : ''} style={{ height: `${Math.round(h * 26)}px` }} />
        ))}
      </div>
      <span className="km-voice-time">{fmtDuration(shown)}</span>
    </div>
  );
}
