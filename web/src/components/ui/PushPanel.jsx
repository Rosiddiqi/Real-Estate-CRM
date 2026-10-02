// PushPanel — every page-like overlay (thread, client card, deal, listing,
// settings, commissions…) uses this. Slides in from the right over a dim
// scrim while the page beneath dips 24% left; back button pops it; interactive
// edge-swipe-back peels it off (usePushPanel + useEdgeSwipeBack, ported from
// RevMatch). Never mount a page-like surface with a bottom rise or hard cut.
//
//   <PushPanel onClose={close} title="Elena Vasquez" right={<GlassButton icon="moreV" />}>
//     ...scrollable content...
//   </PushPanel>
//   Inside: const { requestClose } = usePanel();
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { usePushPanel } from '../../hooks/usePushPanel';
import PageHeader from './PageHeader';

const PanelCtx = createContext({ requestClose: () => {}, closing: false });
export const usePanel = () => useContext(PanelCtx);

export default function PushPanel({
  onClose,
  title,
  subtitle,
  left,
  right,
  header,           // custom header node, or false for none
  children,
  zIndex = 200,
  scroll = true,     // wrap children in the scroll container
  bodyStyle,
  bodyClassName = '',
  companions,
  pinned,
  background = 'var(--bg)',
  className = '',
}) {
  const { panelRef, closing, requestClose } = usePushPanel(onClose, { companions, pinned });

  return createPortal(
    <PanelCtx.Provider value={{ requestClose, closing }}>
      <div
        ref={panelRef}
        className={`km-panel ${className}`}
        style={{
          position: 'fixed', inset: 0, zIndex, background,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {header === false ? null : header || (
          <PageHeader title={title} subtitle={subtitle} onBack={requestClose} left={left} right={right} />
        )}
        {scroll ? (
          <div
            className={`km-scroll ${bodyClassName}`}
            style={{ flex: 1, paddingBottom: 'calc(var(--tabbar-clearance) + var(--safe-bottom) + 24px)', ...bodyStyle }}
          >
            {children}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', ...bodyStyle }} className={bodyClassName}>
            {children}
          </div>
        )}
      </div>
    </PanelCtx.Provider>,
    document.body,
  );
}
