// First-run gate: name your assistant → personality → meet. (RevMatch AssistantBuilder, re-tokened.)
import { useState } from 'react';
import { api } from '../../api/client';
import Icon from '../ui/Icon';
import { Button, TextArea } from '../ui/kit';
import { BRAND } from '../../brand';
import { useAuth } from '../../hooks/useAuth';

const NAMES = ['Serena', 'Ava', 'Nova', 'Iris', 'Remy', 'Leo'];
const PRESETS = [
  { id: 'straight', label: 'Straight shooter', sub: 'Short, direct, no fluff', text: 'Talk to me like a sharp colleague, not an assistant. Short sentences. No preamble. If I ask something, answer it in the first line. If you think I’m about to make a mistake, say so plainly.' },
  { id: 'warm', label: 'Warm and personal', sub: 'Remembers the human details', text: 'Be warm and personable — with me and about my clients. Remember the human details: kids’ names, the view they’ve always wanted, the school their kids are starting. When you draft a text, make it sound like someone who actually knows them wrote it.' },
  { id: 'closer', label: 'High energy', sub: 'Keeps the pressure on follow-ups', text: 'Keep me moving. Tell me when a hot buyer has gone three days without a touch. Be direct about what needs doing now versus what can wait. Celebrate the wins with me.' },
  { id: 'polished', label: 'Calm professional', sub: 'Polished — fits luxury clients', text: 'Be calm, polished and precise. My clients are high-net-worth; never breathless, never salesy, never over-familiar. Drafts to clients should be understated. With me, give the full picture, then your recommendation.' },
];

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
  const [name, setName] = useState('Serena');
  const [preset, setPreset] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? text.trim().length >= 20 : true;

  const finish = async () => {
    setBusy(true);
    try {
      const aiPreferences = { aiName: name.trim(), aiPersonalityId: preset, aiPersonality: text.trim() };
      await api.patch('/me/ai-preferences', aiPreferences);
      updateUser({ aiPreferences });
      onDone?.();
    } catch { setBusy(false); }
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
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>Let’s build your assistant</div>
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
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>How should {name} talk to you?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="km-press" onClick={() => { const on = preset === p.id; setPreset(on ? null : p.id); setText(on ? '' : p.text); }}
                    style={{ textAlign: 'left', minHeight: 56, padding: '12px 14px', borderRadius: 12, border: `1px solid ${preset === p.id ? 'rgba(46,139,255,0.45)' : 'var(--line)'}`, background: preset === p.id ? 'var(--tint)' : 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{p.label}</span>
                      <span style={{ display: 'block', fontSize: 14, color: 'var(--dim)', marginTop: 2 }}>{p.sub}</span>
                    </span>
                    {preset === p.id ? <Icon name="checkCircle" size={20} color="var(--bright)" /> : null}
                  </button>
                ))}
              </div>
              <TextArea label="IN YOUR WORDS" rows={6} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); setPreset(null); }}
                hint={text.trim().length >= 20 ? 'Looks good' : 'A sentence or two is plenty'} />
            </>
          ) : (
            <>
              <Orb size={88} />
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>Meet {name}</div>
              <div style={{ fontSize: 15, color: 'var(--dim)', lineHeight: 1.5 }}>Tap the bubble any time to talk to {name} — from any screen.</div>
              <div className="km-ai-card">
                <div className="km-eyebrow" style={{ color: 'var(--bright)' }}>{name.toUpperCase()} CAN</div>
                {['Draft texts to clients in your voice', 'Tell you who has gone quiet — and who to call first', 'Pull up a deal, a listing, a client’s portfolio', 'Book showings and closings on your calendar'].map((t) => (
                  <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, fontSize: 14.5 }}>
                    <Icon name="check" size={15} color="var(--bright)" stroke={2.4} /> {t}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--faint)' }}>{name} never texts a client without your approval.</div>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--line)', paddingBottom: 'max(calc(20px + var(--safe-bottom)), var(--keyboard-height))', transition: 'padding-bottom 0.25s var(--km-kb-ease)' }}>
        {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)} style={{ minWidth: 88 }}>Back</Button> : null}
        <Button block disabled={!canNext || busy} loading={busy} onClick={() => (step < 2 ? setStep(step + 1) : finish())}>
          {step < 2 ? 'Continue' : `Start using ${BRAND.name}`}
        </Button>
      </div>
    </div>
  );
}
