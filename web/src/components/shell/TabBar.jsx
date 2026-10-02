// Floating liquid-glass pill tab bar (ported from RevMatch). Phone sits dead
// center — the easiest thumb tap. A neutral glass "puck" springs under the
// active tab (it fades out on routes without a tab cell); the accent goes on
// the selected symbol + label, never on the glass.
import Icon from '../ui/Icon';
import { haptic } from '../../lib/native';

const TABS = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'inbox', icon: 'inbox', label: 'Inbox' },
  { id: 'phone', icon: 'phone', label: 'Phone' },
  { id: 'clients', icon: 'users', label: 'Clients' },
  { id: 'matchmaker', icon: 'rings', label: 'Matchmaker' },
];

export default function TabBar({ active, onChange, badges = {} }) {
  const found = TABS.findIndex((t) => t.id === active);
  const activeIndex = Math.max(0, found);
  const puckOn = found >= 0;
  const cellPct = 100 / TABS.length;

  return (
    <div
      className="km-tabbar-wrap"
      style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'calc(4px + var(--safe-bottom))',
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
        paddingLeft: 'calc(16px + env(safe-area-inset-left, 0px))',
        paddingRight: 'calc(16px + env(safe-area-inset-right, 0px))',
        zIndex: 9999,
      }}
    >
      <nav
        className="km-tabbar km-lg km-lg--solid"
        aria-label="Primary"
        style={{
          pointerEvents: 'auto', position: 'relative', display: 'flex',
          width: '100%', maxWidth: 380, padding: 6, borderRadius: 999,
        }}
      >
        <div
          className="km-tabbar-puck"
          aria-hidden="true"
          style={{
            position: 'absolute', top: 6, bottom: 6, left: 6,
            width: `calc((100% - 12px) * ${cellPct / 100})`,
            transform: `translateX(${activeIndex * 100}%)`,
            opacity: puckOn ? 1 : 0,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.12)',
            boxShadow: 'var(--lg-rim-glow), var(--lg-fringe)',
          }}
        />
        {TABS.map((t) => {
          const isActive = t.id === active;
          const color = isActive ? 'var(--bright)' : 'var(--faint)';
          const badge = badges[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { if (t.id !== active) haptic('selection'); onChange?.(t.id); }}
              aria-label={t.label}
              aria-current={isActive ? 'page' : undefined}
              data-tab={t.id}
              style={{
                flex: 1, position: 'relative', zIndex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 3, minHeight: 48, padding: '6px 0', color,
              }}
            >
              <div style={{ position: 'relative', filter: isActive ? 'drop-shadow(0 0 5px rgba(46,139,255,0.55))' : 'none', transition: 'filter 0.2s var(--km-ease)' }}>
                <Icon name={t.icon} size={22} color={color} stroke={isActive ? 2 : 1.7} />
                {badge ? (
                  <div
                    style={{
                      position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16, padding: '0 4px',
                      borderRadius: 9, background: 'var(--blue)', color: '#fff', fontSize: 9.5, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid rgba(3,4,6,0.95)',
                    }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </div>
                ) : null}
              </div>
              <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t.label}</div>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
