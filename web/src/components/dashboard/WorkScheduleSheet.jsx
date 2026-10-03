// WorkScheduleSheet — everything the Battle Plan planner works around:
//   • weekly hours (per day, incl. off days) and per-date overrides
//     ("working Sunday 10–2", "off Friday")
//   • routine blocks (gym, school run, lunch…) — green tiles on the rail
//   • the daily content block + protected lunch preferences
//   • planner rules in plain English ("no calls before 9am") and the opt-in
//     sphere check-ins
// Saving re-plans today + tomorrow on the server (deterministic, instant).
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { Switch, Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { haptic } from '../../lib/native';
import { getWorkSchedule, saveWorkSchedule } from '../../api/appointments';
import { getSelfRules, addSelfRule, removeSelfRule } from '../../api/battlePlan';
import { fmtMin, durLabel, hhmmToMin, dateKey, keyToDate } from '../battleplan/time';
import '../../styles/dashboard.css';
import useAgentTz from '../battleplan/useAgentTz';
import TimeSelect from '../battleplan/TimeSelect';

const DAYS = [
  { key: 'mon', label: 'Monday', short: 'M', iso: 1 }, { key: 'tue', label: 'Tuesday', short: 'T', iso: 2 },
  { key: 'wed', label: 'Wednesday', short: 'W', iso: 3 }, { key: 'thu', label: 'Thursday', short: 'T', iso: 4 },
  { key: 'fri', label: 'Friday', short: 'F', iso: 5 }, { key: 'sat', label: 'Saturday', short: 'S', iso: 6 },
  { key: 'sun', label: 'Sunday', short: 'S', iso: 7 },
];
const TEMPLATES = [
  { title: 'Workout', start: '06:30', durationMin: 60, kind: 'gym' },
  { title: 'School run', start: '07:45', durationMin: 30, kind: 'family' },
  { title: 'Market prep', start: '08:30', durationMin: 30, kind: 'routine' },
  { title: 'Lunch', start: '12:30', durationMin: 45, kind: 'lunch' },
  { title: 'Wind down', start: '21:00', durationMin: 60, kind: 'routine' },
];
const RULE_EXAMPLES = ['No calls before 9am', 'No calls after 7pm', 'Cap my day at 8 moves', 'Block from 3pm to 4pm for school pickup'];

function daysSummary(days) {
  const d = [...new Set(days || [])].sort();
  if (!d.length || d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '6,7') return 'Weekends';
  return d.map((x) => DAYS.find((y) => y.iso === x).label.slice(0, 3)).join(', ');
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ margin: '22px 2px 8px' }}>
      <div className="km-eyebrow">{children}</div>
      {sub ? <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

function Chips({ options, value, onChange, format = (x) => x }) {
  return (
    <div className="km-scroll-x" style={{ display: 'flex', gap: 7 }}>
      {options.map((o) => <button key={o} type="button" className={`km-pill ${value === o ? 'km-pill--on' : ''}`} style={{ height: 32 }} onClick={() => onChange(o)}>{format(o)}</button>)}
    </div>
  );
}

function RoutineEditor({ block, onSave, onCancel, onDelete }) {
  const [b, setB] = useState(block);
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const toggleDay = (iso) => set({ days: b.days.includes(iso) ? b.days.filter((d) => d !== iso) : [...b.days, iso].sort() });
  const valid = b.title.trim() && hhmmToMin(b.start) != null && b.days.length;
  return (
    <div className="bp-tile" style={{ padding: 14, borderRadius: 16, marginBottom: 8 }}>
      <div className="bp-spine" style={{ background: 'var(--kind-personal)' }} />
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="km-input" value={b.title} onChange={(e) => set({ title: e.target.value })} placeholder="Gym, school run, lunch…" maxLength={60} style={{ flex: 1 }} />
        <TimeSelect value={b.start} onChange={(v) => set({ start: v })} from={0} to={23 * 60 + 45} label="Block start" style={{ width: 124, flexShrink: 0 }} />
      </div>
      <div style={{ marginTop: 10 }}><Chips options={[15, 30, 45, 60, 90, 120]} value={b.durationMin} onChange={(v) => set({ durationMin: v })} format={durLabel} /></div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {DAYS.map((d) => {
          const on = b.days.includes(d.iso);
          return (
            <button key={d.key} type="button" onClick={() => toggleDay(d.iso)} aria-pressed={on} aria-label={d.label} className="km-press" style={{ flex: 1, height: 34, borderRadius: 10, fontSize: 12.5, fontWeight: 500, background: on ? 'color-mix(in srgb, var(--kind-personal) 20%, transparent)' : 'var(--bp-fill)', border: `1px solid ${on ? 'color-mix(in srgb, var(--kind-personal) 50%, transparent)' : 'var(--bp-hair2)'}`, color: on ? 'var(--kind-personal)' : 'var(--dim)' }}>{d.short}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {onDelete ? <button type="button" className="km-btn km-btn--ghost km-btn--sm" style={{ color: 'var(--red)' }} onClick={onDelete}>Delete</button> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="km-btn km-btn--ghost km-btn--sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="km-btn km-btn--sm" disabled={!valid} onClick={() => onSave({ ...b, title: b.title.trim() })}>Done</button>
      </div>
    </div>
  );
}

export default function WorkScheduleSheet({ onClose }) {
  useAgentTz();
  const [s, setS] = useState(null);
  const [status, setStatus] = useState('loading');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(null); // routine index | 'new'
  const [ovDate, setOvDate] = useState('');
  const [ovOff, setOvOff] = useState(true);
  const [ovStart, setOvStart] = useState('10:00');
  const [ovEnd, setOvEnd] = useState('14:00');
  const [rules, setRules] = useState([]);
  const [ruleText, setRuleText] = useState('');
  const [ruleBusy, setRuleBusy] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    getWorkSchedule().then((r) => { setS(r.schedule); setStatus('ready'); }).catch(() => setStatus('error'));
    getSelfRules().then((r) => setRules(r.rules || [])).catch(() => {});
  }, []);

  const patch = (p) => { setS((x) => ({ ...x, ...p })); setDirty(true); };
  const setDay = (key, p) => patch({ weekly: { ...s.weekly, [key]: { ...s.weekly[key], ...p } } });
  const today = dateKey();
  const overrides = useMemo(() => Object.entries((s && s.overrides) || {}).filter(([d]) => d >= today).sort(([a], [b]) => a.localeCompare(b)), [s, today]);

  const save = async (close) => {
    if (!s || saving) return;
    setSaving(true);
    try {
      const r = await saveWorkSchedule({
        weekly: s.weekly, overrides: s.overrides, routine: s.routine, contentBlock: s.contentBlock, lunch: s.lunch, planner: s.planner,
      });
      setS(r.schedule);
      setDirty(false);
      haptic('success');
      toast.success('Schedule saved — your plan is re-planning around it.');
      close?.();
    } catch (err) {
      toast.error(err.message || 'Couldn’t save your schedule.');
    } finally { setSaving(false); }
  };

  const addOverride = () => {
    if (!ovDate) return;
    patch({ overrides: { ...s.overrides, [ovDate]: ovOff ? { off: true } : { start: ovStart, end: ovEnd, off: false, bonus: true } } });
    setOvDate('');
  };
  const removeOverride = (d) => { const o = { ...s.overrides }; delete o[d]; patch({ overrides: o }); };

  const addRule = async (text) => {
    const t = String(text || ruleText).trim();
    if (!t || ruleBusy) return;
    setRuleBusy(true);
    try {
      const { rule } = await addSelfRule(t);
      setRules((r) => [...r, rule]);
      setRuleText('');
      haptic('light');
      toast.success(rule.label.startsWith('Enforced') ? 'Rule added — the planner enforces it.' : 'Noted — the AI will use it as context.');
    } catch (err) { toast.error(err.message || 'Couldn’t add that rule.'); } finally { setRuleBusy(false); }
  };
  const dropRule = async (rule) => {
    const before = rules;
    setRules((r) => r.filter((x) => x.id !== rule.id));
    try { await removeSelfRule(rule.id); } catch { setRules(before); toast.error('Couldn’t remove that rule.'); }
  };

  return (
    <Sheet open onClose={onClose} title="Work schedule" subtitle="Your plan works around this" right={{ label: saving ? 'Saving…' : 'Save', onClick: () => save(closeRef.current), disabled: !dirty || saving }} maxHeight="92%" maxWidth={600}>
      {({ close }) => {
        closeRef.current = close;
        if (status === 'loading') return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={22} /></div>;
        if (status === 'error' || !s) return <div className="km-empty"><div className="km-empty-title">Couldn’t load your schedule</div></div>;
        return (
          <div style={{ paddingBottom: 8 }}>
            <SectionTitle sub="Weekends are prime showing days — set what you actually work.">Weekly hours</SectionTitle>
            <div className="km-list" style={{ padding: '0 12px' }}>
              {DAYS.map((d) => {
                const day = s.weekly[d.key] || { start: '09:00', end: '18:00', off: false };
                return (
                  <div key={d.key} className="km-row" style={{ gap: 10, padding: '10px 0' }}>
                    <span style={{ width: 44, fontSize: 14.5, fontWeight: 500, opacity: day.off ? 0.45 : 1 }}>{d.label.slice(0, 3)}</span>
                    {day.off ? (
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--faint)' }}>Off — outreach paused</span>
                    ) : (
                      <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <TimeSelect compact value={day.start} onChange={(v) => setDay(d.key, { start: v })} label={`${d.label} start`} style={{ flex: 1 }} />
                        <span style={{ color: 'var(--faint)', fontSize: 12 }}>–</span>
                        <TimeSelect compact value={day.end} onChange={(v) => setDay(d.key, { end: v })} label={`${d.label} end`} style={{ flex: 1 }} />
                      </span>
                    )}
                    <Switch checked={!day.off} onChange={(on) => setDay(d.key, { off: !on })} label={`${d.label} working`} />
                  </div>
                );
              })}
            </div>

            <SectionTitle sub="One-off changes: a day off, or a bonus day you’re working.">Date overrides</SectionTitle>
            {overrides.length ? (
              <div className="km-list" style={{ padding: '0 12px', marginBottom: 8 }}>
                {overrides.map(([d, o]) => (
                  <div key={d} className="km-row" style={{ padding: '10px 0' }}>
                    <Icon name={o.off ? 'moon' : 'sun'} size={16} color={o.off ? 'var(--faint)' : 'var(--amber)'} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{keyToDate(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span style={{ fontSize: 13, color: 'var(--dim)' }}>{o.off ? 'Off' : `${fmtMin(hhmmToMin(o.start))} – ${fmtMin(hhmmToMin(o.end))}`}</span>
                    <button type="button" className="km-icon-btn km-icon-btn--sm" onClick={() => removeOverride(d)} aria-label="Remove override"><Icon name="x" size={15} color="var(--faint)" /></button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="bp-tile" style={{ padding: 12, borderRadius: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="date" className="km-input" value={ovDate} min={today} onChange={(e) => setOvDate(e.target.value)} style={{ flex: 1, minWidth: 0, width: '100%' }} aria-label="Override date" />
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} role="radiogroup" aria-label="Override type">
                  <button type="button" role="radio" aria-checked={ovOff} className={`km-pill ${ovOff ? 'km-pill--on' : ''}`} style={{ padding: '0 12px' }} onClick={() => setOvOff(true)}>Off</button>
                  <button type="button" role="radio" aria-checked={!ovOff} className={`km-pill ${!ovOff ? 'km-pill--on' : ''}`} style={{ padding: '0 12px' }} onClick={() => setOvOff(false)}>Working</button>
                </div>
              </div>
              {!ovOff ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <TimeSelect value={ovStart} onChange={setOvStart} label="Override start" style={{ flex: 1 }} />
                  <span style={{ color: 'var(--faint)' }}>–</span>
                  <TimeSelect value={ovEnd} onChange={setOvEnd} label="Override end" style={{ flex: 1 }} />
                </div>
              ) : null}
              <button type="button" className="km-btn km-btn--ghost km-btn--sm km-btn--block" style={{ marginTop: 10 }} disabled={!ovDate} onClick={addOverride}><Icon name="plus" size={15} /> Add override</button>
            </div>

            <SectionTitle sub="Standing blocks show as green tiles on your rail. Lunch slides after client appointments.">Daily routine</SectionTitle>
            {(s.routine || []).map((b, i) => (editing === i ? (
              <RoutineEditor
                key={b.id || i}
                block={{ ...b, days: b.days && b.days.length ? b.days : [1, 2, 3, 4, 5, 6, 7] }}
                onCancel={() => setEditing(null)}
                onDelete={() => { patch({ routine: s.routine.filter((_, j) => j !== i) }); setEditing(null); }}
                onSave={(nb) => { patch({ routine: s.routine.map((x, j) => (j === i ? nb : x)) }); setEditing(null); }}
              />
            ) : (
              <button key={b.id || i} type="button" className="bp-tile km-press" onClick={() => setEditing(i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px 11px 16px', marginBottom: 8, textAlign: 'left' }}>
                <div className="bp-spine" style={{ background: 'var(--kind-personal)' }} />
                <span className="bp-num" style={{ width: 62, fontSize: 13, fontWeight: 500, color: 'var(--kind-personal)' }}>{fmtMin(hhmmToMin(b.start))}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{b.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>{durLabel(b.durationMin)} · {daysSummary(b.days)}</span>
                </span>
                <Icon name="edit" size={15} color="var(--faint)" />
              </button>
            )))}
            {editing === 'new' ? (
              <RoutineEditor
                block={{ title: '', start: '07:00', durationMin: 30, days: [1, 2, 3, 4, 5], kind: 'routine' }}
                onCancel={() => setEditing(null)}
                onSave={(nb) => { patch({ routine: [...(s.routine || []), nb] }); setEditing(null); }}
              />
            ) : (
              <>
                {!(s.routine || []).length ? (
                  <div className="km-scroll-x" style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
                    {TEMPLATES.map((t) => (
                      <button key={t.title} type="button" className="km-pill" onClick={() => patch({ routine: [...(s.routine || []), { ...t, days: [1, 2, 3, 4, 5, 6, 7] }] })}>
                        <Icon name="plus" size={13} /> {t.title} {fmtMin(hhmmToMin(t.start))}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button type="button" className="km-btn km-btn--ghost km-btn--sm km-btn--block" onClick={() => setEditing('new')}><Icon name="plus" size={15} /> Add a routine block</button>
              </>
            )}

            <SectionTitle sub="The planner keeps these protected every day.">Planner blocks</SectionTitle>
            <div className="km-list" style={{ padding: '4px 14px 12px' }}>
              <div className="km-row" style={{ borderBottom: 0, paddingBottom: 6 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--kind-content) 16%, transparent)' }}><Icon name="camera" size={16} color="var(--kind-content)" stroke={2} /></span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Content block</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>Listing media, reels, market updates</span>
                </span>
                <Switch checked={s.contentBlock.enabled !== false} onChange={(v) => patch({ contentBlock: { ...s.contentBlock, enabled: v } })} label="Content block" />
              </div>
              {s.contentBlock.enabled !== false ? (
                <div style={{ paddingLeft: 42 }}>
                  <Chips options={[60, 90, 120]} value={s.contentBlock.durationMin} onChange={(v) => patch({ contentBlock: { ...s.contentBlock, durationMin: v } })} format={durLabel} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--dim)' }}>Ideally starts at</span>
                    <TimeSelect compact value={s.contentBlock.preferredStart || '10:00'} onChange={(v) => patch({ contentBlock: { ...s.contentBlock, preferredStart: v } })} label="Preferred content start" style={{ width: 118 }} />
                  </div>
                </div>
              ) : null}
              <div className="km-row" style={{ borderBottom: 0, paddingBottom: 6, marginTop: 6 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--kind-personal) 16%, transparent)' }}><Icon name="wine" size={16} color="var(--kind-personal)" stroke={2} /></span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Protected lunch</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>Slides after a client appointment that covers it</span>
                </span>
                <Switch checked={s.lunch.enabled !== false} onChange={(v) => patch({ lunch: { ...s.lunch, enabled: v } })} label="Lunch" />
              </div>
              {s.lunch.enabled !== false ? (
                <div style={{ paddingLeft: 42 }}>
                  <Chips options={[30, 45, 60]} value={s.lunch.durationMin} onChange={(v) => patch({ lunch: { ...s.lunch, durationMin: v } })} format={durLabel} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--dim)' }}>Ideally starts at</span>
                    <TimeSelect compact value={s.lunch.preferredStart || '12:30'} onChange={(v) => patch({ lunch: { ...s.lunch, preferredStart: v } })} from={10 * 60} to={16 * 60} label="Preferred lunch start" style={{ width: 118 }} />
                  </div>
                </div>
              ) : null}
            </div>

            <SectionTitle sub="Plain English. Clear ones are enforced; the rest guide the AI’s wording.">Planner rules</SectionTitle>
            {rules.map((r) => (
              <div key={r.id} className="km-row" style={{ padding: '10px 4px' }}>
                <Icon name={r.label.startsWith('Enforced') ? 'shield' : 'sparkle'} size={16} color={r.label.startsWith('Enforced') ? 'var(--green)' : 'var(--violet)'} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{r.text}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)', marginTop: 1 }}>{r.label}</span>
                </span>
                <button type="button" className="km-icon-btn km-icon-btn--sm" onClick={() => dropRule(r)} aria-label="Remove rule"><Icon name="trash" size={15} color="var(--faint)" /></button>
              </div>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); addRule(); }} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input className="td-input" value={ruleText} onChange={(e) => setRuleText(e.target.value)} placeholder="e.g. No calls before 9am" maxLength={280} />
              <button type="submit" className="km-btn km-btn--sm" disabled={!ruleText.trim() || ruleBusy}>{ruleBusy ? '…' : 'Add'}</button>
            </form>
            {!rules.length ? (
              <div className="km-scroll-x" style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                {RULE_EXAMPLES.map((t) => <button key={t} type="button" className="km-pill" onClick={() => addRule(t)}>{t}</button>)}
              </div>
            ) : null}

            <SectionTitle>Sphere</SectionTitle>
            <div className="km-list" style={{ padding: '0 14px' }}>
              <div className="km-row">
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Sphere check-ins</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--dim)' }}>Suggest a few no-ask texts a day to past clients and your sphere who’ve gone quiet 90+ days.</span>
                </span>
                <Switch checked={!!(s.planner && s.planner.soiCheckins)} onChange={(v) => patch({ planner: { ...(s.planner || {}), soiCheckins: v } })} label="Sphere check-ins" />
              </div>
              {s.planner && s.planner.soiCheckins ? (
                <div className="km-row">
                  <span style={{ flex: 1, fontSize: 14 }}>Per day</span>
                  <Chips options={[2, 3, 5]} value={s.planner.soiDailyCap || 3} onChange={(v) => patch({ planner: { ...s.planner, soiDailyCap: v } })} />
                </div>
              ) : null}
            </div>

            <button type="button" className="km-btn km-btn--lg km-btn--block" style={{ marginTop: 22 }} disabled={!dirty || saving} onClick={() => save(close)}>
              {saving ? 'Saving…' : dirty ? 'Save schedule' : 'Saved'}
            </button>
          </div>
        );
      }}
    </Sheet>
  );
}
