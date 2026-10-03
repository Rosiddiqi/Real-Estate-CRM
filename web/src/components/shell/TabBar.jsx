// Floating nav: a Liquid Glass pill, icon-only, with a dot under the active
// tab. Phone sits dead center in a raised circle — the easiest thumb tap,
// and the one place the neon highlight lives in the app chrome.
import Icon from '../ui/Icon';
import { haptic } from '../../lib/native';

const TABS = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'inbox', icon: 'inbox', label: 'Inbox' },
  { id: 'phone', icon: 'phone', label: 'Phone', center: true },
  { id: 'clients', icon: 'users', label: 'Clients' },
  { id: 'matchmaker', icon: 'rings', label: 'Matchmaker' },
];

export default function TabBar({ active, onChange, badges = {} }) {
  return (
    <div
      className="km-tabbar-wrap"
      style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'max(10px, calc(var(--safe-bottom) - 12px))',
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
        paddingLeft: 'calc(24px + env(safe-area-inset-left, 0px))',
        paddingRight: 'calc(24px + env(safe-area-inset-right, 0px))',
        zIndex: 9999,
      }}
    >
      <nav
        className="km-tabbar"
        aria-label="Primary"
        style={{
          pointerEvents: 'auto', position: 'relative', display: 'flex', alignItems: 'stretch',
          width: '100%', maxWidth: 344, height: 56, padding: '0 6px', borderRadius: 999,
        }}
      >
        {TABS.map((t) => {
          const isActive = t.id === active;
          const badge = badges[t.id];
          const count = badge > 99 ? '99+' : badge;
          const select = () => { if (t.id !== active) haptic('selection'); onChange?.(t.id); };
          if (t.center) {
            return (
              <div key={t.id} style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={select}
                  aria-label={t.label}
                  aria-current={isActive ? 'page' : undefined}
                  data-tab={t.id}
                  className="km-tabbar-center"
                >
                  <Icon name={t.icon} size={23} stroke={1.7} />
                  {badge ? <span className="km-tabbar-badge km-tabbar-badge--inv">{count}</span> : null}
                </button>
                <span className="km-tabbar-dot" aria-hidden="true" style={{ position: 'absolute', bottom: 6, opacity: isActive ? 1 : 0, transform: isActive ? 'scale(1)' : 'scale(0)' }} />
              </div>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              onClick={select}
              aria-label={t.label}
              aria-current={isActive ? 'page' : undefined}
              data-tab={t.id}
              style={{
                flex: 1, position: 'relative',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: 'var(--nav-icon)',
              }}
            >
              <span style={{ display: 'flex', marginTop: 4, opacity: isActive ? 1 : 0.6, transition: 'opacity 0.2s var(--km-ease)' }}>
                <Icon name={t.icon} size={23} stroke={isActive ? 1.8 : 1.5} />
              </span>
              <span className="km-tabbar-dot" aria-hidden="true" style={{ opacity: isActive ? 1 : 0, transform: isActive ? 'scale(1)' : 'scale(0)' }} />
              {badge ? <span className="km-tabbar-badge" style={{ position: 'absolute', top: 7, left: 'calc(50% + 5px)' }}>{count}</span> : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
