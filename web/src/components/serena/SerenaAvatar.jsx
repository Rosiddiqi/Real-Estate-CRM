// SerenaAvatar — Serena's identity everywhere: a liquid-glass orb with a
// breathing violet core (RevMatch's SerenaAvatar). `thinking` adds a slow
// rotating halo while a turn is running.
import '../../styles/serena.css';

export default function SerenaAvatar({ size = 32, thinking = false, glass = true, style }) {
  const core = Math.max(6, Math.round(size * 0.24));
  return (
    <span
      className={`km-srn-avatar ${glass ? 'km-lg' : ''} ${thinking ? 'km-srn-avatar--thinking' : ''}`}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
    >
      <span className="km-srn-halo" />
      <span className="km-srn-core" style={{ width: core, height: core, boxShadow: `0 0 ${core}px rgba(154,77,255,0.55), 0 0 ${core * 2}px rgba(154,77,255,0.25)` }} />
    </span>
  );
}
