// Commission — the agent's pay screen (PushPanel). Everything comes from
// GET /api/commissions/summary (one commission formula, server-side; closed
// deals queried directly so history survives month rollover):
//   month card (booked net · sides · volume) → cap progress with tier ticks →
//   Pending (Under Contract by closing month) → stage-weighted forecast →
//   YTD / cap-year totals + goals → 12-month chart → history → referral fees.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PushPanel from '../../components/ui/PushPanel';
import GlassButton from '../../components/ui/GlassButton';
import Icon from '../../components/ui/Icon';
import PropertyPhoto from '../../components/ui/PropertyPhoto';
import { EmptyState } from '../../components/ui/kit';
import { nav } from '../../lib/nav';
import { moneyCompact } from '../../lib/format';
import { getCommissionSummary } from '../../api/commissions';
import { useResync, useSocket } from '../../hooks/useSocket';
import { money0, shortDate } from '../../components/pipeline/bits';
import '../../styles/pipeline.css';

const fmtSides = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
const plural = (n, one, many = `${one}s`) => `${fmtSides(n)} ${n === 1 ? one : many}`;

function useCssColors(names) {
  const read = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, [names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setColors(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class', 'data-accent'] });
    return () => mo.disconnect();
  }, [read]);
  return colors;
}

function Card({ children, style, className = '' }) {
  return <div className={`km-cm-card ${className}`} style={style}>{children}</div>;
}

function ChartTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="km-lg km-lg--menu" style={{ padding: '8px 11px', borderRadius: 10, fontSize: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 500 }}>{money0(p.net)}</div>
      <div style={{ color: 'var(--dim)', marginTop: 1 }}>{p.label} {p.year} · {plural(p.sides, 'side')} · {moneyCompact(p.volume)} vol</div>
    </div>
  );
}

function MonthChart({ series }) {
  const c = useCssColors(['--blue', '--faint', '--line', '--text']);
  const max = Math.max(...series.map((s) => s.net), 0);
  if (!max) {
    return <div className="km-pl-dashed" style={{ marginTop: 12 }}>Your closings will chart here month by month.</div>;
  }
  return (
    <div style={{ height: 176, marginTop: 12, marginLeft: -6 }} role="img" aria-label="Net commission per month, last 12 months">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={c['--line']} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fill: c['--faint'], fontSize: 10 }} />
          <YAxis width={42} tickLine={false} axisLine={false} tick={{ fill: c['--faint'], fontSize: 10 }} tickFormatter={(v) => (v ? moneyCompact(v) : '0')} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(var(--accent-rgb), 0.08)' }} content={<ChartTip />} isAnimationActive={false} />
          <Bar dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive>
            {series.map((s) => <Cell key={s.key} fill={c['--blue']} fillOpacity={s.current ? 1 : 0.38} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CapCard({ cap, onPlan }) {
  if (!cap) return null;
  const hasCap = cap.amount != null;
  const tiers = cap.tiers || [];
  const tierMax = tiers.length ? Math.max(...tiers.map((t) => t.fromGci)) * 1.15 || 1 : 0;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div className="km-cm-eye">Cap · since {shortDate(cap.start)}</div>
        <button type="button" className="km-pl-link" onClick={onPlan}>Pay plan</button>
      </div>
      {hasCap ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.6 }}>{money0(cap.paid)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>of {money0(cap.amount)} company dollar</div>
          </div>
          <div className="km-cm-bar" style={{ marginTop: 12, background: 'rgba(var(--accent-rgb), 0.14)' }} role="meter" aria-valuemin={0} aria-valuemax={cap.amount} aria-valuenow={cap.paid} aria-label="Cap progress">
            <div className={`km-cm-fill ${cap.capped ? 'km-cm-fill--green' : ''}`} style={{ width: `${Math.max(2, (cap.pct || 0) * 100)}%` }} />
            {[0.25, 0.5, 0.75].map((t) => <div key={t} className="km-cm-tick" style={{ left: `${t * 100}%` }} />)}
          </div>
          <div className="km-cm-caption">
            {cap.capped
              ? <>Capped — keeping <b>{Math.round(cap.postCapSplit * 100)}%</b> until {shortDate(cap.end, { month: 'short', day: 'numeric', year: 'numeric' })}</>
              : <><b>{money0(cap.remaining)}</b> to cap — then {Math.round(cap.postCapSplit * 100)}%</>}
          </div>
        </>
      ) : (
        <div className="km-cm-caption" style={{ marginTop: 8 }}>No cap on your plan — you keep <b>{Math.round(cap.currentSplit * 100)}%</b> of every side.</div>
      )}
      {tiers.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--dim)', marginBottom: 7 }}>
            <span>Split tier · {moneyCompact(cap.gciYtd)} GCI this cap year</span>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{Math.round(cap.currentSplit * 100)}% now</span>
          </div>
          <div className="km-cm-bar" style={{ background: 'rgba(var(--accent-rgb), 0.14)' }}>
            <div className="km-cm-fill" style={{ width: `${Math.min(1, cap.gciYtd / tierMax) * 100}%` }} />
            {tiers.filter((t) => t.fromGci > 0).map((t) => <div key={t.fromGci} className="km-cm-tick" style={{ left: `${(t.fromGci / tierMax) * 100}%` }} />)}
          </div>
          <div className="km-cm-ticklabels">
            {tiers.map((t, i) => (
              <span key={t.fromGci} style={{ left: `${(t.fromGci / tierMax) * 100}%`, color: t.reached ? 'var(--blue)' : 'var(--faint)', fontWeight: t.reached ? 700 : 500, ...(i === 0 ? {} : {}) }}>
                {t.fromGci ? `${moneyCompact(t.fromGci)}+` : 'Start'} {Math.round(t.agentSplit * 100)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function DealRow({ d, right, sub }) {
  return (
    <button type="button" className="km-cm-row km-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.openDeal(d.id)}>
      <PropertyPhoto src={d.photo} seed={d.address || d.id} radius={7} height={32} style={{ width: 42, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="km-cm-rowname">{d.name}</div>
        <div className="km-cm-rowsub">{sub}</div>
      </div>
      {right}
    </button>
  );
}

export default function CommissionsPage({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [yearTab, setYearTab] = useState('ytd');
  const [openMonths, setOpenMonths] = useState(() => new Set());
  const timer = useRef(null);

  const load = useCallback(() => {
    getCommissionSummary().then((r) => { setData(r); setError(null); }).catch((e) => setError(e));
  }, []);
  useEffect(() => { load(); }, [load]);
  const soon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 600); }, [load]);
  useSocket(['deal_created', 'deal_updated', 'deal_deleted'], soon);
  useResync(load);
  useEffect(() => {
    window.addEventListener('pipeline:plan-changed', soon);
    return () => { window.removeEventListener('pipeline:plan-changed', soon); clearTimeout(timer.current); };
  }, [soon]);

  const thisMonth = data && data.history.find((h) => h.key === data.month.key);
  const yearAgg = data ? (yearTab === 'ytd' ? data.ytd : data.capYear) : null;
  const g = data && data.goals;
  const fMax = useMemo(() => (data ? Math.max(1, ...data.projected.byMonth.map((m) => m.weighted)) : 1), [data]);

  const toggleMonth = (key) => setOpenMonths((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <PushPanel
      onClose={onClose}
      title="Commission"
      right={<GlassButton icon="percent" label="Edit pay plan" onClick={() => nav.openPayPlan()} />}
      bodyStyle={{ paddingTop: 2 }}
    >
      {error && !data ? (
        <div className="km-pl-error" style={{ marginTop: 10 }}>Couldn’t load your commission numbers.<button type="button" onClick={load}>Retry</button></div>
      ) : !data ? (
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 16px' }}>
          {[150, 128, 180, 96].map((h, i) => <div key={i} className="km-row-in" style={{ animationDelay: `${i * 40}ms` }}><div className="km-skel" style={{ height: h, borderRadius: 16 }} /></div>)}
        </div>
      ) : (
        <>
          <div className="km-cm-hero">
            <div className="km-cm-eyebrow">{data.month.label} · month to date</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <div style={{ fontSize: 48, fontWeight: 500, letterSpacing: -1.6, lineHeight: 1 }}>{money0(data.mtd.net)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>net</div>
            </div>
            <div className="km-cm-heroline">
              <b>{plural(data.mtd.sides, 'side')}</b> <span className="km-cm-sep">·</span> {moneyCompact(data.mtd.volume)} volume <span className="km-cm-sep">·</span> {moneyCompact(data.mtd.gci)} GCI
            </div>
            {data.mtd.estimatedCount ? (
              <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                Includes {money0(data.mtd.estimatedNet)} estimated on {plural(data.mtd.estimatedCount, 'closing')} — enter actuals below.
              </div>
            ) : null}
            {data.lastMonth.closings ? (
              <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 4 }}>Last month {money0(data.lastMonth.net)} · {plural(data.lastMonth.sides, 'side')}</div>
            ) : null}
          </div>

          <div className="km-cm-wrap">
            <Card style={{ padding: thisMonth && thisMonth.deals.length ? '6px 16px' : 16 }}>
              {thisMonth && thisMonth.deals.length ? thisMonth.deals.map((d) => (
                <DealRow
                  key={d.id}
                  d={d}
                  sub={[d.address, shortDate(d.closedAt)].filter(Boolean).join(' · ')}
                  right={(
                    <div style={{ textAlign: 'right' }}>
                      <div className="km-cm-amt" style={{ color: d.booked ? 'var(--text)' : 'var(--dim)' }}>{money0(d.net)}</div>
                      <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 0.8, color: 'var(--faint)' }}>{d.booked ? 'BOOKED' : 'EST.'}</div>
                    </div>
                  )}
                />
              )) : (
                <div style={{ textAlign: 'center', padding: '6px 8px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--dim)' }}>No closings yet this month</div>
                  <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 4 }}>Move a deal to Closed in the Pipeline and the money lands here.</div>
                </div>
              )}
            </Card>

            <CapCard cap={data.cap} onPlan={() => nav.openPayPlan()} />

            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="km-cm-eye">Pending · under contract</div>
                <div className="km-cm-amt" style={{ fontSize: 15, color: 'var(--text)' }}>{money0(data.pendingTotal)}</div>
              </div>
              {data.pending.length ? data.pending.map((p) => (
                <div key={p.key} style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 500, color: 'var(--dim)', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                    <span>{p.label} · {p.count}</span>
                    <span className="km-mono">{money0(p.net)}</span>
                  </div>
                  {p.deals.map((d) => (
                    <DealRow
                      key={d.id}
                      d={d}
                      sub={[d.address, d.closingDate ? `${shortDate(d.closingDate)}${d.daysToClose != null ? (d.daysToClose < 0 ? ` · ${-d.daysToClose}d late` : ` · ${d.daysToClose}d`) : ''}` : null].filter(Boolean).join(' · ')}
                      right={<div className="km-cm-amt" style={{ color: d.daysToClose != null && d.daysToClose < 0 ? 'var(--red)' : 'var(--text)' }}>{money0(d.net)}</div>}
                    />
                  ))}
                </div>
              )) : <div className="km-cm-caption">Nothing under contract right now.</div>}
            </Card>

            <Card>
              <div className="km-cm-eye">Forecast · stage-weighted</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.6 }}>{money0(data.projected.weighted)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>of {moneyCompact(data.projected.unweighted)} open</div>
              </div>
              <div className="km-cm-caption">
                Month-end projection <b>{money0(data.projected.eom)}</b> · weights consult 10% · active 20% · offer 40% · under contract 85%
              </div>
              <div className="km-cm-fbars" aria-label="Weighted forecast by month">
                {data.projected.byMonth.map((m) => (
                  <div key={m.key} className="km-cm-fbar" title={`${m.label}: ${money0(m.weighted)} weighted · ${m.count} deal${m.count === 1 ? '' : 's'}`}>
                    <i className={m.weighted ? '' : 'zero'} style={{ height: `${Math.max(4, (m.weighted / fMax) * 52)}px` }} />
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
              {data.projected.unscheduled.count ? (
                <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>+ {money0(data.projected.unscheduled.weighted)} weighted on {plural(data.projected.unscheduled.count, 'deal')} with no closing date yet</div>
              ) : null}
            </Card>

            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div className="km-cm-eye">{yearTab === 'ytd' ? 'Year to date' : `Cap year · since ${shortDate(data.cap.start)}`}</div>
                <div className="km-cm-tabs" style={{ width: 172, flexShrink: 0 }}>
                  <button type="button" className={yearTab === 'ytd' ? 'on' : ''} onClick={() => setYearTab('ytd')}>YTD</button>
                  <button type="button" className={yearTab === 'cap' ? 'on' : ''} onClick={() => setYearTab('cap')}>Cap year</button>
                </div>
              </div>
              <div className="km-cm-grid">
                <div className="km-cm-cell"><div className="km-pl-eyebrow">Net</div><div className="km-cm-cellv">{moneyCompact(yearAgg.net)}</div></div>
                <div className="km-cm-cell"><div className="km-pl-eyebrow">GCI</div><div className="km-cm-cellv">{moneyCompact(yearAgg.gci)}</div></div>
                <div className="km-cm-cell"><div className="km-pl-eyebrow">Sides</div><div className="km-cm-cellv">{fmtSides(yearAgg.sides)}</div></div>
                <div className="km-cm-cell"><div className="km-pl-eyebrow">Volume</div><div className="km-cm-cellv">{moneyCompact(yearAgg.volume)}</div></div>
              </div>
              {g && (g.annualGci || g.annualSides || g.annualVolume) ? (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    ['GCI', g.annualGci, data.ytd.gci, g.pace.gci, moneyCompact],
                    ['Sides', g.annualSides, data.ytd.sides, g.pace.sides, fmtSides],
                    ['Volume', g.annualVolume, data.ytd.volume, g.pace.volume, moneyCompact],
                  ].filter(([, goal]) => goal).map(([label, goal, val, pace, f]) => {
                    const ahead = val >= (pace || 0);
                    return (
                      <div key={label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--dim)', marginBottom: 6 }}>
                          <span>{label} goal · {f(val)} of {f(goal)}</span>
                          <span style={{ color: ahead ? 'var(--green)' : 'var(--amber)', fontWeight: 500 }}>{ahead ? 'ON PACE' : `${f(Math.max(0, pace - val))} BEHIND`}</span>
                        </div>
                        <div className="km-cm-bar" style={{ height: 6, overflow: 'visible', background: 'rgba(var(--accent-rgb), 0.14)' }}>
                          <div className={`km-cm-fill ${ahead ? 'km-cm-fill--green' : ''}`} style={{ width: `${Math.min(1, val / goal) * 100}%` }} />
                          {pace ? <div className="km-cm-pace" style={{ left: `${Math.min(1, pace / goal) * 100}%` }} title="Pace for today" /> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </Card>

            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="km-cm-eye">Net by month</div>
                <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>last 12 months</div>
              </div>
              <MonthChart series={data.series} />
            </Card>

            <Card style={{ padding: '8px 16px' }}>
              <div className="km-cm-eye" style={{ padding: '8px 0 4px' }}>History</div>
              {data.history.length === 0 ? (
                <EmptyState icon="award" title="No closings yet" sub="Closed deals file here by month, forever — even after they roll off the board." style={{ padding: '18px 8px' }} />
              ) : data.history.map((m) => {
                const open = openMonths.has(m.key);
                return (
                  <div key={m.key}>
                    <button type="button" className="km-cm-monthhead km-press" onClick={() => toggleMonth(m.key)} aria-expanded={open}>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{m.label}</span>
                      <span className="km-mono" style={{ fontSize: 11, color: 'var(--dim)' }}>{plural(m.sides, 'side')}</span>
                      <span className="km-cm-amt" style={{ minWidth: 78 }}>{money0(m.net)}</span>
                      <Icon name="chevronRight" size={14} color="var(--faint)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .28s cubic-bezier(.3,.7,.3,1)' }} />
                    </button>
                    <div className="km-bk-acc" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                      <div>
                        {m.deals.map((d) => (
                          <DealRow
                            key={d.id}
                            d={d}
                            sub={[d.address, d.closedAt ? shortDate(d.closedAt) : null].filter(Boolean).join(' · ')}
                            right={(
                              <div style={{ textAlign: 'right' }}>
                                <div className="km-cm-amt">{money0(d.net)}</div>
                                <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 0.8, color: 'var(--faint)' }}>{d.booked ? 'BOOKED' : 'EST.'}</div>
                              </div>
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>

            {(data.referrals.payable.rows.length || data.referrals.receivable.rows.length) ? (
              <Card style={{ padding: '8px 16px 12px' }}>
                <div className="km-cm-eye" style={{ padding: '8px 0 2px' }}>Referral fees</div>
                <div style={{ display: 'flex', gap: 14, padding: '6px 0 6px', fontSize: 11.5, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--green)' }}>{money0(data.referrals.receivable.total)} receivable</span>
                  <span style={{ color: 'var(--amber)' }}>{money0(data.referrals.payable.total)} payable</span>
                </div>
                {[...data.referrals.receivable.rows.map((r) => ({ ...r, dir: 'in' })), ...data.referrals.payable.rows.map((r) => ({ ...r, dir: 'out' }))].slice(0, 8).map((r) => {
                  const tone = r.status === 'received' || r.status === 'paid' ? 'var(--green)' : r.status === 'due' ? 'var(--amber)' : 'var(--blue)';
                  return (
                    <button type="button" key={`${r.dir}${r.dealId}`} className="km-cm-row km-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.openDeal(r.dealId)}>
                      <Icon name={r.dir === 'in' ? 'arrowDown' : 'arrowUp'} size={15} color={r.dir === 'in' ? 'var(--green)' : 'var(--amber)'} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="km-cm-rowname" style={{ fontSize: 13.5 }}>{r.name}</div>
                        <div className="km-cm-rowsub" style={{ fontSize: 11.5 }}>{r.dir === 'in' ? 'From' : 'To'} {r.partner || 'partner agent'} · {r.label}</div>
                      </div>
                      <div className="km-cm-amt">{money0(r.amount)}</div>
                      <span className="km-cm-chip" style={{ color: tone, borderColor: tone, background: 'transparent' }}>{r.status}</span>
                    </button>
                  );
                })}
              </Card>
            ) : null}

            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div className="km-cm-eye">Pay plan</div>
                  <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{data.plan.name || 'My plan'}</div>
                </div>
                <button type="button" className="km-cm-planbtn km-press" onClick={() => nav.openPayPlan()}>Edit pay plan</button>
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  ['Split', `${Math.round(data.plan.agentSplit * 100)}/${Math.round((1 - data.plan.agentSplit) * 100)}${data.plan.capAmount ? ` · ${moneyCompact(data.plan.capAmount)} cap` : ' · no cap'}`],
                  ['Rates', `Buyer ${+(data.plan.defaultBuyerRate * 100).toFixed(2)}% · Listing ${+(data.plan.defaultListingRate * 100).toFixed(2)}%`],
                  ['Fees', `${money0(data.plan.transactionFee)}/deal · ${money0(data.plan.postCapTransactionFee)} after cap`],
                ].map(([k, v]) => <div key={k} className="km-cm-kv"><span>{k}</span><span>{v}</span></div>)}
              </div>
            </Card>
          </div>
        </>
      )}
    </PushPanel>
  );
}
