// Chart pop-ups for the Stats page (lazy-loaded so recharts only ships when
// opened).
//   MTD — cumulative GCI by day, this month (accent, with a 10% wash) vs last
//         month (de-emphasis gray). Emphasis form: one hue + gray, one axis,
//         2px lines, crosshair tooltip listing both series, end labels.
//   YTD — GCI by month this year: one series, ≤24px columns with 4px rounded
//         caps, the best month labeled, per-bar tooltip.
// Both ship a table view underneath (tooltips enhance, never gate).
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Cell, LabelList,
} from 'recharts';
import Sheet from '../ui/Sheet';
import PillTabs from '../ui/PillTabs';
import { moneyCompact, money } from '../../lib/format';

const GRAY = '#7D8696';

function TipBox({ title, rows }) {
  return (
    <div className="km-lg km-lg--menu" style={{ padding: '8px 10px', borderRadius: 12, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 2 }}>
          <span style={{ width: 12, height: 2, borderRadius: 1, background: r.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
          <span style={{ color: 'var(--dim)' }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function MtdChart({ charts }) {
  const data = useMemo(() => {
    const n = Math.max(charts.dailyThisMonth.length, charts.dailyLastMonth.length);
    return Array.from({ length: n }, (_, i) => ({
      day: i + 1,
      thisCum: charts.dailyThisMonth[i] ? charts.dailyThisMonth[i].cum : null,
      lastCum: charts.dailyLastMonth[i] ? charts.dailyLastMonth[i].cum : null,
      thisDay: charts.dailyThisMonth[i] ? charts.dailyThisMonth[i].gci : 0,
      lastDay: charts.dailyLastMonth[i] ? charts.dailyLastMonth[i].gci : 0,
    }));
  }, [charts]);
  const lastPoint = [...data].reverse().find((d) => d.thisCum != null);
  const lastEnd = [...data].reverse().find((d) => d.lastCum != null);
  const thisLabel = charts.thisMonthLabel;
  const prevLabel = charts.lastMonthLabel;
  const rows = data.filter((d) => d.thisDay > 0 || d.lastDay > 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--dim)', margin: '2px 0 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, borderRadius: 1, background: 'var(--blue)' }} />{thisLabel}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, borderRadius: 1, background: GRAY }} />{prevLabel}</span>
      </div>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 22, right: 46, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--faint)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: 'var(--faint)', fontSize: 10 }} tickFormatter={(v) => moneyCompact(v)} />
            <Tooltip
              cursor={{ stroke: 'var(--lineHi)', strokeWidth: 1 }}
              content={({ active, payload, label }) => (active && payload ? (
                <TipBox
                  title={`Day ${label}`}
                  rows={[
                    payload.find((p) => p.dataKey === 'thisCum') && payload.find((p) => p.dataKey === 'thisCum').value != null ? { label: thisLabel, value: money(payload.find((p) => p.dataKey === 'thisCum').value), color: 'var(--blue)' } : null,
                    payload.find((p) => p.dataKey === 'lastCum') ? { label: prevLabel, value: money(payload.find((p) => p.dataKey === 'lastCum').value), color: GRAY } : null,
                  ].filter(Boolean)}
                />
              ) : null)}
            />
            <Line type="monotone" dataKey="lastCum" stroke={GRAY} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: GRAY }}>
              <LabelList dataKey="lastCum" content={({ x, y, index, value }) => (lastEnd && index === lastEnd.day - 1 ? <text x={x + 6} y={y + 4} fontSize={10} fill="var(--dim)">{moneyCompact(value)}</text> : null)} />
            </Line>
            <Area type="monotone" dataKey="thisCum" stroke="var(--blue)" strokeWidth={2} fill="var(--blue)" fillOpacity={0.1} connectNulls={false} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--blue)' }}>
              <LabelList dataKey="thisCum" content={({ x, y, index, value }) => (lastPoint && index === lastPoint.day - 1 ? <text x={x + 6} y={y - 6} fontSize={11} fontWeight={700} fill="var(--text)">{moneyCompact(value)}</text> : null)} />
            </Area>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="km-eyebrow" style={{ margin: '16px 2px 6px' }}>Closings by day</div>
      {rows.length ? (
        <div className="km-list" style={{ padding: '0 14px' }}>
          {rows.map((r) => (
            <div key={r.day} className="km-row" style={{ padding: '9px 0', fontSize: 13 }}>
              <span style={{ width: 54, color: 'var(--dim)' }}>Day {r.day}</span>
              <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>{r.thisDay ? money(r.thisDay) : '—'}</span>
              <span style={{ color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{r.lastDay ? `${prevLabel.slice(0, 3)} ${money(r.lastDay)}` : ''}</span>
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 13, color: 'var(--faint)', padding: '6px 2px' }}>No closings yet this month or last.</div>}
    </>
  );
}

function YtdChart({ charts, metric }) {
  const data = charts.monthlyThisYear.filter((m) => !m.future);
  const key = metric === 'volume' ? 'volume' : metric === 'sides' ? 'sides' : 'gci';
  const fmt = (v) => (key === 'sides' ? `${Math.round(v * 10) / 10}` : moneyCompact(v));
  const best = data.reduce((b, m) => (m[key] > (b ? b[key] : 0) ? m : b), null);
  return (
    <>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--faint)', fontSize: 10 }} />
            <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: 'var(--faint)', fontSize: 10 }} tickFormatter={fmt} allowDecimals={key !== 'sides'} />
            <Tooltip
              cursor={{ fill: 'var(--tint)' }}
              content={({ active, payload }) => (active && payload && payload[0] ? (
                <TipBox title={payload[0].payload.label} rows={[
                  { label: 'GCI', value: money(payload[0].payload.gci), color: 'var(--blue)' },
                  { label: 'sides', value: `${Math.round(payload[0].payload.sides * 10) / 10}`, color: 'var(--dim)' },
                  { label: 'volume', value: moneyCompact(payload[0].payload.volume), color: 'var(--dim)' },
                ]}
                />
              ) : null)}
            />
            <Bar dataKey={key} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((m) => <Cell key={m.month} fill={m.month === data[data.length - 1].month ? 'var(--bright)' : 'var(--blue)'} />)}
              <LabelList dataKey={key} content={({ x, y, width, index, value }) => (best && data[index] && data[index].month === best.month && value ? <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--text)">{fmt(value)}</text> : null)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="km-eyebrow" style={{ margin: '16px 2px 6px' }}>By month</div>
      <div className="km-list" style={{ padding: '0 14px' }}>
        {data.map((m) => (
          <div key={m.month} className="km-row" style={{ padding: '9px 0', fontSize: 13 }}>
            <span style={{ width: 44, color: 'var(--dim)' }}>{m.label}</span>
            <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(m.gci)}</span>
            <span style={{ width: 70, textAlign: 'right', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(m.sides * 10) / 10} sides</span>
            <span style={{ width: 64, textAlign: 'right', color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{moneyCompact(m.volume)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function ChartSheet({ open, kind, stats, money: m, onClose }) {
  const [metric, setMetric] = useState('gci');
  if (!stats) return null;
  const charts = stats.charts;
  const isMtd = kind === 'mtd';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isMtd ? `${charts.thisMonthLabel} GCI` : `${charts.year} GCI`}
      subtitle={isMtd ? `${money(m.mtdGci)} so far · ${charts.lastMonthLabel} closed ${money(m.lastMonthGci)}` : `${money(m.ytdGci)} year to date · ${Math.round((m.ytdSides || 0) * 10) / 10} sides`}
      left={false}
      right={{ label: 'Done', onClick: onClose }}
      maxWidth={620}
    >
      {isMtd ? <MtdChart charts={charts} /> : (
        <>
          <PillTabs size="sm" value={metric} onChange={setMetric} items={[{ id: 'gci', label: 'GCI' }, { id: 'sides', label: 'Sides' }, { id: 'volume', label: 'Volume' }]} style={{ marginBottom: 12 }} />
          <YtdChart charts={charts} metric={metric} />
        </>
      )}
    </Sheet>
  );
}
