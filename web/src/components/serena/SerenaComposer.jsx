// Serena's composer: glass pill that auto-grows to ~5 lines, embedded send,
// draft kept across closes, and optional voice input (Web Speech API —
// feature-detected; hidden where unavailable, e.g. inside the iOS app's
// WKWebView, where the keyboard's own dictation works instead).
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { haptic } from '../../lib/native';

const DRAFT_KEY = 'km_serena_draft';
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };

function grow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(120, el.scrollHeight)}px`;
}

export default function SerenaComposer({ busy, onSend, focusKey }) {
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; } });
  const [listening, setListening] = useState(false);
  const ref = useRef(null);
  const rec = useRef(null);
  const base = useRef('');

  useEffect(() => { grow(ref.current); }, [text]);
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, text); } catch { /* ignore */ } }, 250);
    return () => clearTimeout(t);
  }, [text]);
  // Desktop: focus on open. Phones: don't pop the keyboard uninvited.
  useEffect(() => { if (focusKey && !coarse()) setTimeout(() => ref.current?.focus(), 280); }, [focusKey]);
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* ignore */ } }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    if (listening) { try { rec.current?.stop(); } catch { /* ignore */ } }
    onSend(t);
    setText('');
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    haptic('light');
  };

  const toggleVoice = () => {
    if (!SR) return;
    if (listening) { try { rec.current?.stop(); } catch { /* ignore */ } return; }
    try {
      const r = new SR();
      r.lang = navigator.language || 'en-US';
      r.interimResults = true;
      r.continuous = false;
      base.current = text ? `${text.trim()} ` : '';
      r.onresult = (e) => {
        let s = '';
        for (let i = 0; i < e.results.length; i += 1) s += e.results[i][0].transcript;
        setText(base.current + s);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      rec.current = r;
      r.start();
      setListening(true);
      haptic('light');
    } catch {
      setListening(false);
    }
  };

  const ready = !!text.trim() && !busy;
  return (
    <div className="km-srn-composer">
      {SR ? (
        <button type="button" className={`km-srn-mic ${listening ? 'is-on' : ''}`} onClick={toggleVoice} aria-label={listening ? 'Stop dictation' : 'Dictate'}>
          <Icon name={listening ? 'micOff' : 'mic'} size={19} stroke={1.9} />
        </button>
      ) : null}
      <div className="km-srn-input-wrap">
        <textarea
          ref={ref}
          className="km-srn-input"
          rows={1}
          value={text}
          placeholder={listening ? 'Listening…' : 'Message Serena'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !coarse() && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          aria-label="Message Serena"
          enterKeyHint="send"
        />
        <button type="button" className={`km-srn-sendbtn ${ready ? 'is-ready' : ''}`} onClick={submit} disabled={!ready} aria-label="Send">
          <Icon name="arrowUp" size={15} stroke={2.6} />
        </button>
      </div>
    </div>
  );
}
