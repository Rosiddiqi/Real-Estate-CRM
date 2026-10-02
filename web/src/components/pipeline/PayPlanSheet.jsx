// Pay Plan sheet — editable (RevMatch's was a read-only constant). Blocks:
// PER DEAL (default rates, split) · CAP (cap, anniversary, progress) · TIERS
// (GCI thresholds) · FEES (transaction, post-cap, royalty, team) · GOALS.
// "Parse my ICA" reads the independent-contractor agreement (PDF, photo or
// pasted text) into a DRAFT — AI when available, deterministic parser when
// not — that the agent reviews and saves.
import { useEffect, useMemo, useRef, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { uploadFiles } from '../../api/system';
import { getPayPlan, parseIca, savePayPlan } from '../../api/commissions';
import { moneyCompact } from '../../lib/format';
import { AmountInput, RateInput, money0 } from './bits';
import { setPlan } from './config';
import { rederiveAll } from './dealStore';
import '../../styles/pipeline.css';

const PLAN_TYPES = [
  ['split_cap', 'Split + cap'],
  ['tiered', 'Tiered'],
  ['flat_fee', 'Flat fee'],
  ['100pct', '100%'],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Block({ title, subtitle, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ padding: '0 2px 8px' }}>
        <div className="km-pl-eyebrow">{title}</div>
        {subtitle ? <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      <div style={{ background: 'var(--surfaceHi)', border: '1px solid var(--lineHi)', borderRadius: 12, padding: '6px 12px' }}>{children}</div>
    </div>
  );
}
function Row({ label, hint, changed, children, last }) {
  return (
    <div className="km-pl-field" style={{ padding: '6px 0', margin: 0, borderBottom: last ? 0 : '1px solid var(--line)', minHeight: 44 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
          {changed ? <span className="km-pl-dot" style={{ background: 'var(--blue)', boxShadow: '0 0 6px var(--blue)' }} title="From your ICA" /> : null}
          {label}
        </span>
        {hint ? <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

export default function PayPlanSheet({ onClose }) {
  const [plan, setPlanState] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState(null); // { found:Set, source, summary }
  const [parseMode, setParseMode] = useState(null); // 'text'
  const [icaText, setIcaText] = useState('');
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef(null);
  const closeRef = useRef(null);

  const load = () => {
    setError(null);
    getPayPlan().then((r) => { setPlanState(r.payPlan); setForm(toForm(r.payPlan)); }).catch((e) => setError(e));
  };
  useEffect(load, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const cap = plan && plan.capState;
  const capPct = form && form.capAmount ? Math.min(1, (cap ? cap.companyPaid : 0) / form.capAmount) : 0;
  const changed = (k) => parsed && parsed.found.has(k);

  const tip = useMemo(() => {
    if (!form) return null;
    const split = form.agentSplit != null ? form.agentSplit : 0.7;
    const rate = form.defaultBuyerRate || 0.025;
    const per = 1000000 * rate * split;
    const remaining = form.capAmount ? Math.max(0, form.capAmount - (cap ? cap.companyPaid : 0)) : null;
    return { per, remaining, split, rate };
  }, [form, cap]);

  const runParse = async ({ text, file }) => {
    setParsing(true);
    try {
      let url;
      if (file) {
        const [up] = await uploadFiles([file]);
        url = up && up.url;
      }
      const r = await parseIca({ text, url });
      const found = new Set(Object.keys(r.draft || {}));
      if (!found.size) {
        toast(r.needsText ? 'Paste the agreement text and I’ll read the terms.' : 'Couldn’t find pay terms in that — fill them in below.');
        if (r.needsText) setParseMode('text');
      } else {
        setForm((f) => ({ ...f, ...fromDraft(r.draft) }));
        setParsed({ found, source: r.source, summary: r.summary });
        setParseMode(null);
        toast.success(`Read ${found.size} term${found.size === 1 ? '' : 's'} — review and save`);
      }
    } catch (e) {
      toast.error(e && e.message ? e.message : 'Couldn’t read that document');
    } finally {
      setParsing(false);
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const r = await savePayPlan(toBody(form));
      setPlan(r.payPlan);
      rederiveAll();
      try { window.dispatchEvent(new CustomEvent('pipeline:plan-changed')); } catch { /* noop */ }
      toast.success('Pay plan saved');
      if (closeRef.current) closeRef.current(); else onClose();
    } catch (e) {
      toast.error(e && e.message ? e.message : 'Couldn’t save the plan');
      setSaving(false);
    }
  };

  const footer = ({ close }) => {
    closeRef.current = close;
    return (
      <button type="button" className="km-btn km-btn--block km-press" disabled={!form || saving} onClick={save} style={{ minHeight: 48 }}>
        {saving ? <Spinner size={16} color="#fff" /> : <Icon name="check" size={17} stroke={2.4} />}
        {saving ? 'Saving…' : 'Save pay plan'}
      </button>
    );
  };

  return (
    <Sheet open onClose={onClose} title="Pay Plan" subtitle={plan ? plan.name : undefined} footer={footer} maxHeight="90%" zIndex={450}>
      {error ? (
        <div className="km-pl-error" style={{ margin: '8px 0' }}>Couldn’t load your pay plan.<button type="button" onClick={load}>Retry</button></div>
      ) : !form ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
      ) : (
        <div style={{ paddingBottom: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(46,139,255,0.10), var(--surfaceHi))', border: '1px solid rgba(46,139,255,0.25)',
          }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(46,139,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name={parsed ? 'sparkle' : 'checkCircle'} size={16} color="var(--blue)" stroke={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="km-pl-eyebrow" style={{ color: 'var(--blue)' }}>{parsed ? `PARSED · REVIEW${parsed.source === 'ai' ? '' : ' · BASIC READ'}` : 'ACTIVE'}</div>
              <div className="km-truncate" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
                {PLAN_TYPES.find((t) => t[0] === form.planType)?.[1]} · {Math.round((form.agentSplit ?? 0.7) * 100)}/{Math.round((1 - (form.agentSplit ?? 0.7)) * 100)}{form.capAmount ? ` until ${moneyCompact(form.capAmount)} cap` : ''}
              </div>
              <div className="km-truncate" style={{ fontSize: 11.5, color: 'var(--faint)' }}>{parsed && parsed.summary ? parsed.summary : `Cap year resets ${MONTHS[Number(form.annMonth) - 1]} ${Number(form.annDay)}`}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="km-pl-btn km-press" style={{ minHeight: 42, fontSize: 13 }} disabled={parsing} onClick={() => fileRef.current && fileRef.current.click()}>
              {parsing ? <Spinner size={14} /> : <Icon name="scan" size={15} />} {parsing ? 'Reading…' : 'Parse my ICA'}
            </button>
            <button type="button" className="km-pl-btn km-press" style={{ minHeight: 42, fontSize: 13, flex: 0.7 }} onClick={() => setParseMode(parseMode === 'text' ? null : 'text')}>
              <Icon name="file" size={15} /> Paste text
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,image/*,.txt" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) runParse({ file: f }); }} />
          </div>
          {parseMode === 'text' ? (
            <div style={{ marginTop: 10, animation: 'km-pl-expand 0.18s ease' }}>
              <textarea className="km-input" rows={5} value={icaText} onChange={(e) => setIcaText(e.target.value)} placeholder="Paste the commission section of your independent contractor agreement…" />
              <button type="button" className="km-btn km-btn--sm km-press" style={{ marginTop: 8 }} disabled={!icaText.trim() || parsing} onClick={() => runParse({ text: icaText })}>
                {parsing ? 'Reading…' : 'Read terms'}
              </button>
            </div>
          ) : null}

          <Block title="Per deal" subtitle="Defaults for new deals — any deal can override its rate">
            <Row label="Plan type" changed={changed('planType')}>
              <select className="km-input" value={form.planType} onChange={(e) => set({ planType: e.target.value })} style={{ width: 140, minHeight: 34, padding: '4px 10px', fontSize: 16 }}>
                {PLAN_TYPES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </Row>
            <Row label="Buyer side rate" changed={changed('defaultBuyerRate')}><RateInput ariaLabel="Buyer side rate" value={form.defaultBuyerRate} onChange={(v) => set({ defaultBuyerRate: v })} /></Row>
            <Row label="Listing side rate" changed={changed('defaultListingRate')}><RateInput ariaLabel="Listing side rate" value={form.defaultListingRate} onChange={(v) => set({ defaultListingRate: v })} /></Row>
            <Row label="Your split" hint="Your share of each side before the cap" changed={changed('agentSplit')} last><RateInput ariaLabel="Your split" value={form.agentSplit} onChange={(v) => set({ agentSplit: v })} /></Row>
          </Block>

          <Block title="Cap" subtitle="Company dollar you pay before you keep 100%">
            <Row label="Annual cap" changed={changed('capAmount')}><AmountInput ariaLabel="Annual cap" value={form.capAmount} placeholder="No cap" onChange={(v) => set({ capAmount: v })} /></Row>
            <Row label="Cap year starts" changed={changed('capAnniversary')}>
              <span style={{ display: 'flex', gap: 6 }}>
                <select className="km-input" value={form.annMonth} onChange={(e) => set({ annMonth: e.target.value })} style={{ width: 82, minHeight: 34, padding: '4px 8px', fontSize: 16 }}>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                </select>
                <select className="km-input" value={form.annDay} onChange={(e) => set({ annDay: e.target.value })} style={{ width: 64, minHeight: 34, padding: '4px 8px', fontSize: 16 }}>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
                </select>
              </span>
            </Row>
            <Row label="After the cap you keep" changed={changed('postCapSplit')} last={!form.capAmount}><RateInput ariaLabel="Post-cap split" value={form.postCapSplit} onChange={(v) => set({ postCapSplit: v })} /></Row>
            {form.capAmount ? (
              <div style={{ padding: '10px 0 8px' }}>
                <div className="km-cm-bar"><div className="km-cm-fill" style={{ width: `${capPct * 100}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: 'var(--dim)' }}>
                  <span>{money0(cap ? cap.companyPaid : 0)} paid</span>
                  <span>{capPct >= 1 ? 'Capped' : `${money0(Math.max(0, form.capAmount - (cap ? cap.companyPaid : 0)))} to go`}</span>
                </div>
              </div>
            ) : null}
          </Block>

          <Block title="Tiers" subtitle="Your split steps up as GCI grows within the cap year">
            {(form.tiers || []).length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '10px 0' }}>No tiers — one split all year.</div>
            ) : form.tiers.map((t, i) => (
              <div key={i} className="km-pl-field" style={{ padding: '6px 0', margin: 0, borderBottom: '1px solid var(--line)' }}>
                <span className="km-pl-field-l" style={{ fontSize: 12.5 }}>From GCI</span>
                <AmountInput ariaLabel={`Tier ${i + 1} from GCI`} value={t.fromGci} onChange={(v) => set({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, fromGci: v || 0 } : x)) })} />
                <RateInput ariaLabel={`Tier ${i + 1} split`} value={t.agentSplit} onChange={(v) => set({ tiers: form.tiers.map((x, j) => (j === i ? { ...x, agentSplit: v } : x)) })} />
                <button type="button" className="km-icon-btn km-icon-btn--sm" aria-label="Remove tier" onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })}><Icon name="x" size={14} color="var(--faint)" /></button>
              </div>
            ))}
            <button
              type="button"
              className="km-pl-link"
              style={{ padding: '10px 0', fontSize: 13 }}
              onClick={() => {
                const last = (form.tiers || [])[form.tiers.length - 1];
                set({ tiers: [...(form.tiers || []), last ? { fromGci: (last.fromGci || 0) + 100000, agentSplit: Math.min(1, (last.agentSplit || 0.7) + 0.05) } : { fromGci: 0, agentSplit: form.agentSplit ?? 0.7 }] });
              }}
            >
              + Add tier
            </button>
          </Block>

          <Block title="Fees">
            <Row label="Transaction fee" changed={changed('transactionFee')}><AmountInput ariaLabel="Transaction fee" value={form.transactionFee} onChange={(v) => set({ transactionFee: v })} /></Row>
            <Row label="After-cap fee" changed={changed('postCapTransactionFee')}><AmountInput ariaLabel="After-cap fee" value={form.postCapTransactionFee} onChange={(v) => set({ postCapTransactionFee: v })} /></Row>
            <Row label="Franchise royalty" changed={changed('franchisePct')}><RateInput ariaLabel="Franchise royalty" value={form.franchisePct} placeholder="0" onChange={(v) => set({ franchisePct: v })} /></Row>
            <Row label="Royalty cap" changed={changed('franchiseCap')}><AmountInput ariaLabel="Royalty cap" value={form.franchiseCap} placeholder="None" onChange={(v) => set({ franchiseCap: v })} /></Row>
            <Row label="Team lead share" hint="On team-sourced deals" changed={changed('teamLeadPct')} last><RateInput ariaLabel="Team lead share" value={form.teamLeadPct} placeholder="0" onChange={(v) => set({ teamLeadPct: v })} /></Row>
          </Block>

          <Block title="Goals" subtitle="Drives pace on Stats and Commissions">
            <Row label="Annual GCI"><AmountInput ariaLabel="Annual GCI goal" value={form.goals.annualGci} onChange={(v) => set({ goals: { ...form.goals, annualGci: v } })} /></Row>
            <Row label="Annual net"><AmountInput ariaLabel="Annual net goal" value={form.goals.annualNet} onChange={(v) => set({ goals: { ...form.goals, annualNet: v } })} /></Row>
            <Row label="Annual sides"><AmountInput ariaLabel="Annual sides goal" prefix="" value={form.goals.annualSides} onChange={(v) => set({ goals: { ...form.goals, annualSides: v } })} /></Row>
            <Row label="Annual volume"><AmountInput ariaLabel="Annual volume goal" value={form.goals.annualVolume} onChange={(v) => set({ goals: { ...form.goals, annualVolume: v } })} /></Row>
            <Row label="Sides per month" last><AmountInput ariaLabel="Monthly sides goal" prefix="" value={form.goals.monthlySides} onChange={(v) => set({ goals: { ...form.goals, monthlySides: v } })} /></Row>
          </Block>

          {tip ? (
            <div className="km-pl-serena" style={{ marginTop: 16, display: 'flex', gap: 10, background: 'rgba(154,77,255,0.08)', borderColor: 'rgba(154,77,255,0.25)' }}>
              <Icon name="sparkle" size={14} color="var(--violet)" />
              <div style={{ flex: 1 }}>
                <b>SERENA</b>
                Every <strong style={{ color: 'var(--text)' }}>+$1M</strong> of buyer-side volume at {+(tip.rate * 100).toFixed(2)}% puts about <strong style={{ color: 'var(--text)' }}>{moneyCompact(tip.per)}</strong> in your pocket at a {Math.round(tip.split * 100)}% split
                {tip.remaining != null ? (tip.remaining > 0
                  ? <> — and you’re <strong style={{ color: 'var(--text)' }}>{moneyCompact(tip.remaining)}</strong> from cap. After that every closing pays {Math.round((form.postCapSplit ?? 1) * 100)}%.</>
                  : <> — you’re capped: every closing now pays {Math.round((form.postCapSplit ?? 1) * 100)}% until the anniversary.</>) : '.'}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function toForm(p) {
  const [mm, dd] = String(p.capAnniversary || '01-01').split('-');
  return {
    name: p.name,
    planType: p.planType || 'split_cap',
    defaultBuyerRate: p.defaultBuyerRate,
    defaultListingRate: p.defaultListingRate,
    agentSplit: p.agentSplit,
    capAmount: p.capAmount,
    annMonth: mm || '01',
    annDay: dd || '01',
    postCapSplit: p.postCapSplit,
    transactionFee: p.transactionFee,
    postCapTransactionFee: p.postCapTransactionFee,
    franchisePct: p.franchisePct,
    franchiseCap: p.franchiseCap,
    teamLeadPct: p.teamLeadPct,
    tiers: (p.tiers || []).map((t) => ({ fromGci: t.fromGci, agentSplit: t.agentSplit })),
    goals: { ...(p.goals || {}) },
  };
}
function fromDraft(d) {
  const out = { ...d };
  if (d.capAnniversary) { const [m, dd] = d.capAnniversary.split('-'); out.annMonth = m; out.annDay = dd; delete out.capAnniversary; }
  delete out.brokerage; delete out.office; delete out.role;
  return out;
}
function toBody(f) {
  return {
    planType: f.planType,
    defaultBuyerRate: f.defaultBuyerRate,
    defaultListingRate: f.defaultListingRate,
    agentSplit: f.agentSplit,
    capAmount: f.capAmount,
    capAnniversary: `${f.annMonth}-${f.annDay}`,
    postCapSplit: f.postCapSplit ?? 1,
    transactionFee: f.transactionFee ?? 0,
    postCapTransactionFee: f.postCapTransactionFee ?? 0,
    franchisePct: f.franchisePct ?? 0,
    franchiseCap: f.franchiseCap,
    teamLeadPct: f.teamLeadPct ?? 0,
    tiers: (f.tiers || []).filter((t) => t.agentSplit != null),
    goals: Object.fromEntries(Object.entries(f.goals || {}).filter(([, v]) => v != null && v !== '')),
  };
}
