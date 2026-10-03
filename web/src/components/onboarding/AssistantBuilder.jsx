// First-run gate: name your assistant → personality → meet. (RevMatch AssistantBuilder, re-tokened.)
// Every agent builds their own assistant — the name starts blank; suggestions are ideas only.
import { useState } from 'react';
import { api } from '../../api/client';
import Icon from '../ui/Icon';
import { Button, TextArea } from '../ui/kit';
import { BRAND } from '../../brand';
import { useAuth } from '../../hooks/useAuth';

import { PERSONALITY_PRESETS as PRESETS, NAME_SUGGESTIONS as NAMES } from './personalityPresets';

function Orb({ size = 72 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="km-lg">
      <div style={{ width: size * 0.22, height: size * 0.22, borderRadius: '50%', background: 'var(--bright)', boxShadow: '0 0 24px 6px var(--glow)', animation: 'pulseDot 2.4s ease-in-out infinite' }} />
    </div>
  );
}

export default function AssistantBuilder({ onDone }) {
  const { user, updateUser } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const displayName = name.trim() || 'your assistant';
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? text.trim().length >= 20 : true;

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      const aiPreferences = { ...(user?.aiPreferences || {}), aiName: name.trim(), aiPersonalityId: preset, aiPersonality: text.trim() };
      await api.patch('/me/ai-preferences', aiPreferences);
      updateUser({ aiPreferences });
      onDone?.();
    } catch {
      setError('Couldn’t save that. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 'calc(var(--safe-top) + 18px)' }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ height: 4, width: i === step ? 24 : 8, borderRadius: 2, background: i <= step ? 'var(--blue)' : 'var(--surfaceTop)', transition: 'all 0.24s var(--km-ease)' }} />
        ))}
      </div>
      <div className="km-scroll" style={{ flex: 1 }}>
        <div style={{ maxWidth: 460, margin: '0 auto', padding: '40px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {step === 0 ? (
            <>
              <Orb />
              <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>Let’s build your assistant</div>
              <div style={{ fontSize: 15, color: 'var(--dim)', lineHeight: 1.5 }}>
                {user?.firstName}, this one is yours. It reads your book, drafts your texts and keeps your day straight. What do you want to call it?
              </div>
              <input className="km-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name your assistant" style={{ textAlign: 'center', fontSize: 18, height: 52 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {NAMES.map((n) => (
                  <button key={n} type="button" className={`km-pill ${name === n ? 'km-pill--on' : ''}`} onClick={() => setName(n)}>{n}</button>
                ))}
              </div>
            </>
          ) : step === 1 ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>How should {displayName} talk to you?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="km-press" onClick={() => { const on = preset === p.id; setPreset(on ? null : p.id); setText(on ? '' : p.text); }}
                    style={{ textAlign: 'left', minHeight: 56, padding: '12px 14px', borderRadius: 12, border: `1px solid ${preset === p.id ? 'rgba(var(--accent-rgb), 0.45)' : 'var(--line)'}`, background: preset === p.id ? 'var(--tint)' : 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 17, fontWeight: 500 }}>{p.label}</span>
                      <span style={{ display: 'block', fontSize: 14, color: 'var(--dim)', marginTop: 2 }}>{p.sub}</span>
                    </span>
                    {preset === p.id ? <Icon name="checkCircle" size={20} color="var(--bright)" /> : null}
                  </button>
                ))}
              </div>
              <TextArea label="IN YOUR WORDS" rows={6} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); setPreset(null); }}
                placeholder={`Tell ${displayName} how to be. "Keep it short. Don't sugarcoat. Remind me about follow-ups before I forget."`}
                hint={text.trim().length >= 20 ? 'Looks good' : 'A sentence or two is plenty'} />
            </>
          ) : (
            <>
              <Orb size={88} />
              <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>Meet {displayName}</div>
              <div style={{ fontSize: 15, color: 'var(--dim)', lineHeight: 1.5 }}>Tap the bubble any time to talk to {displayName} — from any screen. Your To-Do lives there too: swipe left in the chat.</div>
              <div className="km-ai-card">
                <div className="km-eyebrow" style={{ color: 'var(--bright)' }}>{displayName.toUpperCase()} CAN</div>
                {['Draft texts to clients in your voice', 'Tell you who has gone quiet — and who to call first', 'Pull up a deal, a listing, a client’s portfolio', 'Book showings and closings on your calendar', 'Keep your To-Do — including what it catches in your texts and calls'].map((t) => (
                  <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, fontSize: 14.5 }}>
                    <Icon name="check" size={15} color="var(--bright)" stroke={2.4} /> {t}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>{displayName} never texts a client without your approval.</div>
            </>
          )}
        </div>
      </div>
      {error ? <div role="alert" style={{ textAlign: 'center', color: 'var(--red)', fontSize: 13.5, padding: '0 20px 8px' }}>{error}</div> : null}
      <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--line)', paddingBottom: 'max(calc(20px + var(--safe-bottom)), var(--keyboard-height))', transition: 'padding-bottom 0.25s var(--km-kb-ease)' }}>
        {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)} style={{ minWidth: 88 }}>Back</Button> : null}
        <Button block disabled={!canNext || busy} loading={busy} onClick={() => (step < 2 ? setStep(step + 1) : finish())}>
          {step < 2 ? 'Continue' : `Start using ${BRAND.name}`}
        </Button>
      </div>
    </div>
  );
}
