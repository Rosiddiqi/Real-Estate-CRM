// Settings — profile, brokerage, appearance, assistant, messaging line,
// planning, notifications, blocked contacts, data, sign out.
import { useEffect, useState } from 'react';
import PushPanel from '../../components/ui/PushPanel';
import Sheet from '../../components/ui/Sheet';
import Avatar from '../../components/ui/Avatar';
import Icon from '../../components/ui/Icon';
import { Button, Group, Row, Section, Switch, TextInput, TextArea, Select, Spinner } from '../../components/ui/kit';
import { toast, confirm } from '../../components/ui/toast';
import { useAuth } from '../../hooks/useAuth';
import { assistantNameOf } from '../../hooks/useAssistant';
import { PERSONALITY_PRESETS } from '../../components/onboarding/personalityPresets';
import { api } from '../../api/client';
import { updateMe, updateWorkspace, uploadFiles } from '../../api/system';
import { nav } from '../../lib/nav';
import { ACCENTS, getStoredAccent, getStoredTheme, setAccent, setTheme } from '../../hooks/useShellEffects';
import { setFullWidth } from '../../lib/desktopFrame';
import { isNative } from '../../lib/native';
import { fullName, formatPhone, formatPhoneInput, formatDate } from '../../lib/format';
import { BRAND } from '../../brand';

const PERSONALITIES = PERSONALITY_PRESETS;

const NOTIFY_TYPES = [
  { id: 'message', label: 'New messages' },
  { id: 'call_missed', label: 'Missed calls & voicemail' },
  { id: 'appointment', label: 'Appointment reminders' },
  { id: 'match', label: 'New buyer matches' },
  { id: 'price_drop', label: 'Price reductions' },
  { id: 'deal', label: 'Deal milestones' },
  { id: 'ai', label: 'Assistant suggestions' }, // shown with the agent's own assistant name
];

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'Pacific/Honolulu', 'Europe/London'];

function SectionHeading({ children }) {
  return <div className="km-eyebrow" style={{ padding: '24px 4px 8px' }}>{children}</div>;
}

export default function SettingsPage({ onClose }) {
  const { user, workspace, logout, updateUser, updateWorkspace: patchWs } = useAuth();
  const [me, setMe] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [theme, setThemeState] = useState(getStoredTheme());
  const [accent, setAccentState] = useState(getStoredAccent());

  useEffect(() => { api.get('/me').then(setMe).catch(() => {}); }, []);

  const prefs = user?.preferences || {};
  const notify = prefs.notifications || {};
  const ai = me?.ai;
  const aiPrefs = user?.aiPreferences || {};

  const savePrefs = async (patch) => {
    const next = { ...prefs, ...patch };
    updateUser({ preferences: next });
    try { await updateMe({ preferences: patch }); } catch (e) { toast.error(e.message); }
  };

  const chooseTheme = (t) => { setThemeState(t); setTheme(t); savePrefs({ theme: t }); };
  const chooseAccent = (a) => { setAccentState(a); setAccent(a); savePrefs({ accent: a }); };

  const onAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const [up] = await uploadFiles([f]);
      updateUser({ avatarUrl: up.url });
      await updateMe({ avatarUrl: up.url });
      toast.success('Photo updated');
    } catch (err) { toast.error(err.message); }
  };

  const signOut = async () => {
    if (await confirm({ title: 'Sign out?', message: 'You can sign back in any time.', confirmLabel: 'Sign out', destructive: true })) {
      await logout();
      nav.closeAll();
    }
  };

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  return (
    <PushPanel onClose={onClose} title="Settings" zIndex={220}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 16px 0' }}>
        {/* Profile hero */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 4px' }}>
          <label style={{ position: 'relative', cursor: 'pointer' }}>
            <Avatar name={name} seed={user?.id} src={user?.avatarUrl} size={68} />
            <span style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>
              <Icon name="camera" size={12} color="#fff" stroke={2.2} />
            </span>
            <input type="file" accept="image/*" onChange={onAvatar} style={{ display: 'none' }} />
          </label>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="km-truncate" style={{ fontSize: 20, fontWeight: 700 }}>{name}</div>
            <div className="km-truncate" style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 2 }}>{user?.title || 'Luxury Real Estate Advisor'}</div>
            <div className="km-truncate" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{user?.email}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSheet('profile')}>Edit</Button>
        </div>

        <SectionHeading>Brokerage</SectionHeading>
        <Group>
          <Row icon="building" title={workspace?.brokerageName || 'Add your brokerage'} sub={[workspace?.officeName, workspace?.market].filter(Boolean).join(' · ') || 'Office, market'} chevron onClick={() => setSheet('brokerage')} />
          <Row icon="clock" title="Time zone" value={(workspace?.timezone || '').replace('America/', '').replace('_', ' ')} chevron onClick={() => setSheet('brokerage')} style={{ borderBottom: 0 }} />
        </Group>

        <SectionHeading>Appearance</SectionHeading>
        <Group style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[['dark', 'Dark', 'moon'], ['light', 'Light', 'sun']].map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => chooseTheme(id)} className="km-press"
                style={{ height: 64, borderRadius: 14, border: `1px solid ${theme === id ? 'var(--blue)' : 'var(--line)'}`, background: theme === id ? 'var(--tint)' : 'var(--surfaceHi)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontWeight: 600, color: theme === id ? 'var(--bright)' : 'var(--text)' }}>
                <Icon name={icon} size={18} /> {label}
              </button>
            ))}
          </div>
          <div className="km-eyebrow" style={{ margin: '16px 2px 10px' }}>Accent</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {Object.entries(ACCENTS).map(([id, a]) => (
              <button key={id} type="button" onClick={() => chooseAccent(id)} className="km-press"
                style={{ flex: 1, padding: '10px 6px', borderRadius: 14, border: `1px solid ${accent === id ? a.blue : 'var(--line)'}`, background: accent === id ? a.tint : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 14, background: `linear-gradient(180deg, ${a.bright}, ${a.deep})`, boxShadow: `0 6px 16px -6px ${a.glow}` }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: accent === id ? a.bright : 'var(--dim)' }}>{a.label}</span>
              </button>
            ))}
          </div>
          {!isNative() && (window.self !== window.top || window.innerWidth >= 760) ? (
            <>
              <div className="km-eyebrow" style={{ margin: '16px 2px 10px' }}>On a computer</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['phone', 'iPhone view', window.self !== window.top], ['full', 'Full width', window.self === window.top]].map(([id, label, on]) => (
                  <button key={id} type="button" onClick={() => { if (!on) setFullWidth(id === 'full'); }} className="km-press"
                    style={{ height: 44, borderRadius: 12, border: `1px solid ${on ? 'var(--blue)' : 'var(--line)'}`, background: on ? 'var(--tint)' : 'var(--surfaceHi)', fontWeight: 600, fontSize: 14, color: on ? 'var(--bright)' : 'var(--text)' }}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </Group>

        <SectionHeading>Assistant</SectionHeading>
        <div className="km-ai-card" style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.45, borderLeftColor: 'var(--violet)', background: 'linear-gradient(135deg, rgba(154,77,255,0.10), rgba(46,139,255,0.06))', borderColor: 'rgba(154,77,255,0.25)' }}>
          {assistantNameOf(user)} reads your book, drafts texts in your voice and keeps your day straight. It never texts a client without your approval.
        </div>
        <Group>
          <Row icon="sparkle" iconColor="var(--violet)" iconBg="rgba(154,77,255,0.14)" title={assistantNameOf(user)} sub={PERSONALITIES.find((p) => p.id === aiPrefs.aiPersonalityId)?.label || 'Personality & voice'} chevron onClick={() => setSheet('assistant')} />
          <Row
            icon="zap" iconColor={ai?.available ? 'var(--green)' : 'var(--amber)'} iconBg={ai?.available ? 'rgba(48,210,122,0.14)' : 'rgba(242,169,59,0.14)'}
            title="AI engine"
            sub={ai ? (ai.available ? `Connected · ${ai.model}` : ai.hasKey ? 'Paused — check the key or budget' : 'Not connected — smart fallbacks are on') : 'Checking…'}
            style={{ borderBottom: 0 }}
          />
        </Group>

        <SectionHeading>Messaging line</SectionHeading>
        <MessagingLine />

        <SectionHeading>Planning</SectionHeading>
        <Group>
          <Row icon="calendar" title="Work schedule & routine" sub="Hours, days off, content block, lunch" chevron onClick={() => nav.openWorkSchedule()} />
          <Row icon="percent" title="Commission plan & goals" sub="Split, cap, fees, annual targets" chevron onClick={() => nav.openPayPlan()} />
          <HiddenContactsRow />
        </Group>

        <SectionHeading>Notifications</SectionHeading>
        <Group>
          {NOTIFY_TYPES.map((t, i) => (
            <Row key={t.id} title={t.id === 'ai' ? `${assistantNameOf(user)} suggestions` : t.label} style={i === NOTIFY_TYPES.length - 1 ? { borderBottom: 0 } : undefined}
              right={<Switch checked={notify[t.id] !== false} onChange={(v) => savePrefs({ notifications: { ...notify, [t.id]: v } })} label={t.label} />} />
          ))}
        </Group>
        <PushPermissionHint />

        <SectionHeading>Contacts</SectionHeading>
        <Group>
          <Row icon="upload" title="Import clients" sub="CSV, Excel or vCard" chevron onClick={() => nav.openImport()} />
          <Row icon="checklist" title="Waitlists" sub="Buildings, communities, releases" chevron onClick={() => nav.openWaitlists()} />
          <Row icon="eyeOff" title="Blocked contacts" chevron onClick={() => setSheet('blocked')} style={{ borderBottom: 0 }} />
        </Group>

        <SectionHeading>Account</SectionHeading>
        <Group>
          <Row icon="lock" title="Change password" chevron onClick={() => setSheet('password')} />
          <Row icon="logOut" title="Sign out" danger iconColor="var(--red)" iconBg="rgba(255,90,90,0.12)" onClick={signOut} />
          <Row icon="trash" title="Delete account" sub="Permanently erase your account and data" danger iconColor="var(--red)" iconBg="rgba(255,90,90,0.12)" onClick={() => setSheet('delete')} style={{ borderBottom: 0 }} />
        </Group>

        <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12, padding: '28px 0 8px' }}>
          {BRAND.name} · {BRAND.tagline}
        </div>
      </div>

      <ProfileSheet open={sheet === 'profile'} onClose={() => setSheet(null)} user={user} onSaved={updateUser} />
      <BrokerageSheet open={sheet === 'brokerage'} onClose={() => setSheet(null)} workspace={workspace} onSaved={patchWs} />
      <AssistantSheet open={sheet === 'assistant'} onClose={() => setSheet(null)} user={user} onSaved={updateUser} />
      <PasswordSheet open={sheet === 'password'} onClose={() => setSheet(null)} />
      <DeleteAccountSheet open={sheet === 'delete'} onClose={() => setSheet(null)} onDeleted={logout} />
      <BlockedSheet open={sheet === 'blocked'} onClose={() => setSheet(null)} />
    </PushPanel>
  );
}

function ProfileSheet({ open, onClose, user, onSaved }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && user) setF({ firstName: user.firstName || '', lastName: user.lastName || '', title: user.title || '', phone: formatPhone(user.phone) || '', licenseNumber: user.licenseNumber || '' }); }, [open, user]);
  const save = async () => {
    setBusy(true);
    try {
      const { user: u } = await updateMe({ ...f, phone: f.phone || null });
      onSaved(u);
      toast.success('Profile saved');
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'phone' ? formatPhoneInput(e.target.value) : e.target.value }));
  return (
    <Sheet open={open} onClose={onClose} title="Profile" right={{ label: busy ? 'Saving…' : 'Save', onClick: save, disabled: busy || !f.firstName }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="km-field-row">
          <TextInput label="First name" value={f.firstName || ''} onChange={set('firstName')} />
          <TextInput label="Last name" value={f.lastName || ''} onChange={set('lastName')} />
        </div>
        <TextInput label="Title" value={f.title || ''} onChange={set('title')} placeholder="Luxury Real Estate Advisor" />
        <TextInput label="Mobile" value={f.phone || ''} onChange={set('phone')} inputMode="tel" />
        <TextInput label="License #" value={f.licenseNumber || ''} onChange={set('licenseNumber')} />
      </div>
    </Sheet>
  );
}

function BrokerageSheet({ open, onClose, workspace, onSaved }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && workspace) setF({ name: workspace.name || '', brokerageName: workspace.brokerageName || '', officeName: workspace.officeName || '', market: workspace.market || '', timezone: workspace.timezone || 'America/New_York' }); }, [open, workspace]);
  const save = async () => {
    setBusy(true);
    try {
      const { workspace: w } = await updateWorkspace(f);
      onSaved(w);
      toast.success('Saved');
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Sheet open={open} onClose={onClose} title="Brokerage" right={{ label: busy ? 'Saving…' : 'Save', onClick: save, disabled: busy }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextInput label="Book name" value={f.name || ''} onChange={set('name')} />
        <TextInput label="Brokerage" value={f.brokerageName || ''} onChange={set('brokerageName')} />
        <TextInput label="Office" value={f.officeName || ''} onChange={set('officeName')} />
        <TextInput label="Market" value={f.market || ''} onChange={set('market')} placeholder="Miami · South Florida" />
        <Select label="Time zone" value={f.timezone || ''} onChange={set('timezone')} options={TIMEZONES.map((t) => ({ value: t, label: t.replace('_', ' ') }))} />
      </div>
    </Sheet>
  );
}

function AssistantSheet({ open, onClose, user, onSaved }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const p = user?.aiPreferences || {};
    setName(p.aiName || '');
    setPreset(p.aiPersonalityId || null);
    setText(p.aiPersonality || '');
  }, [open, user]);
  const save = async () => {
    setBusy(true);
    try {
      const aiPreferences = { ...(user?.aiPreferences || {}), aiName: name.trim(), aiPersonalityId: preset, aiPersonality: text };
      await api.patch('/me/ai-preferences', aiPreferences).catch(async () => {
        // Fallback: store under preferences if the dedicated endpoint isn't there.
        await updateMe({ preferences: { aiPreferences } });
      });
      onSaved({ aiPreferences });
      toast.success(`${aiPreferences.aiName} updated`);
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Assistant" right={{ label: busy ? 'Saving…' : 'Save', onClick: save, disabled: busy || !name.trim() }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name your assistant" />
        <div className="km-field-label">How should {name || 'your assistant'} talk to you?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PERSONALITIES.map((p) => (
            <button key={p.id} type="button" className="km-press" onClick={() => { setPreset(preset === p.id ? null : p.id); setText(preset === p.id ? '' : p.text); }}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: `1px solid ${preset === p.id ? 'rgba(46,139,255,0.45)' : 'var(--line)'}`, background: preset === p.id ? 'var(--tint)' : 'var(--surfaceHi)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>{p.label}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--dim)', marginTop: 2 }}>{p.sub}</span>
              </span>
              {preset === p.id ? <Icon name="checkCircle" size={20} color="var(--bright)" /> : null}
            </button>
          ))}
        </div>
        <TextArea label="In your words" rows={5} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); setPreset(null); }} hint="A sentence or two is plenty." />
      </div>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCur(''); setNext(''); } }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/me/password', { currentPassword: cur, newPassword: next });
      toast.success('Password changed');
      onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Change password" right={{ label: 'Save', onClick: save, disabled: busy || next.length < 8 || !cur }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextInput type="password" label="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        <TextInput type="password" label="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="At least 8 characters" />
      </div>
    </Sheet>
  );
}

// Permanent account deletion (required for App Store apps that offer sign-up).
function DeleteAccountSheet({ open, onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setPassword(''); }, [open]);
  const erase = async () => {
    if (!(await confirm({ title: 'Delete your account?', message: 'Your clients, conversations, deals and files are erased for good. This can’t be undone.', confirmLabel: 'Delete forever', destructive: true }))) return;
    setBusy(true);
    try {
      await api.del('/me', { password });
      toast.success('Your account was deleted');
      onClose();
      await onDeleted();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Delete account">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.5 }}>
          Deleting your account permanently erases your profile, clients, conversations, deals, listings and uploaded files.
          If teammates share your workspace, only your login is removed.
        </div>
        <TextInput type="password" label="Confirm with your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <Button variant="danger" size="lg" block onClick={erase} loading={busy} disabled={!password}>Delete my account</Button>
      </div>
    </Sheet>
  );
}

function BlockedSheet({ open, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get('/clients', { blocked: 1, limit: 200 }).then((r) => setRows((r.clients || []).filter((c) => c.blocked))).catch(() => setRows([]));
  }, [open]);
  const unblock = async (c) => {
    setRows((xs) => xs.filter((x) => x.id !== c.id));
    try { await api.patch(`/clients/${c.id}`, { blocked: false }); toast.success(`${fullName(c)} unblocked`); } catch (e) { toast.error(e.message); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Blocked" left={false} right={{ label: 'Done', onClick: onClose }}>
      {rows === null ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div> : rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--faint)', padding: '28px 0' }}>No blocked contacts.</div>
      ) : rows.map((c) => (
        <div key={c.id} className="km-row">
          <Avatar name={fullName(c)} seed={c.id} size={36} />
          <span style={{ flex: 1, minWidth: 0 }} className="km-truncate">{fullName(c)}</span>
          <Button variant="ghost" size="sm" onClick={() => unblock(c)}>Unblock</Button>
        </div>
      ))}
    </Sheet>
  );
}

function HiddenContactsRow() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get('/battle-plan/suppressions').then((r) => setRows(r.suppressions || [])).catch(() => setRows([]));
  }, [open]);
  const remove = async (s) => {
    setRows((xs) => xs.filter((x) => x.id !== s.id));
    try { await api.del(`/battle-plan/suppressions/${s.id}`); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <Row icon="eyeOff" title="Hidden from the Battle Plan" sub="Contacts and move types the AI was told to skip" chevron onClick={() => setOpen(true)} style={{ borderBottom: 0 }} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Hidden contacts" left={false} right={{ label: 'Done', onClick: () => setOpen(false) }}>
        {rows === null ? <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div> : rows.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--faint)', padding: '28px 0' }}>Nothing hidden. The planner can suggest anyone.</div>
        ) : rows.map((s) => (
          <div key={s.id} className="km-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600 }}>{s.clientName || s.signalKind || 'Hidden'}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{s.reason || 'Muted'} · until {formatDate(s.expiresAt, { month: 'short', day: 'numeric' })}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => remove(s)}>Un-hide</Button>
          </div>
        ))}
      </Sheet>
    </>
  );
}

function PushPermissionHint() {
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  if (perm === 'granted' || perm === 'unsupported') return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 4px 0', fontSize: 12.5, color: 'var(--faint)' }}>
      <span>Allow browser notifications to get alerts when {BRAND.name} isn’t open.</span>
      <Button variant="ghost" size="sm" onClick={async () => { try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ } }}>Allow</Button>
    </div>
  );
}

// Messaging provider status (GET /api/bridge → {provider, twilio}). iMessage
// bridge pairing is intentionally not part of this build — status only.
function MessagingLine() {
  const [state, setState] = useState(null);
  useEffect(() => { api.get('/bridge').then(setState).catch(() => setState({ provider: 'demo' })); }, []);
  // Per-workspace transport (server: services/messaging/mode.js).
  const mode = state?.messaging?.mode || state?.provider || 'demo';
  const sub = !state ? 'Checking…'
    : mode === 'twilio' ? 'Twilio connected — texts and calls go out from your business line'
      : mode === 'demo' ? 'Demo mode — messages are simulated'
        : mode === 'device' ? 'Your phone’s Messages app — texts open Messages to send; connect a business line (Twilio) to text from KeyMatch'
          : 'Not configured';
  return (
    <Group>
      <Row icon="message" iconColor="var(--sms)" iconBg="rgba(52,209,91,0.14)" title="SMS & calling" sub={sub} style={{ borderBottom: 0 }} />
    </Group>
  );
}
