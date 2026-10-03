// AutomationEditor — edit one default automation in a floating sheet: what it
// says (the agent's words to the AI), its sequence (post-closing), whether it
// sends on its own or drafts for approval, its threshold, and recent sends.
// "Save, turn on" IS the approval for its trigger-fired texts.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { Button } from '../ui/kit';
import { toast } from '../ui/toast';
import { nav } from '../../lib/nav';
import { relativeTime } from '../../lib/format';
import { updateAutomation } from '../../api/campaigns';
import { ComposerField, Choice, MonoLabel, InfoNote, Eyebrow } from './kit';

export default function AutomationEditor({ automation, open, onClose, onSaved }) {
  const [brief, setBrief] = useState('');
  const [steps, setSteps] = useState([]);
  const [approval, setApproval] = useState('auto');
  const [minScore, setMinScore] = useState(90);
  const [leadDays, setLeadDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState(true);
  // Close with the sheet's exit animation, then tell the parent.
  const closeAnimated = () => { setShown(false); setTimeout(() => { onClose && onClose(); }, 260); };

  useEffect(() => {
    if (!automation) return;
    setShown(true);
    setBrief(automation.brief || '');
    setSteps(Array.isArray(automation.steps) ? automation.steps.map((s) => ({ ...s })) : []);
    setApproval(automation.approval || 'auto');
    setMinScore(automation.minScore || 90);
    setLeadDays(automation.leadDays || 90);
  }, [automation]);

  if (!automation) return null;
  const a = automation;
  const multi = a.trigger === 'post_closing';

  const save = async (enable) => {
    if (saving) return;
    if ((enable || a.enabled) && !brief.trim() && !multi) { toast.error('Explain the text before turning this on'); return; }
    setSaving(true);
    try {
      const patch = { brief, approval, ...(multi ? { steps } : { steps: [{ ...(steps[0] || { dayOffset: 0 }), instructions: brief }] }) };
      if (a.trigger === 'new_listing_match') patch.minScore = minScore;
      if (a.trigger === 'lease_expiry') patch.leadDays = leadDays;
      if (enable != null) patch.enabled = enable;
      const { automation: updated } = await updateAutomation(a.id, patch);
      onSaved && onSaved(updated);
      toast.success(enable === true ? `${a.name} is on` : enable === false ? `${a.name} is off` : 'Saved');
      closeAnimated();
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open && shown}
      onClose={onClose}
      title={a.name}
      subtitle={a.enabled ? 'On' : 'Off'}
      right={{ label: saving ? 'Saving…' : 'Save', onClick: () => save(null), disabled: saving }}
      footer={(
        <Button block size="lg" variant={a.enabled ? 'ghost' : 'primary'} loading={saving} onClick={() => save(!a.enabled)}>
          {a.enabled ? 'Turn off' : 'Save, turn on'}
        </Button>
      )}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 2px', '--kp-accent': a.accent }}>
        <span className="kp-auto-tile"><Icon name={a.icon} size={18} stroke={2} /></span>
        <div style={{ minWidth: 0 }}>
          <MonoLabel>When</MonoLabel>
          <div style={{ fontSize: 14, marginTop: 2 }}>{a.when}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <div className="kp-tile" style={{ flex: 1 }}><MonoLabel>Qualify now</MonoLabel><div className="kp-tile-num">{a.audienceCount}</div></div>
        <div className="kp-tile" style={{ flex: 1 }}><MonoLabel>Texts sent</MonoLabel><div className="kp-tile-num">{a.sentCount}</div></div>
        <div className="kp-tile" style={{ flex: 1 }}><MonoLabel>Queued</MonoLabel><div className="kp-tile-num">{a.queued}</div></div>
      </div>

      {multi ? (
        <>
          <Eyebrow icon="clock" blue style={{ marginTop: 20 }}>The sequence</Eyebrow>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.map((s, i) => (
              <div key={i}>
                <div className="kp-mono" style={{ color: 'var(--bright)', marginBottom: 6 }}>{s.label || `${s.dayOffset} days after closing`}</div>
                <ComposerField rows={2} value={s.instructions || ''} onChange={(v) => setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, instructions: v } : x)))} placeholder="What should this text say?" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <Eyebrow icon="send" blue style={{ marginTop: 20 }}>What goes out</Eyebrow>
          <ComposerField style={{ marginTop: 10 }} rows={4} value={brief} onChange={setBrief} placeholder="Tell your AI the gist, in your own words" />
          <InfoNote style={{ marginTop: 10 }}>Your AI writes each person their own text from this, in your voice. With no AI available, a warm template personalized by first name and home is used.</InfoNote>
        </>
      )}

      <Eyebrow icon="checkCircle" blue style={{ marginTop: 20 }}>Approval</Eyebrow>
      <Choice
        style={{ marginTop: 10 }}
        value={approval}
        onChange={setApproval}
        options={[{ id: 'auto', label: 'Sends on its own', sub: 'Turning it on approves it' }, { id: 'draft', label: 'I approve each', sub: 'Drafts wait for your tap' }]}
      />

      {a.trigger === 'new_listing_match' ? (
        <>
          <Eyebrow icon="target" blue style={{ marginTop: 20 }}>Match threshold</Eyebrow>
          <Choice style={{ marginTop: 10 }} value={minScore} onChange={setMinScore} options={[85, 90, 95].map((n) => ({ id: n, label: `${n}+` }))} />
        </>
      ) : null}
      {a.trigger === 'lease_expiry' ? (
        <>
          <Eyebrow icon="calendar" blue style={{ marginTop: 20 }}>Lead time</Eyebrow>
          <Choice style={{ marginTop: 10 }} value={leadDays} onChange={setLeadDays} options={[60, 90, 120].map((n) => ({ id: n, label: `${n} days` }))} />
        </>
      ) : null}

      <Eyebrow icon="messageSquare" style={{ marginTop: 22 }}>Recent sends</Eyebrow>
      {a.recentSends && a.recentSends.length ? (
        <div className="kp-list" style={{ marginTop: 10 }}>
          {a.recentSends.map((m) => (
            <button key={m.id} type="button" className="kp-li km-press" onClick={() => { closeAnimated(); nav.openThread({ conversationId: m.conversationId, clientId: m.clientId }); }}>
              <Avatar name={m.name} seed={m.clientId} src={m.avatarUrl} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="km-truncate" style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--faint)', flexShrink: 0 }}>{relativeTime(m.sentAt)}</span>
                </span>
                <span className="km-clamp-2 km-selectable" style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{m.body}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 8 }}>Nothing sent yet. {a.enabled ? 'It fires the next time its trigger happens.' : 'Turn it on and it fires the next time its trigger happens.'}</div>
      )}
      <InfoNote kind="route" style={{ marginTop: 16 }}>Every text passes the Sender Guard: 9 AM to 8 PM their time, paced, and never to anyone who opted out. Replies land in your inbox and the conversation is yours.</InfoNote>
    </Sheet>
  );
}
