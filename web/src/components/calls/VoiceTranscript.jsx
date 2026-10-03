// VoiceTranscript — Soul's "Affirmation Voice Notes" screen as KeyMatch's call
// transcript. The line being spoken sits in focus (large, white); the lines
// around it recede (dim + blurred); a waveform runs underneath with the
// highlight as its playhead; a round glass control with a progress ring
// starts / stops it ("TAP TO …").
//   Parts (the live call screen composes these):
//     <KaraokeLines lines focus themName onPick align />
//     <VoiceWave levels head onSeek />      useLiveLevels(active, getEnergy)
//     <VoiceButton icon label progress on onClick size />
//   Replay widget (call recap, client timeline):
//     <TranscriptPlayer lines recordingUrl durationSec seed themName dark compact />
//   With a recording it plays the audio and the focus follows it; without
//   one it replays the transcript at the pace it was spoken. Tap a line or
//   the waveform to jump.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { toast } from '../ui/toast';
import { mediaUrl } from '../../api/client';
import { callStore } from './callStore';
import { fmtClock } from './callUtil';
import '../../styles/voice.css';

export const WAVE_BARS = 27;
export const LIVE_HEAD = 19; // the live playhead sits ~70% across, as in Soul

const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Speech-like bar heights (0..1), stable per seed.
export function seededLevels(seed, n = WAVE_BARS) {
  let h = 2166136261;
  for (const ch of String(seed || 'x')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const r = ((h ^= h >>> 16) >>> 0) / 4294967295;
    const env = Math.sin(((i + 0.5) / n) * Math.PI) * 0.45 + 0.55;
    out.push(Math.min(1, 0.08 + r * env));
  }
  return out;
}

// Seconds a line takes to say (~2.6 words a second).
const sayTime = (text) => Math.max(1.6, String(text || '').trim().split(/\s+/).length / 2.6);

const whoOf = (l, themName) => (l.speaker === 'agent' ? 'You' : l.speaker === 'note' ? 'Note' : (themName || 'Them'));

// ── the focus list ─────────────────────────────────────────────────────
export function KaraokeLines({ lines, focus, themName, onPick, align = 0.4, empty, className = '' }) {
  const box = useRef(null);
  const refs = useRef([]);
  const touched = useRef(0);
  const [pad, setPad] = useState(0);

  // Spacers so the first and last lines can still reach the focus point.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setPad(Math.round(el.clientHeight * 0.5)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const b = box.current;
    const el = refs.current[focus];
    if (!b || !el) return;
    if (Date.now() - touched.current < 3000) return; // the agent is reading back — don't yank the list
    // Center the focus line at `align`, but keep all of it inside the clear
    // band between the top and bottom fades (a long line shows from its start).
    const h = b.clientHeight;
    const want = el.offsetTop - h * align + el.offsetHeight / 2;
    const lo = el.offsetTop + el.offsetHeight - h * 0.84;
    const hi = el.offsetTop - h * 0.16;
    const top = lo > hi ? hi : Math.max(lo, Math.min(hi, want));
    b.scrollTo({ top: Math.max(0, top), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [focus, lines.length, align, pad]);

  const touch = () => { touched.current = Date.now(); };
  if (!lines.length) {
    return <div className={`km-vt-lines km-vt-lines--empty ${className}`} ref={box}><div className="km-vt-empty">{empty}</div></div>;
  }
  return (
    <div className={`km-vt-lines ${className}`} ref={box} onTouchStart={touch} onWheel={touch} onPointerDown={touch}>
      <div style={{ height: pad }} aria-hidden="true" />
      {lines.map((l, i) => {
        const d = Math.abs(i - focus);
        const cls = d === 0 ? 'is-focus' : d === 1 ? 'is-near' : 'is-far';
        return (
          <div
            key={l.id || i}
            ref={(el) => { refs.current[i] = el; }}
            className={`km-vt-line ${cls}${l.speaker === 'note' ? ' is-note' : ''}${l.speaker === 'agent' ? ' is-me' : ''}${l.signal ? ' is-signal' : ''}${l.final === false ? ' is-interim' : ''}`}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            aria-current={d === 0 ? 'true' : undefined}
            onClick={onPick ? () => { touched.current = 0; onPick(i); } : undefined}
            onKeyDown={onPick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); touched.current = 0; onPick(i); } } : undefined}
          >
            <span className="km-vt-who">{whoOf(l, themName)}{Number.isFinite(l.t) ? <em>{fmtClock(l.t)}</em> : null}</span>
            <span className="km-vt-text km-selectable">
              {l.text}
              {l.final === false ? <span className="km-vt-dots" aria-hidden="true"><i /><i /><i /></span> : null}
            </span>
          </div>
        );
      })}
      <div style={{ height: pad }} aria-hidden="true" />
    </div>
  );
}

// ── the waveform ───────────────────────────────────────────────────────
export function VoiceWave({ levels, head = 0, onSeek, label = 'Position', className = '' }) {
  const n = levels.length;
  const hi = Math.max(0, Math.min(n - 1, Math.round(head * (n - 1))));
  const seekAt = (e) => {
    if (!onSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  const onKey = (e) => {
    if (!onSeek) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(1, head + 0.05)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, head - 0.05)); }
  };
  return (
    <div
      className={`km-vt-wave ${onSeek ? 'is-seekable' : ''} ${className}`}
      onClick={seekAt}
      onKeyDown={onKey}
      role={onSeek ? 'slider' : 'img'}
      tabIndex={onSeek ? 0 : undefined}
      aria-label={label}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(head * 100) : undefined}
    >
      {levels.map((v, i) => (i === hi
        ? <b key={i} className="km-vt-head" />
        : <i key={i} style={{ '--h': v.toFixed(3), opacity: (i < hi ? 0.36 + v * 0.64 : 0.1 + v * 0.3).toFixed(2) }} />))}
    </div>
  );
}

// Live levels: the history scrolls left into the playhead while someone is
// talking; the bars after it idle. getEnergy() → 0..1 (how much speech now).
export function useLiveLevels(active, getEnergy) {
  const [levels, setLevels] = useState(() => {
    const idle = seededLevels('km-live');
    return idle.map((v, i) => (i < LIVE_HEAD ? 0.06 : v * 0.7));
  });
  const energy = useRef(getEnergy);
  energy.current = getEnergy;
  useEffect(() => {
    if (!active || reduceMotion()) return undefined;
    const id = setInterval(() => {
      const e = Math.max(0, Math.min(1, energy.current ? energy.current() : 0));
      const next = e > 0.05 ? Math.min(1, 0.18 + Math.random() * 0.82 * e) : 0.04 + Math.random() * 0.08;
      setLevels((prev) => [...prev.slice(1, LIVE_HEAD), next, prev[LIVE_HEAD], ...prev.slice(LIVE_HEAD + 1)]);
    }, 120);
    return () => clearInterval(id);
  }, [active]);
  return levels;
}

// ── the round control ─────────────────────────────────────────────────
export function VoiceButton({ icon, label, progress = 0, on = false, onClick, disabled, size = 80, ariaLabel }) {
  const box = size + 13;
  const r = box / 2 - 1;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress || 0));
  return (
    <div className="km-vt-ctl">
      <div className="km-vt-btnwrap" style={{ width: box, height: box }}>
        <span className="km-vt-bloom" aria-hidden="true" style={{ width: Math.round(size * 2.08), height: Math.round(size * 2.08) }} />
        <svg className="km-vt-ring" width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
          <circle cx={box / 2} cy={box / 2} r={r} className="km-vt-ring-track" />
          <circle cx={box / 2} cy={box / 2} r={r} className="km-vt-ring-arc" strokeDasharray={c.toFixed(2)} strokeDashoffset={(c * (1 - p)).toFixed(2)} transform={`rotate(-90 ${box / 2} ${box / 2})`} style={{ opacity: p > 0.002 ? 1 : 0 }} />
        </svg>
        <button type="button" className={`km-vt-btn km-lg ${on ? 'is-on' : ''}`} style={{ width: size, height: size }} onClick={onClick} disabled={disabled} aria-pressed={on || undefined} aria-label={ariaLabel || label}>
          <Icon name={icon} size={Math.round(size * 0.3)} stroke={1.8} />
        </button>
      </div>
      {label ? <span className="km-vt-label" aria-hidden="true">{label}</span> : null}
    </div>
  );
}

// ── replay widget ──────────────────────────────────────────────────────
export default function TranscriptPlayer({ lines, recordingUrl, durationSec, seed, themName, title = 'Call transcript', dark = false, compact = false, className = '' }) {
  const spoken = useMemo(() => (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.text || '').trim()), [lines]);
  const [failed, setFailed] = useState(false);
  const url = recordingUrl && !failed ? mediaUrl(recordingUrl) : null;
  const [audioDur, setAudioDur] = useState(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null);
  const levels = useMemo(() => seededLevels(seed || title), [seed, title]);

  const timed = spoken.length > 0 && spoken.every((l) => Number.isFinite(l.t));
  const natural = timed
    ? spoken[spoken.length - 1].t + sayTime(spoken[spoken.length - 1].text)
    : spoken.reduce((s, l) => s + sayTime(l.text), 0);
  const total = Math.max(1, (url && (audioDur || durationSec)) || natural || durationSec || 1);
  const starts = useMemo(() => {
    if (timed) return spoken.map((l) => l.t);
    const w = spoken.map((l) => sayTime(l.text));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    return w.map((x) => { const s = acc; acc += x; return (s / sum) * total; });
  }, [spoken, timed, total]);
  let focus = 0;
  for (let i = 0; i < starts.length; i += 1) if (starts[i] <= time + 0.05) focus = i;

  useEffect(() => () => { try { audio.current?.pause(); } catch { /* ignore */ } }, []);

  // Transcript-only replay: a clock at speaking pace.
  useEffect(() => {
    if (!playing || url) return undefined;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => Math.min(total, t + dt));
    }, 100);
    return () => clearInterval(id);
  }, [playing, url, total]);
  useEffect(() => { if (playing && !url && time >= total) setPlaying(false); }, [playing, url, time, total]);

  const ensureAudio = useCallback(() => {
    if (audio.current) return audio.current;
    const a = new Audio(url);
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration) && a.duration > 0) setAudioDur(a.duration); });
    a.addEventListener('timeupdate', () => setTime(a.currentTime));
    a.addEventListener('play', () => setPlaying(true));
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('ended', () => setPlaying(false));
    a.addEventListener('error', () => {
      setPlaying(false);
      setFailed(true);
      audio.current = null;
      if (spoken.length) toast('Couldn’t load the recording — replaying the transcript instead');
      else toast.error('Couldn’t play the recording');
    });
    audio.current = a;
    return a;
  }, [url, spoken.length]);

  const seekTo = (sec) => {
    const s = Math.max(0, Math.min(total, sec));
    setTime(s);
    if (url) { try { ensureAudio().currentTime = s; } catch { /* metadata not loaded yet */ } }
  };

  const toggle = () => {
    if (!spoken.length && !url) return;
    if (playing) {
      if (url) audio.current?.pause();
      setPlaying(false);
      return;
    }
    if (url) {
      if (callStore.isLive()) { toast('You’re on a call — the recording will play after.'); return; }
      const a = ensureAudio();
      if (a.ended || time >= total - 0.05) a.currentTime = 0;
      a.play().catch(() => setPlaying(false));
    } else {
      if (time >= total - 0.05) setTime(0);
      setPlaying(true);
    }
  };

  const atEnd = time >= total - 0.05;
  const label = playing ? 'Tap to pause' : time > 0.05 && !atEnd ? 'Tap to resume' : url ? 'Tap to play' : 'Tap to replay';
  return (
    <div className={`km-vt km-vt--card${compact ? ' km-vt--compact' : ''}${dark ? ' km-vt--dark' : ''} ${className}`}>
      <div className="km-vt-top">
        <span className="km-vt-pill">{title}</span>
        <span className="km-vt-clock">{fmtClock(time)}<em> / {fmtClock(total)}</em></span>
      </div>
      <KaraokeLines
        lines={spoken}
        focus={focus}
        themName={themName}
        onPick={(i) => seekTo(starts[i] || 0)}
        align={0.42}
        empty={url ? 'Recording only — no transcript on this call.' : 'No transcript on this call.'}
        className="km-vt-lines--card"
      />
      <VoiceWave levels={levels} head={time / total} onSeek={(f) => seekTo(f * total)} label="Playback position" />
      <VoiceButton
        icon={playing ? 'pause' : 'play'}
        label={label}
        ariaLabel={playing ? 'Pause' : url ? 'Play the recording' : 'Replay the transcript'}
        progress={time / total}
        onClick={toggle}
        disabled={!spoken.length && !url}
        size={compact ? 60 : 72}
      />
    </div>
  );
}
