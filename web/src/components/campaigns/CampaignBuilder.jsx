// CampaignBuilder — the campaign wizard (RevMatch CampaignBuilder, 5 steps):
//   1 Audience · 2 Message · 3 Event · 4 Replies · 5 Review → "Launch · N".
// Full-height push panel with its own bottom CTA bar (the floating tab bar
// steps aside while it's open). Every edit autosaves to the draft row, and the
// step rides along, so a reopened draft resumes where the agent left off.
// "Launch · N" is the campaign-level approval for every text it sends; each
// text is still drafted per person at send time and passes the Sender Guard.
// Overlay contract: receives { prefill, overlayId, onClose }.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PushPanel, { usePanel } from '../ui/PushPanel';
import PageHeader from '../ui/PageHeader';
import GlassButton from '../ui/GlassButton';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import PropertyPhoto from '../ui/PropertyPhoto';
import { Switch, Spinner, Button } from '../ui/kit';
import { toast, confirm } from '../ui/toast';
import { nav } from '../../lib/nav';
import { haptic } from '../../lib/native';
import { moneyCompact } from '../../lib/format';
import { mediaUrl } from '../../api/client';
import {
  createCampaign, getCampaign, updateCampaign, deleteCampaign, previewAudience, audienceOptions,
  resolveAudienceText, sampleDrafts, planLaunch, launchCampaign, getTemplates, getInvite,
} from '../../api/campaigns';
import { Eyebrow, InfoNote, MonoLabel, ComposerField, SparkButton, Choice, LaneDot, NeedsLineBanner, toLocalInput } from './kit';
import { useMessagingMode } from './useCampaignsData';
import { fmtTz, inputIso, useCampaignTz, zonedIso } from './tz';
import AudienceBuilder from './AudienceBuilder';
import TrafficLanes, { normalizeLanes } from './TrafficLanes';
import ListingPicker from './ListingPicker';
import { tone } from '../../lib/palette';

const STEPS = ['Audience', 'Message', 'Event', 'Replies', 'Review'];
const ROUTING_NOTE = 'Campaign texts stay out of your inbox. The first time someone replies, their thread moves to your inbox and the conversation is yours.';
const creating = new Map(); // overlayId → promise (StrictMode double-mount safe)

function Stepper({ stage, maxStage, onJump }) {
  return (
    <div className="kp-stepper" role="tablist" aria-label="Campaign steps">
      {STEPS.map((label, i) => {
        const done = i < stage;
        const active = i === stage;
        const reachable = i <= maxStage || i < stage;
        return (
          <span key={label} style={{ display: 'contents' }}>
            {i > 0 ? <span className={`kp-step-line ${i <= stage ? 'kp-step-line--on' : ''}`} /> : null}
            <button type="button" role="tab" aria-selected={active} disabled={!reachable} onClick={() => reachable && onJump(i)}
              className={`kp-step ${active ? 'kp-step--active' : ''} ${done ? 'kp-step--done' : ''}`}>
              <span className="kp-step-num">{done ? <Icon name="check" size={12} stroke={2.6} /> : i + 1}</span>
              {active ? <span className="kp-step-label">{label}</span> : null}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function splitLocal(iso) {
  if (!iso) return { date: '', time: '' };
  const v = toLocalInput(iso);
  return { date: v.slice(0, 10), time: v.slice(11, 16) };
}
// Event + schedule inputs are wall clock in the agent's zone (tz.js).
function joinLocal(date, time) {
  return zonedIso(date, time);
}
function fmtEvent(ev) {
  if (!ev || !ev.startAt) return '';
  const day = fmtTz(ev.startAt, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d) => fmtTz(d, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  return `${day} · ${t(ev.startAt)}${ev.endAt ? `-${t(ev.endAt)}` : ''}`;
}

function useDebouncedSave(fn, ms) {
  const t = useRef(null);
  const f = useRef(fn);
  f.current = fn;
  const pending = useRef(null);
  const flush = useCallback(() => { if (pending.current) { clearTimeout(t.current); const a = pending.current; pending.current = null; f.current(a); } }, []);
  const call = useCallback((arg) => { pending.current = arg; clearTimeout(t.current); t.current = setTimeout(flush, ms); }, [ms, flush]);
  useEffect(() => () => { flush(); }, [flush]);
  return [call, flush];
}

export default function CampaignBuilder({ prefill = {}, overlayId, onClose }) {
  useCampaignTz();
  const needsLine = useMessagingMode() === 'device';
  const [campaign, setCampaign] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [stage, setStage] = useState(0);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [options, setOptions] = useState(null);
  const [findText, setFindText] = useState('');
  const [finding, setFinding] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [trigger, setTrigger] = useState('custom');
  const [brief, setBrief] = useState('');
  const [listing, setListing] = useState(null);
  const [includePhoto, setIncludePhoto] = useState(false);
  const [pickListing, setPickListing] = useState(false);
  const [samples, setSamples] = useState([]);
  const [writing, setWriting] = useState(false);
  const [samplesStale, setSamplesStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [event, setEvent] = useState({ enabled: false, title: '', address: '', date: '', start: '', end: '', rsvp: true, calendarInvite: true });
  const [invite, setInvite] = useState(null);
  const [lanes, setLanes] = useState(normalizeLanes(null));
  const [pacing, setPacing] = useState('safe');
  const [startMode, setStartMode] = useState('now');
  const [startLocal, setStartLocal] = useState('');
  const [endMode, setEndMode] = useState('open');
  const [endLocal, setEndLocal] = useState('');
  const [plan, setPlan] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(null);
  const briefTouched = useRef(false);
  const nameTouched = useRef(false);
  const scrollRef = useRef(null);
  const latest = useRef({});
  const id = campaign && campaign.id;

  // Hide the floating tab bar while the builder owns the bottom edge.
  useEffect(() => {
    document.body.classList.add('km-tabbar-hidden', 'kp-builder-open');
    return () => document.body.classList.remove('km-tabbar-hidden', 'kp-builder-open');
  }, []);

  const hydrate = useCallback((c, { full = true } = {}) => {
    setCampaign(c);
    if (!full) return;
    setName(c.name && c.name !== 'New campaign' ? c.name : '');
    setAudience(c.audience || {});
    setFindText((c.audience && c.audience.text) || '');
    setTrigger(c.trigger || 'custom');
    setBrief(c.brief || '');
    setListing(c.listing || null);
    setIncludePhoto(!!c.includePhoto);
    const ev = c.event || null;
    const s = splitLocal(ev && ev.startAt);
    const e = splitLocal(ev && ev.endAt);
    setEvent({ enabled: !!(ev && ev.enabled !== false), title: (ev && ev.title) || '', address: (ev && ev.address) || '', date: s.date, start: s.time, end: e.time, rsvp: !ev || ev.rsvp !== false, calendarInvite: !ev || ev.calendarInvite !== false });
    setLanes(normalizeLanes(c.lanes));
    setPacing(c.pacing === 'all_now' ? 'all_now' : 'safe');
    if (c.schedule && c.schedule.startAt && new Date(c.schedule.startAt) > new Date()) { setStartMode('at'); setStartLocal(toLocalInput(c.schedule.startAt)); }
    if (c.schedule && c.schedule.endAt) { setEndMode('at'); setEndLocal(toLocalInput(c.schedule.endAt)); }
    const b = c.builder || {};
    if (Array.isArray(b.samples) && b.samples.length) setSamples(b.samples);
    if (Number.isInteger(b.stage) && b.stage > 0) setStage(Math.min(4, b.stage));
  }, []);

  // Load or create the draft.
  useEffect(() => {
    let alive = true;
    const key = overlayId || 'builder';
    let p = creating.get(key);
    if (!p) {
      p = prefill.campaignId
        ? getCampaign(prefill.campaignId).then((d) => d.campaign)
        : createCampaign({ trigger: prefill.template, listingId: prefill.listingId, clientIds: prefill.clientIds, name: prefill.name, brief: prefill.brief, audience: prefill.audience }).then((d) => d.campaign);
      creating.set(key, p);
      p.finally(() => setTimeout(() => creating.delete(key), 3000));
    }
    p.then((c) => {
      if (!alive) return;
      if (c.status !== 'draft') { nav.open('campaign', { id: c.id }, { replaceTop: true }); return; }
      hydrate(c);
    }).catch((e) => alive && setLoadError(e));
    audienceOptions().then((o) => alive && setOptions(o)).catch(() => {});
    getTemplates().then((d) => alive && setTemplates(d.templates || [])).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every save is tracked so reads that depend on the server's copy (previews,
  // the launch plan, launch itself) wait for in-flight saves first.
  const inflight = useRef(new Set());
  const persist = useCallback((patch) => {
    if (!latest.current.id) return Promise.resolve(null);
    const p = updateCampaign(latest.current.id, patch).then((d) => d && d.campaign).catch((e) => { if (e.status !== 404) toast.error(e.message || 'Could not save'); return null; });
    inflight.current.add(p);
    p.then(() => inflight.current.delete(p));
    return p;
  }, []);
  const settled = () => Promise.allSettled([...inflight.current]);

  // Live audience preview + autosave.
  const [saveAudience, flushAudience] = useDebouncedSave((a) => persist({ audience: a }), 700);
  const audKey = JSON.stringify(audience);
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setPreviewLoading(true);
    const t = setTimeout(() => {
      previewAudience(audience, 400)
        .then((r) => { if (alive) setPreview(r); })
        .catch(() => {})
        .finally(() => alive && setPreviewLoading(false));
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [id, audKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAudience = (a) => { setAudience(a); saveAudience(a); setSamples([]); };
  const [saveBrief, flushBrief] = useDebouncedSave((b) => persist({ brief: b }), 900);
  const [saveLanes, flushLanes] = useDebouncedSave((l) => persist({ lanes: l }), 700);
  const [saveEvent, flushEvent] = useDebouncedSave((ev) => persist({ event: ev }), 700);
  const [saveName, flushName] = useDebouncedSave((n) => persist({ name: n.trim() || 'New campaign' }), 900);

  const eventPayload = (ev) => (ev.enabled ? {
    enabled: true, title: ev.title || null, address: ev.address || null,
    startAt: joinLocal(ev.date, ev.start), endAt: ev.end ? joinLocal(ev.date, ev.end) : null, rsvp: ev.rsvp, calendarInvite: ev.calendarInvite,
  } : null);
  const onEvent = (patch) => {
    setEvent((prev) => {
      const next = { ...prev, ...patch };
      saveEvent(eventPayload(next));
      return next;
    });
    setInvite(null);
    setSamplesStale(true);
  };

  const count = (preview && preview.count) || 0;
  const eventValid = !event.enabled || (event.date && event.start);
  const needsEvent = trigger === 'open_house_invite';
  const maxStage = !count ? 0 : !samples.length ? 1 : !eventValid || (needsEvent && !event.enabled) ? 2 : 4;
  latest.current = { id, name, brief, count, campaign };

  // Empty drafts don't linger: closing a builder that never got an audience
  // or a message deletes its draft.
  useEffect(() => () => {
    const L = latest.current;
    if (!L.id || L.launched) return;
    const c = L.campaign || {};
    const a = c.audience || {};
    const empty = !L.brief.trim() && !L.name.trim() && !L.count && !(a.groups || []).length;
    if (empty && c.status === 'draft' && !prefill.campaignId) deleteCampaign(L.id).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flushAll = () => { flushAudience(); flushBrief(); flushLanes(); flushEvent(); flushName(); };

  const hop = (i) => {
    flushAll();
    setStage(i);
    persist({ builder: { stage: i } });
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goto = (i) => { if (i <= maxStage) hop(i); };
  const back = () => { if (stage > 0) hop(stage - 1); };

  // ── Message ──
  const applyTemplate = async (key) => {
    if (key === trigger) return;
    if (briefTouched.current && brief.trim() && key !== 'custom') {
      const ok = await confirm({ title: 'Replace your message?', message: 'The template fills in a new message and reply plan. You can edit everything after.', confirmLabel: 'Use template' });
      if (!ok) return;
    }
    setTrigger(key);
    flushAll();
    const c = await persist({ applyTemplate: key });
    if (c) {
      hydrate(c, { full: false });
      setBrief(c.brief || '');
      setLanes(normalizeLanes(c.lanes));
      const ev = c.event;
      if (ev && ev.enabled) setEvent((prev) => ({ ...prev, enabled: true, title: prev.title || ev.title || '', address: prev.address || ev.address || '' }));
      if ((!nameTouched.current || !name.trim()) && c.name && c.name !== 'New campaign') setName(c.name);
      briefTouched.current = false;
      setSamples([]);
    }
  };

  const attachListing = async (l) => {
    flushAll();
    const c = await persist({ listingId: l ? l.id : null, ...(l && !briefTouched.current && trigger !== 'custom' ? { applyTemplate: trigger } : {}) });
    if (c) {
      setListing(c.listing || null);
      setIncludePhoto(!!c.includePhoto);
      if (!briefTouched.current) setBrief(c.brief || brief);
      if (!nameTouched.current && c.name && c.name !== 'New campaign') setName(c.name);
      if (c.event && c.event.enabled) setEvent((prev) => ({ ...prev, title: prev.title || c.event.title || '', address: prev.address || c.event.address || '' }));
      setCampaign(c);
      setSamples([]);
    }
  };

  const preview3 = async () => {
    if (!brief.trim() || writing || !id) return;
    flushAll();
    setWriting(true);
    try {
      await settled();
      const r = await sampleDrafts(id, { brief, attempt });
      setSamples(r.samples || []);
      setSamplesStale(false);
      setAttempt((n) => n + 1);
    } catch (e) {
      toast.error(e.message || 'Could not write previews');
    } finally {
      setWriting(false);
    }
  };

  // ── Review ──
  useEffect(() => {
    if (stage !== 4 || !id) return;
    flushAll();
    setPlan(null);
    settled().then(() => planLaunch(id, { pacing })).then(setPlan).catch(() => setPlan({ error: true }));
    if (samplesStale && brief.trim()) preview3();
    if (event.enabled && event.calendarInvite && event.date && event.start) settled().then(() => getInvite(id)).then(setInvite).catch(() => {});
  }, [stage, id, pacing]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardInfo = plan && plan.guard;
  const allNowAllowed = !!(guardInfo && count <= 5 && guardInfo.newCount === 0);
  const startAtIso = startMode === 'at' && startLocal ? inputIso(startLocal) : null;
  const endAtIso = endMode === 'at' && endLocal ? inputIso(endLocal) : null;

  const doLaunch = async () => {
    if (launching || !id) return;
    if (startMode === 'at' && (!startAtIso || new Date(startAtIso).getTime() < Date.now() + 4 * 60000)) { toast.error('Pick a start time at least 5 minutes from now'); return; }
    if (endMode === 'at' && !endLocal) { toast.error('Pick the finish-by time, or choose Run until done'); return; }
    if (endAtIso && new Date(endAtIso) <= new Date(startAtIso || Date.now())) { toast.error('The finish-by time has to be after the start'); return; }
    setLaunching(true);
    flushAll();
    try {
      await settled();
      await updateCampaign(id, { name: name.trim() || (campaign && campaign.name) || 'Campaign', brief, lanes, pacing: allNowAllowed ? pacing : 'safe', event: eventPayload(event) });
      const r = await launchCampaign(id, { startAt: startAtIso, endAt: endAtIso });
      latest.current.launched = true;
      haptic('success');
      setLaunched(r);
    } catch (e) {
      toast.error(e.message || 'Could not launch');
      if (/event/i.test(e.message || '')) hop(2);
    } finally {
      setLaunching(false);
    }
  };

  const viewCampaign = () => {
    nav.openCampaign(id);
    setTimeout(() => nav.close(overlayId), 460);
  };

  const saveAndClose = (requestClose) => {
    flushAll();
    persist({ name: name.trim() || 'New campaign' });
    toast('Saved to Drafts');
    requestClose();
  };

  // ── Footer CTA ──
  let cta = 'Continue';
  let ctaDisabled = false;
  let ctaAction = () => goto(stage + 1);
  if (stage === 0) { cta = `Continue · ${count}`; ctaDisabled = !count; }
  if (stage === 1 && !samples.length) { cta = writing ? 'Writing previews…' : 'Preview the texts'; ctaDisabled = !brief.trim() || writing; ctaAction = preview3; }
  if (stage === 2 && !eventValid) { cta = 'Add the date and start time'; ctaDisabled = true; }
  if (stage === 2 && needsEvent && !event.enabled) { cta = 'Turn on the event'; ctaDisabled = true; }
  if (stage === 4) { cta = launching ? 'Launching…' : `${startMode === 'at' ? 'Schedule' : 'Launch'} · ${count}`; ctaDisabled = launching || !count; ctaAction = doLaunch; }
  // No business texting line ('device' mode): launching is off, saving the
  // draft is the way out of the last step.
  const saveDraftCta = stage === 4 && needsLine;

  const tpl = templates.find((t) => t.key === trigger);
  const laneSummary = (k) => {
    const l = lanes[k] || {};
    if (l.enabled === false) return k === 'red' ? 'Off · they just stop hearing from you' : k === 'gray' ? 'Off · silence ends it' : 'Off';
    if (k === 'gray') return String(l.text || '').trim() ? `Quiet for ${(l.timerText || '2 days').toLowerCase()}: one nudge` : 'No nudge';
    const steps = Array.isArray(l.steps) ? l.steps : [];
    return steps.length ? `${steps.length} text${steps.length === 1 ? '' : 's'}: ${steps.map((s) => String(s.label || '').toLowerCase().replace(/\s*·\s*/g, ' at ')).join(', ')}` : 'No follow-up';
  };

  const header = ({ requestClose }) => (
    <PageHeader
      title={name.trim() || (campaign ? (campaign.name !== 'New campaign' ? campaign.name : 'New campaign') : 'New campaign')}
      left={<GlassButton icon="x" label="Close" onClick={() => saveAndClose(requestClose)} />}
      right={campaign ? <button type="button" className="km-lg km-press" onClick={() => saveAndClose(requestClose)} style={{ height: 40, padding: '0 15px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, color: 'var(--lg-text)' }}>Save</button> : null}
    >
      <Stepper stage={stage} maxStage={maxStage} onJump={(i) => (i < stage ? hop(i) : goto(i))} />
    </PageHeader>
  );

  return (
    <PushPanel onClose={onClose} header={false} scroll={false}>
      <BuilderBody
        header={header}
        loadError={loadError}
        campaign={campaign}
        scrollRef={scrollRef}
        footer={({ requestClose }) => (
          <div className="kp-footer" style={{ bottom: 'var(--keyboard-height)' }}>
            {stage > 0 ? <button type="button" className="kp-circle km-press" onClick={back} aria-label="Back a step"><Icon name="chevronLeft" size={20} /></button> : null}
            {saveDraftCta ? (
              <Button size="lg" block variant="ghost" icon="check" onClick={() => saveAndClose(requestClose)} style={{ flex: 1 }}>Save draft</Button>
            ) : (
              <Button size="lg" block onClick={ctaAction} disabled={ctaDisabled} loading={launching || (stage === 1 && writing && !samples.length)} style={{ flex: 1 }}>{cta}</Button>
            )}
          </div>
        )}
      >
        {stage === 0 ? (
          <AudienceBuilder
            name={name}
            onName={(v) => { nameTouched.current = true; setName(v); saveName(v); }}
            audience={audience}
            onChange={onAudience}
            options={options}
            preview={preview}
            previewLoading={previewLoading}
            findText={findText}
            onFindText={setFindText}
            finding={finding}
            onFind={async () => {
              if (!findText.trim() || finding) return;
              setFinding(true);
              try {
                const r = await resolveAudienceText(findText);
                onAudience({ ...r.audience, excludedIds: audience.excludedIds || [] });
                toast.success(r.summary ? `Found: ${r.summary}` : 'Audience updated');
              } catch (e) {
                toast.error(e.message || 'Could not read that');
              } finally {
                setFinding(false);
              }
            }}
          />
        ) : null}

        {stage === 1 ? (
          <div>
            <Eyebrow blue icon="layers">Start from</Eyebrow>
            <div className="km-scroll-x" style={{ display: 'flex', gap: 8, margin: '10px -16px 0', padding: '2px 16px 4px', scrollSnapType: 'x mandatory', scrollPaddingInline: 16 }}>
              {templates.map((t) => (
                <button key={t.key} type="button" className="kp-tpl km-press" aria-pressed={trigger === t.key} onClick={() => applyTemplate(t.key)} style={{ '--kp-accent': tone(t.accent, 'var(--text)') }}>
                  <span className="kp-tpl-icon"><Icon name={t.icon} size={15} stroke={2} /></span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, marginTop: 9 }}>{t.label}</span>
                  <span className="km-clamp-2" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2, lineHeight: 1.3 }}>{t.sub}</span>
                </button>
              ))}
            </div>

            <Eyebrow blue icon="send" style={{ marginTop: 20 }}>What to say, in your words</Eyebrow>
            <ComposerField
              style={{ marginTop: 10 }}
              rows={4}
              value={brief}
              onChange={(v) => { briefTouched.current = true; setBrief(v); saveBrief(v); setSamples([]); }}
              placeholder={'Tell your AI the gist: "Just listed 3550 Main Hwy, offer a private showing before the weekend"'}
              action={<SparkButton label={writing ? 'Writing…' : samples.length ? 'Rewrite' : 'Preview'} disabled={!brief.trim()} busy={writing} onClick={preview3} />}
            />
            <InfoNote style={{ marginTop: 10 }}>Your AI writes each person their own text at send time, in your voice, from what it knows about them. No two are identical.</InfoNote>

            <Eyebrow icon="house" style={{ marginTop: 22 }}>Listing</Eyebrow>
            {listing ? (
              <div className="kp-section kp-step-in" style={{ marginTop: 10, padding: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <PropertyPhoto src={listing.photo} seed={listing.id} height={62} radius={12} style={{ width: 84, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="km-truncate" style={{ fontSize: 14.5, fontWeight: 500 }}>{listing.address}</div>
                    <div className="km-truncate" style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 2 }}>{[listing.price ? moneyCompact(listing.price) : null, listing.specs].filter(Boolean).join(' · ')}</div>
                    <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{[listing.neighborhood, listing.offMarket ? 'Off-market: address never shared' : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button type="button" className="km-pill km-press" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => setPickListing(true)}>Change</button>
                    <button type="button" className="km-pill km-press" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => attachListing(null)}>Remove</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14 }}>Send the photo with the first text</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)', marginTop: 1 }}>{listing.photo ? 'Skipped for people who have never replied to you' : 'This listing has no photo yet'}</span>
                  </span>
                  <Switch checked={includePhoto && !!listing.photo} disabled={!listing.photo} onChange={(v) => { setIncludePhoto(v); persist({ includePhoto: v }); }} label="Send listing photo" />
                </div>
              </div>
            ) : (
              <button type="button" className="km-press" onClick={() => setPickListing(true)} style={{ marginTop: 10, width: '100%', height: 46, borderRadius: 12, border: '1px dashed var(--lineHi)', color: 'var(--dim)', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Icon name="plus" size={15} /> Attach a listing{tpl && tpl.needsListing ? ' (recommended)' : ''}
              </button>
            )}

            <Eyebrow icon="eye" style={{ marginTop: 22 }} right={samples.length ? <button type="button" onClick={preview3} disabled={writing} style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--bright)', letterSpacing: 0, textTransform: 'none' }}>Regenerate</button> : null}>Previews</Eyebrow>
            {writing && !samples.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>{[0, 1, 2].map((i) => <div key={i} className="kp-skel-bubble" style={{ animationDelay: `${i * 120}ms` }} />)}</div>
            ) : samples.length ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12.5, color: 'var(--faint)', margin: '4px 0 2px' }}>{samples.length} of your {count}, each written individually at send time.</div>
                {samples.every((x) => x.via !== 'ai') ? (
                  <InfoNote kind="warn" style={{ marginTop: 10 }}>
                    {trigger === 'custom'
                      ? 'AI writing is off right now, so each text follows your words closely. Write the message the way you would text one person.'
                      : 'AI writing is off right now, so texts use a personalized template with your listing, event and any lines you wrote as copy.'}
                  </InfoNote>
                ) : null}
                {samples.map((s, i) => (
                  <div key={s.clientId} className="kp-step-in" style={{ marginTop: 14, animationDelay: `${i * 90}ms`, opacity: writing ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar name={s.name} seed={s.clientId} src={s.avatarUrl} size={26} />
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.name}</span>
                      <span className="kp-chan" style={{ color: s.channel === 'sms' ? 'var(--sms)' : 'var(--imsg)', border: `1px solid color-mix(in srgb, ${s.channel === 'sms' ? 'var(--sms)' : 'var(--imsg)'} 35%, transparent)` }}>{s.channel === 'sms' ? 'SMS' : 'iMESSAGE'}</span>
                      {s.cold ? <span className="kp-mono" style={{ fontSize: 8.5 }}>New to you</span> : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 8 }}>
                      {s.photo ? <PropertyPhoto src={s.photo} seed={listing && listing.id} height={96} radius={14} style={{ width: 150, marginBottom: 5 }} /> : null}
                      <div className={`kp-bubble km-selectable ${s.channel === 'sms' ? 'kp-bubble--sms' : ''}`}>{s.text}</div>
                      <MonoLabel style={{ marginTop: 5 }}>{s.via === 'ai' ? 'Written by your AI' : 'Template, personalized'}{s.citations && s.citations.length ? ` · drew on ${s.citations.join(', ')}` : ''}</MonoLabel>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 8 }}>Tap Preview to see texts written for three real people on your list. Nothing is sent.</div>
            )}
          </div>
        ) : null}

        {stage === 2 ? (
          <div>
            <div className="kp-section" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="kp-auto-tile" style={{ '--kp-accent': 'var(--dim)' }}><Icon name="calendar" size={17} stroke={2} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>This campaign has an event</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--faint)', marginTop: 1 }}>Open house, broker caravan, client event</span>
              </span>
              <Switch checked={event.enabled} onChange={(v) => onEvent({ enabled: v })} label="Has an event" />
            </div>
            {needsEvent && !event.enabled ? <InfoNote kind="warn" style={{ marginTop: 10 }}>Open house invites need the date and time: the reminders and RSVP follow-ups anchor to it.</InfoNote> : null}
            {event.enabled ? (
              <div className="kp-step-in">
                <Eyebrow blue icon="door" style={{ marginTop: 20 }}>The event</Eyebrow>
                <input className="kp-input" style={{ marginTop: 10 }} value={event.title} onChange={(e) => onEvent({ title: e.target.value.slice(0, 120) })} placeholder="Title, e.g. Open House · 3550 Main Hwy" aria-label="Event title" />
                <input className="kp-input" style={{ marginTop: 8 }} value={event.address} onChange={(e) => onEvent({ address: e.target.value.slice(0, 200) })} placeholder="Where: full address" aria-label="Event address" />
                <label style={{ display: 'block', marginTop: 10 }}><MonoLabel style={{ margin: '0 0 5px 2px' }}>Date</MonoLabel><input className="kp-input" type="date" value={event.date} min={toLocalInput(new Date()).slice(0, 10)} onChange={(e) => onEvent({ date: e.target.value })} aria-label="Event date" /></label>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8, marginTop: 8 }}>
                  <label style={{ minWidth: 0 }}><MonoLabel style={{ margin: '0 0 5px 2px' }}>Starts</MonoLabel><input className="kp-input" type="time" value={event.start} onChange={(e) => onEvent({ start: e.target.value })} aria-label="Start time" /></label>
                  <label style={{ minWidth: 0 }}><MonoLabel style={{ margin: '0 0 5px 2px' }}>Ends</MonoLabel><input className="kp-input" type="time" value={event.end} onChange={(e) => onEvent({ end: e.target.value })} aria-label="End time" /></label>
                </div>
                <div className="kp-list" style={{ marginTop: 12 }}>
                  <div className="kp-li">
                    <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 14.5 }}>Ask them to RSVP</span><span style={{ display: 'block', fontSize: 12, color: 'var(--faint)', marginTop: 1 }}>A yes puts them in the green lane for reminders</span></span>
                    <Switch checked={event.rsvp} onChange={(v) => onEvent({ rsvp: v })} label="RSVP" />
                  </div>
                  <div className="kp-li">
                    <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 14.5 }}>Text a calendar invite</span><span style={{ display: 'block', fontSize: 12, color: 'var(--faint)', marginTop: 1 }}>A .ics file rides the announcement. One tap adds it to their calendar.</span></span>
                    <Switch checked={event.calendarInvite} onChange={(v) => onEvent({ calendarInvite: v })} label="Calendar invite" />
                  </div>
                </div>
                <MonoLabel style={{ marginTop: 10 }}>Reminders anchor to this time · nothing sends after it · no invite file to people who never replied to you</MonoLabel>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 12 }}>No event? Skip this step. Follow-ups will time off each reply instead.</div>
            )}
          </div>
        ) : null}

        {stage === 3 ? (
          <div>
            <Eyebrow blue icon="reply">When they reply</Eyebrow>
            <InfoNote style={{ margin: '12px 0 14px' }}>Your AI reads every reply and sorts it into a lane. Explain what you want per lane, including when they never respond. Anything off topic is left to you.</InfoNote>
            <TrafficLanes value={lanes} onChange={(l) => { setLanes(l); saveLanes(l); }} hasEvent={event.enabled && !!event.date} />
            <InfoNote kind="route" style={{ marginTop: 14 }}>Every reply still lands in your inbox the first time. Lanes only automate the follow-up texts, and the AI never sends a conversational answer without your tap.</InfoNote>
          </div>
        ) : null}

        {stage === 4 ? (
          <div>
            {needsLine ? <NeedsLineBanner style={{ marginBottom: 14 }} /> : null}
            <Eyebrow blue icon="checkCircle">{needsLine ? 'Review' : 'Review & launch'}</Eyebrow>
            <SummaryCard icon="users" title={`${count} recipient${count === 1 ? '' : 's'}`} onEdit={() => hop(0)}>
              <span>{(preview && preview.summary) || 'Custom list'}{preview && preview.excluded && preview.excluded.manual ? ` · ${preview.excluded.manual} excluded` : ''}</span>
            </SummaryCard>
            <SummaryCard icon="send" title={`Message${listing ? ' · listing attached' : ''}`} onEdit={() => hop(1)}>
              <span style={{ fontStyle: 'italic' }}>“{brief.slice(0, 110)}{brief.length > 110 ? '…' : ''}”</span>
              {samples[0] ? (
                <span style={{ display: 'block', marginTop: 9 }}>
                  <span className="kp-bubble" style={{ display: 'inline-block', fontSize: 13.5, maxWidth: '96%', fontStyle: 'normal' }}>{samples[0].text}</span>
                  <MonoLabel style={{ marginTop: 4 }}>Sample · {samples[0].name}</MonoLabel>
                </span>
              ) : null}
            </SummaryCard>
            {event.enabled ? (
              <SummaryCard icon="calendar" title={event.title || 'Event'} onEdit={() => hop(2)}>
                <span>{[fmtEvent(eventPayload(event)), event.address, event.rsvp ? 'RSVP' : null, event.calendarInvite ? '.ics invite' : null].filter(Boolean).join(' · ')}</span>
                {invite ? <a href={mediaUrl(invite.url)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12.5, color: 'var(--bright)', fontStyle: 'normal' }}><Icon name="download" size={12} />Preview the invite</a> : null}
              </SummaryCard>
            ) : null}
            <SummaryCard icon="reply" title="After they reply" onEdit={() => hop(3)}>
              {['green', 'yellow', 'red', 'gray'].map((k) => (
                <span key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 4 }}>
                  <LaneDot lane={k} size={7} style={{ position: 'relative', top: -1 }} />
                  <span style={{ minWidth: 0 }}>{laneSummary(k)}</span>
                </span>
              ))}
              <span style={{ display: 'block', marginTop: 6, color: lanes.aiReply && lanes.aiReply.mode === 'draft' ? 'var(--bright)' : 'var(--faint)' }}>
                {lanes.aiReply && lanes.aiReply.mode === 'draft' ? 'Questions get an AI-drafted answer for your OK' : 'Questions come straight to you'}
              </span>
            </SummaryCard>

            <MonoLabel style={{ margin: '20px 2px 8px' }}>How it sends</MonoLabel>
            <Choice value={allNowAllowed ? pacing : 'safe'} onChange={(v) => { setPacing(v); persist({ pacing: v }); }} options={[{ id: 'safe', label: 'Safe pace' }, { id: 'all_now', label: 'All now', disabled: !allNowAllowed }]} />
            <div style={{ display: 'flex', gap: 7, marginTop: 8, fontSize: 12, color: 'var(--faint)', lineHeight: 1.45 }}>
              <Icon name="clock" size={13} style={{ marginTop: 1 }} />
              <span>{allNowAllowed ? 'All now sends at once to people who already text with you.' : 'Safe pace: 1-3 min apart for people who text with you, 5-15 min apart and a capped number a day for new conversations, 9 AM to 8 PM their time. All now is only for 5 or fewer people who already text with you.'}</span>
            </div>

            <MonoLabel style={{ margin: '20px 2px 8px' }}>When it runs</MonoLabel>
            <Choice value={startMode} onChange={setStartMode} options={[{ id: 'now', label: 'Start now' }, { id: 'at', label: 'Schedule' }]} />
            {startMode === 'at' ? <input className="kp-input kp-step-in" type="datetime-local" value={startLocal} min={toLocalInput(Date.now() + 5 * 60000)} onChange={(e) => { setStartLocal(e.target.value); if (e.target.value) persist({ schedule: { startAt: inputIso(e.target.value) } }); }} style={{ marginTop: 8 }} aria-label="Start time" /> : null}
            <Choice style={{ marginTop: 8 }} value={endMode} onChange={(v) => { setEndMode(v); if (v === 'open') persist({ schedule: { endAt: null } }); }} options={[{ id: 'open', label: 'Run until done' }, { id: 'at', label: 'Finish by' }]} />
            {endMode === 'at' ? <input className="kp-input kp-step-in" type="datetime-local" value={endLocal} min={toLocalInput(Date.now() + 15 * 60000)} onChange={(e) => setEndLocal(e.target.value)} style={{ marginTop: 8 }} aria-label="Finish by" /> : null}

            <div className="kp-guard" style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="shield" size={15} color="var(--green)" />
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--green)' }}>Sender Guard plan</span>
                {!plan ? <Spinner size={13} color="var(--faint)" /> : null}
              </div>
              {guardInfo ? (
                <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
                  {guardInfo.existingCount} already text with you{guardInfo.newCount ? `, ${guardInfo.newCount} would be new conversations` : ''}.
                  {guardInfo.newCount ? ` New conversations are capped at about ${guardInfo.dailyNewTarget} a day, so this spreads over about ${guardInfo.estimatedDays} day${guardInfo.estimatedDays === 1 ? '' : 's'}.` : ' It should finish today.'}
                  {guardInfo.coldCount ? ` ${guardInfo.coldCount} have never replied to you: no photo or invite file in their first text, and at most 2 unanswered texts.` : ''}
                </div>
              ) : plan && plan.error ? <div style={{ fontSize: 13, color: 'var(--faint)', marginTop: 8 }}>Couldn’t estimate the pacing right now. The guard still applies at send time.</div> : null}
            </div>
            <InfoNote kind="route" style={{ marginTop: 12 }}>{ROUTING_NOTE}</InfoNote>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 10, lineHeight: 1.45 }}>Launching approves every text this campaign sends. Each one is still written per person at send time and checked by the Sender Guard. Opt-outs are permanent until they text START.</div>
          </div>
        ) : null}
      </BuilderBody>

      <ListingPicker open={pickListing} onClose={() => setPickListing(false)} onPick={attachListing} includeSold={trigger === 'just_sold'} />

      {launched ? (
        <div className="kp-launched">
          <div className="kp-launched-card kp-pop-in">
            <span style={{ width: 52, height: 52, borderRadius: '50%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--tint)', border: '1px solid rgba(var(--accent-rgb), 0.45)', color: 'var(--bright)', boxShadow: '0 0 24px -4px var(--glow)' }}>
              <Icon name={launched.status === 'scheduled' ? 'clock' : 'send'} size={21} />
            </span>
            <div style={{ fontSize: 19, fontWeight: 500, marginTop: 14 }}>{launched.status === 'scheduled' ? 'Campaign scheduled' : 'Campaign launched'}</div>
            <div style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.5, marginTop: 7 }}>
              {launched.status === 'scheduled'
                ? `Starts ${fmtTz(inputIso(startLocal), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} for ${launched.recipients} people. Replies land in your inbox.`
                : `Going out to ${launched.recipients} people, spaced out to feel human. Replies land in your inbox.`}
            </div>
            {launched.guard && launched.guard.newCount > 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5, marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--kp-panel)', textAlign: 'left' }}>
                {launched.guard.newCount} of them are new conversations, so this spreads over about {launched.guard.estimatedDays} day{launched.guard.estimatedDays === 1 ? '' : 's'} (about {launched.guard.dailyNewTarget} new people a day). That pacing is what keeps your number safe.
              </div>
            ) : null}
            <Button size="lg" block style={{ marginTop: 18 }} onClick={viewCampaign}>View campaign</Button>
          </div>
        </div>
      ) : null}
    </PushPanel>
  );
}

function SummaryCard({ icon, title, children, onEdit }) {
  return (
    <button type="button" className="km-press" onClick={onEdit} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', textAlign: 'left', marginTop: 10, padding: '13px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icon name={icon} size={16} color="var(--bright)" style={{ marginTop: 2 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--dim)', marginTop: 3, lineHeight: 1.45 }}>{children}</span>
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--bright)', fontWeight: 500 }}>Edit</span>
    </button>
  );
}

// Body: header (needs requestClose from the panel) + scroll area + footer.
function BuilderBody({ header, children, footer, loadError, campaign, scrollRef }) {
  const { requestClose } = usePanel();
  return (
    <>
      {header({ requestClose })}
      <div ref={scrollRef} className="km-scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 'calc(150px + var(--safe-bottom) + var(--keyboard-height))', transition: 'padding-bottom 0.25s var(--km-kb-ease)' }}>
        <div className="kp-wide" style={{ padding: '10px 16px 0' }}>
          {loadError ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--faint)' }}>
              <div style={{ fontSize: 15, color: 'var(--dim)', fontWeight: 500 }}>Couldn’t open this campaign</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{loadError.message}</div>
            </div>
          ) : !campaign ? (
            <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}><Spinner size={22} color="var(--faint)" /></div>
          ) : children}
        </div>
      </div>
      {campaign ? (typeof footer === 'function' ? footer({ requestClose }) : footer) : null}
    </>
  );
}
