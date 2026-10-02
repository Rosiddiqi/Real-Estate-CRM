// Scoreboard — the month at a glance (RevMatch Scoreboard, finally wired):
//   • pace ring: sides closed this month vs the monthly goal, with a pace
//     needle at goal × (working days elapsed / working days in month).
//     Needle rotation is frac × 360° (RevMatch's −90° offset was a bug).
//     Ahead = accent · within 70% of pace = amber · behind = red. The track is
//     a lighter step of the same hue so the meter reads as one ramp.
//   • volume bar ($ closed vs monthly volume goal, pace tick)
//   • GCI MTD + projected end of month.
import { moneyCompact, money } from '../../lib/format';

const fmtSides = (n) => (Math.round((n || 0) * 10) / 10).toString();

export default function Scoreboard({ closings, volume, gci, northStar, monthLabel, onOpenCommissions }) {
  const size = 170;
  const stroke = 11;
  const R = (size - stroke) / 2;
  const CIRC = 2 * Math.PI * R;
  const units = closings.units || 0;
  const goal = closings.goal || 0;
  const pace = closings.pace || 0;
  const pct = goal > 0 ? Math.min(units / goal, 1) : 0;
  const paceAngle = goal > 0 ? Math.min(pace / goal, 1) * 360 : 0;
  const ahead = units >= pace - 0.05;
  const close = !ahead && units >= pace * 0.7;
  const ringColor = ahead ? 'var(--blue)' : close ? 'var(--amber)' : 'var(--red)';
  const behindBy = Math.max(0, pace - units);
  const paceText = ahead
    ? (units > pace + 0.5 ? `AHEAD +${fmtSides(units - pace)}` : 'ON PACE')
    : `${fmtSides(behindBy)} BEHIND`;

  const volGoal = volume.goal || 0;
  const volPct = volGoal > 0 ? Math.min((volume.units || 0) / volGoal, 1) : 0;
  const volAhead = (volume.units || 0) >= (volume.pace || 0);

  return (
    <div style={{ padding: '0 20px' }}>
      <div className="st-card" style={{ padding: '20px 18px 18px' }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} role="img" aria-label={`${fmtSides(units)} of ${goal} closings this month; pace ${fmtSides(pace)}`}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <defs>
                <filter id="km-ring-glow"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <circle cx={size / 2} cy={size / 2} r={R} fill="none" strokeWidth={stroke} style={{ stroke: `color-mix(in srgb, ${ringColor} 14%, transparent)` }} />
              <circle
                cx={size / 2} cy={size / 2} r={R} fill="none" strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
                filter="url(#km-ring-glow)" transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ stroke: ringColor, transition: 'stroke-dashoffset 0.8s var(--km-ease), stroke 0.3s' }}
              />
              {pace > 0 && goal > 0 ? (
                <g transform={`rotate(${paceAngle} ${size / 2} ${size / 2})`}>
                  <line x1={size / 2} y1={stroke / 2 - 5} x2={size / 2} y2={stroke / 2 + stroke + 3} strokeWidth={2.5} strokeLinecap="round" style={{ stroke: 'var(--text)', opacity: 0.75 }} />
                </g>
              ) : null}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.8, color: 'var(--blue)', marginBottom: 4 }}>CLOSINGS</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 700, color: 'var(--text)', letterSpacing: -2.2, lineHeight: 1 }}>{fmtSides(units)}</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: 'var(--faint)', marginTop: 4 }}>OF {goal} · {monthLabel}</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1.5, color: 'var(--faint)', marginBottom: 6 }}>NORTH STAR</div>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '17px', letterSpacing: -0.2, marginBottom: 10 }}>{northStar}</div>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6,
                background: ahead ? 'color-mix(in srgb, var(--blue) 10%, transparent)' : 'rgba(255,90,90,0.10)',
                border: `1px solid ${ahead ? 'color-mix(in srgb, var(--blue) 30%, transparent)' : 'rgba(255,90,90,0.30)'}`,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 3, background: ringColor, animation: 'pulseDot 1.6s ease-in-out infinite' }} />
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: 'var(--text)' }}>{paceText}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, lineHeight: 1.35 }}>
              Pace today: {fmtSides(pace)} of {goal}
            </div>
          </div>
        </div>

        <div style={{ paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--dim)' }}>VOLUME</span>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.4 }}>{moneyCompact(volume.units || 0)}</span>
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>
              {volGoal ? `of ${moneyCompact(volGoal)} · ` : ''}{fmtSides(units)} side{units === 1 ? '' : 's'}
            </span>
          </div>
          {volGoal > 0 ? (
            <div style={{ height: 6, borderRadius: 3, background: 'color-mix(in srgb, var(--green) 12%, transparent)', position: 'relative' }}>
              <div style={{ height: '100%', width: `${volPct * 100}%`, borderRadius: 3, background: volAhead ? 'var(--green)' : 'linear-gradient(90deg, var(--amber), #FFAF33)', transition: 'width 0.8s var(--km-ease)' }} />
              {volume.pace > 0 ? (
                <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.min(1, volume.pace / volGoal) * 100}%`, width: 2, borderRadius: 1, background: 'var(--text)', opacity: 0.55 }} title="Pace" />
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onOpenCommissions}
          className="km-press"
          style={{ width: '100%', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--faint)', marginBottom: 3 }}>GCI MTD</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--blue)', letterSpacing: -0.8, lineHeight: 1 }}>{gci.mtd != null ? money(gci.mtd) : '—'}</div>
            {gci.net != null ? <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>{money(gci.net)} net to you</div> : null}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.3, color: 'var(--faint)', marginBottom: 3 }}>PROJ EOM</div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>{gci.projected != null ? moneyCompact(gci.projected) : '—'}</div>
            {gci.weighted ? <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>+{moneyCompact(gci.weighted)} weighted</div> : null}
          </div>
        </button>
      </div>
    </div>
  );
}
