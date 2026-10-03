// TrafficLanes — the reply lanes, ONE component for the builder, the campaign
// detail and the defaults. No preset timing buttons: the agent EXPLAINS each
// lane in plain language and the AI builds the timed steps (Build → steps).
//   green  = interested / wants to see it     yellow = maybe / questions
//   red    = not interested (one polite close) gray  = no reply (one nudge)
// Plus the agent's two standing instructions: "When they respond" (the reply
// agent DRAFTS answers for approval — never sends) and event Reminders.
import { useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { Switch } from '../ui/kit';
import { toast } from '../ui/toast';
import { parseLane } from '../../api/campaigns';
import { LANE_META, LaneDot, MonoLabel, SparkButton } from './kit';

const LANE_KEYS = ['green', 'yellow', 'red', 'gray'];
const DEFAULTS = {
  green: { enabled: true, text: '', steps: [] },
  yellow: { enabled: true, text: '', steps: [] },
  red: { enabled: true, text: '', steps: [] },
  gray: { enabled: true, timerText: '2 DAYS', timerHours: 48, text: '' },
};
const PLACEHOLDER = {
  green: 'Right away, offer two private showing times this week',
  yellow: 'Give them space, check back 2 days later with one standout detail',
  red: 'Right away, thank them and say I will keep an eye out for the right one',
};
const CAPTION = 'Written per person, in your voice';

export function normalizeLanes(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const k of LANE_KEYS) {
    const lane = v[k] && typeof v[k] === 'object' ? v[k] : {};
    out[k] = { ...DEFAULTS[k], ...lane };
    // Seeded / older lanes carry { label, action } instead of the agent's words.
    if (!String(out[k].text || '').trim() && typeof lane.action === 'string' && !/^no follow-?up$/i.test(lane.action.trim())) out[k].text = lane.action;
  }
  for (const k of Object.keys(v)) if (!LANE_KEYS.includes(k) && v[k] !== undefined) out[k] = v[k];
  return out;
}

export function timerTextToHours(text) {
  const t = String(text || '').trim().toLowerCase();
  let m = t.match(/(\d+)\s*hours?/); if (m) return parseInt(m[1], 10);
  m = t.match(/(\d+)\s*days?/); if (m) return parseInt(m[1], 10) * 24;
  if (/a\s+week|1\s*week/.test(t)) return 168;
  m = t.match(/(\d+)\s*weeks?/); if (m) return parseInt(m[1], 10) * 168;
  m = t.match(/^(\d+)$/); if (m) return parseInt(m[1], 10) * 24;
  return 48;
}

const focusSoon = (e) => { const t = e.target; setTimeout(() => { try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ } }, 300); };

function StepRow({ step, color, onLabel, onBrief, onRemove, index, locked }) {
  return (
    <div className="kp-step-in" style={{ display: 'flex', gap: 10, alignItems: 'stretch', animationDelay: `${index * 80}ms`, opacity: locked ? 0.35 : 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <span className="kp-dot" style={{ width: 8, height: 8, marginTop: 9, background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ width: 1.5, flex: 1, background: `color-mix(in srgb, ${color} 30%, transparent)`, marginTop: 4 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Auto-sizing pill: a hidden copy of the text sizes the grid cell. */}
          <span className="kp-steplabel" data-value={`${step.label || ''} `} style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 32%, transparent)` }}>
            <input
              size={1}
              value={step.label || ''}
              disabled={locked}
              onChange={(e) => onLabel(e.target.value.toUpperCase())}
              aria-label="When"
            />
          </span>
          <button type="button" onClick={onRemove} disabled={locked} aria-label="Remove step" className="km-press" style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--lineHi)', color: 'var(--faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="x" size={11} />
          </button>
        </div>
        <textarea className="kp-stepbrief" rows={Math.min(4, Math.max(1, Math.ceil(String(step.brief || '').length / 36)))} value={step.brief || ''} disabled={locked} onChange={(e) => onBrief(e.target.value)} onFocus={focusSoon} aria-label="What to say" style={{ resize: 'none', lineHeight: 1.4 }} />
      </div>
    </div>
  );
}

function LaneCard({ lane, value, onChange, hasEvent, defaultOpen }) {
  const m = LANE_META[lane];
  const [open, setOpen] = useState(!!defaultOpen);
  const [building, setBuilding] = useState(false);
  const gen = useRef(0);
  const enabled = value.enabled !== false;
  const steps = Array.isArray(value.steps) ? value.steps : [];

  const build = async () => {
    const text = String(value.text || '').trim();
    if (!text || building) return;
    setBuilding(true);
    const started = Date.now();
    try {
      const r = await parseLane(text, lane, hasEvent);
      const wait = Math.max(0, 650 - (Date.now() - started));
      setTimeout(() => { gen.current += 1; onChange({ ...value, steps: r.steps || [] }); setBuilding(false); }, wait);
    } catch (e) {
      setBuilding(false);
      toast.error(e.message || 'Could not build the steps');
    }
  };

  const patchStep = (i, p) => onChange({ ...value, steps: steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <div className="kp-lane">
      <span className="kp-lane-spine" style={{ background: m.color, opacity: enabled ? 1 : 0.25, boxShadow: 'none' }} />
      <div style={{ padding: '12px 13px 12px 17px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, textAlign: 'left' }}>
            <LaneDot lane={lane} size={10} />
            <span style={{ fontSize: 14.5, fontWeight: 500, color: enabled ? 'var(--text)' : 'var(--dim)', whiteSpace: 'nowrap' }}>{m.title}</span>
            <span className="kp-tag" style={{ color: m.color, background: `color-mix(in srgb, ${m.hex} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${m.hex} 32%, transparent)` }}>{m.tag}</span>
            <span style={{ flex: 1 }} />
            <Icon name="chevronDown" size={14} color="var(--faint)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s var(--km-ease)' }} />
          </button>
          <Switch checked={enabled} onChange={(v) => onChange({ ...value, enabled: v })} label={`${m.title} lane`} />
        </div>
        {open ? <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 5 }}>{enabled ? m.sub : lane === 'red' ? 'Off: they just stop hearing from you' : lane === 'gray' ? 'Off: silence just ends it' : 'Off: no follow-up'}</div> : (
          <div className="km-truncate" style={{ fontSize: 12, color: enabled ? 'var(--faint)' : 'var(--ghost)', marginTop: 4, paddingLeft: 19 }}>
            {!enabled ? 'Off' : lane === 'gray'
              ? (String(value.text || '').trim() ? `Quiet for ${(value.timerText || '2 days').toLowerCase()}, then one nudge` : 'No nudge yet')
              : steps.length ? `${steps.length} text${steps.length === 1 ? '' : 's'} · ${steps.map((x) => String(x.label || '').toLowerCase()).join(', ')}` : 'Tap to tell your AI what to do'}
          </div>
        )}

        {open && enabled ? (
          <div className="kp-step-in" style={{ marginTop: 12 }}>
            {lane !== 'gray' ? (
              <>
                <MonoLabel style={{ marginBottom: 7 }}>Tell your AI what this lane should do</MonoLabel>
                <div className="kp-composer">
                  <textarea rows={2} value={value.text || ''} placeholder={PLACEHOLDER[lane]} onChange={(e) => onChange({ ...value, text: e.target.value })} onFocus={focusSoon} aria-label={`${m.title} instructions`} />
                  <div className="kp-composer-row">
                    <SparkButton label={building ? 'Building…' : steps.length ? 'Rebuild' : 'Build'} disabled={!String(value.text || '').trim()} busy={building} onClick={build} style={{ height: 30 }} />
                  </div>
                </div>
                {steps.length ? (
                  <div key={gen.current} style={{ marginTop: 14 }}>
                    {steps.map((s, i) => (
                      <StepRow key={`${gen.current}-${i}`} index={i} step={s} color={m.hex} locked={building}
                        onLabel={(label) => patchStep(i, { label })}
                        onBrief={(brief) => patchStep(i, { brief })}
                        onRemove={() => onChange({ ...value, steps: steps.filter((_, j) => j !== i) })}
                      />
                    ))}
                    <MonoLabel>{CAPTION}</MonoLabel>
                    {lane === 'red' ? <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 7 }}>Then stop. Nothing else goes out; they stay in your book for next time.</div> : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <MonoLabel style={{ marginBottom: 7 }}>Wait for a reply</MonoLabel>
                <input
                  className="kp-input"
                  value={value.timerText || ''}
                  placeholder="2 DAYS"
                  onChange={(e) => { const timerText = e.target.value.toUpperCase(); onChange({ ...value, timerText, timerHours: timerTextToHours(timerText) }); }}
                  onFocus={focusSoon}
                  style={{ width: 120, textAlign: 'center', fontWeight: 500, letterSpacing: '0.1em', color: m.color }}
                  aria-label="Wait time"
                />
                <MonoLabel style={{ margin: '13px 0 7px' }}>Then tell your AI what to send, once</MonoLabel>
                <div className="kp-composer">
                  <textarea rows={2} value={value.text || ''} placeholder="One easy nudge, no pressure, did they see it" onChange={(e) => onChange({ ...value, text: e.target.value })} onFocus={focusSoon} aria-label="No-reply nudge" />
                </div>
                <MonoLabel style={{ marginTop: 9 }}>{CAPTION} · leave blank for no nudge</MonoLabel>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AiReplySection({ value, onChange }) {
  const v = value && typeof value === 'object' ? value : {};
  const on = v.mode === 'draft' || v.mode === 'suggest';
  return (
    <div className="kp-section" style={{ borderLeft: '3px solid #5AC8FA' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 500 }}>When they respond</div>
          <MonoLabel style={{ marginTop: 3 }}>{on ? 'AI drafts an answer · you approve every send' : 'Off · every reply is yours'}</MonoLabel>
        </div>
        <Switch checked={on} onChange={(next) => onChange({ ...v, mode: next ? 'draft' : 'off' })} label="When they respond" />
      </div>
      {on ? (
        <div className="kp-step-in" style={{ padding: '0 14px 13px' }}>
          <MonoLabel style={{ marginBottom: 7 }}>Tell your AI how to answer questions</MonoLabel>
          <div className="kp-composer">
            <textarea rows={3} value={v.instructions || ''} placeholder="Answer questions using the listing details. Parking is valet out front. If they ask about price, offers or terms, tell them I'll call them personally. Keep it short." onChange={(e) => onChange({ ...v, instructions: e.target.value })} onFocus={focusSoon} aria-label="Reply instructions" />
          </div>
          <MonoLabel style={{ marginTop: 9 }}>Drafts only · nothing sends without your tap · anything not covered comes to you</MonoLabel>
        </div>
      ) : null}
    </div>
  );
}

function RemindersSection({ value, onChange, hasEvent }) {
  const v = value && typeof value === 'object' ? value : {};
  const enabled = v.enabled === true;
  const [building, setBuilding] = useState(false);
  const build = async (text) => {
    if (!String(text || '').trim()) { onChange({ ...v, text, steps: [] }); return; }
    setBuilding(true);
    try {
      const r = await parseLane(text, 'reminders', true);
      const audience = /said yes|who confirmed|coming|green/i.test(text) ? 'green' : /everyone|everybody|all of them|whole list/i.test(text) ? 'everyone' : 'green';
      onChange({ ...v, text, steps: r.steps || [], audience });
    } catch (e) {
      toast.error(e.message || 'Could not build reminders');
    } finally {
      setBuilding(false);
    }
  };
  if (!hasEvent) return null;
  const steps = Array.isArray(v.steps) ? v.steps : [];
  return (
    <div className="kp-section" style={{ borderLeft: '3px solid #B98CFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 500 }}>Reminders</div>
          <MonoLabel style={{ marginTop: 3 }}>{enabled ? `${steps.length || 'No'} timed reminder${steps.length === 1 ? '' : 's'} · ${v.audience === 'everyone' ? 'everyone' : 'people who said yes'}` : 'Off'}</MonoLabel>
        </div>
        <Switch checked={enabled} onChange={(next) => onChange({ ...v, enabled: next })} label="Reminders" />
      </div>
      {enabled ? (
        <div className="kp-step-in" style={{ padding: '0 14px 13px' }}>
          <MonoLabel style={{ marginBottom: 7 }}>Tell your AI what reminders to send</MonoLabel>
          <div className="kp-composer">
            <textarea rows={2} value={v.text || ''} placeholder="Remind everyone who said yes the morning of, and again 2 hours before with the address" onChange={(e) => onChange({ ...v, text: e.target.value })} onBlur={(e) => build(e.target.value)} onFocus={focusSoon} aria-label="Reminder instructions" />
          </div>
          <MonoLabel style={{ marginTop: 9, color: steps.length ? 'var(--bright)' : undefined }}>{building ? 'Building the schedule…' : steps.length ? steps.map((s) => s.label).join(' · ') : 'Tap outside the box to build the schedule'}</MonoLabel>
          <MonoLabel style={{ marginTop: 6 }}>Anchored to the event · never sent after it · still sent if you take a thread over</MonoLabel>
        </div>
      ) : null}
    </div>
  );
}

export default function TrafficLanes({ value, onChange, hasEvent = false, showExtras = true }) {
  const lanes = normalizeLanes(value);
  const patch = (k, v) => onChange({ ...lanes, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {LANE_KEYS.map((k, i) => <LaneCard key={k} lane={k} value={lanes[k]} hasEvent={hasEvent} defaultOpen={i === 0} onChange={(v) => patch(k, v)} />)}
      {showExtras ? <AiReplySection value={lanes.aiReply} onChange={(v) => patch('aiReply', v)} /> : null}
      {showExtras ? <RemindersSection value={lanes.reminders} onChange={(v) => patch('reminders', v)} hasEvent={hasEvent} /> : null}
    </div>
  );
}
