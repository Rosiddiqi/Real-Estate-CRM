// Sheet — THE floating bottom sheet. Every pop-up in the app uses this.
// Encodes RevMatch's hard rules (#13 + #18 + sheet polish):
//  • floats ABOVE the 110px footer zone (tab bar always visible beneath)
//  • iOS-26 floating card: 8px side inset, all four corners rounded (24px),
//    hairline rim, soft drop shadow
//  • clears the keyboard (rises in lockstep via --keyboard-height) and is
//    internally scrollable; focused fields scroll into view
//  • spring rise in, eased drop out (never a hard unmount), drag-to-dismiss
//
//   <Sheet open={open} onClose={close} title="New showing"
//          left={{ label: 'Cancel' }} right={{ label: 'Save', onClick: save, disabled }}>
//     ...content...
//   </Sheet>
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSheetClose } from '../../hooks/useSheetClose';
import Icon from './Icon';
import { useOverlayDepth, sheetZ } from './depth';

let openCount = 0;

export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  left,            // { label, onClick } — defaults to Cancel → close
  right,           // { label, onClick, disabled, tone: 'danger' }
  children,
  footer,          // sticky footer node (e.g. primary button)
  maxWidth = 560,
  maxHeight = '85%',
  zIndex,
  padded = true,
  showGrabber = true,
  closeOnBackdrop = true,
  className = '',
}) {
  const [mounted, setMounted] = useState(open);
  // External close (parent flips open → false) animates out but must not call
  // onClose again; internal close (backdrop / Cancel / Esc / drag) does.
  const externalClose = useRef(false);
  const { closing, requestClose } = useSheetClose(() => {
    setMounted(false);
    if (!externalClose.current) onClose?.();
    externalClose.current = false;
  }, 240, open);
  const panelRef = useRef(null);
  const drag = useRef(null);
  const [dragY, setDragY] = useState(0);
  const z = sheetZ(useOverlayDepth(), zIndex);

  useEffect(() => { if (open) setMounted(true); }, [open]);

  useEffect(() => {
    if (!mounted) return undefined;
    openCount += 1;
    document.body.classList.add('km-sheet-open');
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      openCount = Math.max(0, openCount - 1);
      if (!openCount) document.body.classList.remove('km-sheet-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted, requestClose]);

  // Parent flipped open → false: animate out instead of vanishing.
  useEffect(() => {
    if (!open && mounted && !closing) { externalClose.current = true; requestClose(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  const onFocusCapture = (e) => {
    const t = e.target;
    if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    setTimeout(() => { try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ } }, 300);
  };

  // Drag-to-dismiss from the grabber/header zone. Pointer capture only starts
  // after real downward movement and never from a control — capturing on
  // pointerdown would retarget the click away from the header buttons.
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('button, input, textarea, select, a')) return;
    drag.current = { y: e.clientY, last: e.clientY, lastT: e.timeStamp, active: false, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (dy < 6) return;
      d.active = true;
      try { e.currentTarget.setPointerCapture?.(d.id); } catch { /* ignore */ }
    }
    d.v = (e.clientY - d.last) / Math.max(1, e.timeStamp - d.lastT);
    d.last = e.clientY; d.lastT = e.timeStamp;
    setDragY(Math.max(0, dy));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.active) return;
    if (dragY > 110 || (d.v || 0) > 0.9) requestClose();
    setDragY(0);
  };

  const leftAction = left === false ? null : (left || { label: 'Cancel' });

  return createPortal(
    <div
      className="km-sheet-backdrop"
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) requestClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: z,
        background: 'var(--scrim)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        overflow: 'hidden',
        paddingTop: 'calc(var(--safe-top) + 20px)',
        paddingBottom: 'max(calc(var(--tabbar-clearance) + var(--safe-bottom)), calc(var(--keyboard-height) + 8px))',
        transition: 'padding-bottom 0.25s var(--km-kb-ease)',
        animation: closing ? 'km-fade-out-soft 0.24s ease forwards' : 'km-dim-in 0.26s ease both',
      }}
    >
      <div
        ref={panelRef}
        data-km-sheet=""
        className={`km-sheet ${className}`}
        onFocusCapture={onFocusCapture}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{
          width: 'calc(100% - 16px)',
          maxWidth,
          margin: '0 auto',
          maxHeight,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: 'var(--hairline) solid var(--glass-line)',
          borderRadius: 'var(--r-sheet)',
          boxShadow: 'var(--shadow-sheet)',
          overflow: 'hidden',
          transform: dragY ? `translate3d(0, ${dragY}px, 0)` : undefined,
          transition: dragY ? 'none' : 'transform 0.3s var(--km-ease)',
          animation: closing
            ? 'km-sheet-out 0.24s var(--km-ease) forwards'
            : 'km-sheet-in 0.42s var(--km-spring) both',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ flexShrink: 0, touchAction: 'none', cursor: showGrabber ? 'grab' : undefined }}
        >
          {showGrabber ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--ghost)' }} />
            </div>
          ) : null}
          {(title || leftAction || right) ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '8px 16px 10px' }}>
              <div style={{ justifySelf: 'start' }}>
                {leftAction ? (
                  <button
                    type="button"
                    onClick={leftAction.onClick || requestClose}
                    style={{ fontSize: 15, color: 'var(--dim)', padding: '6px 2px', fontWeight: 400 }}
                  >
                    {leftAction.label}
                  </button>
                ) : null}
              </div>
              <div style={{ textAlign: 'center', minWidth: 0 }}>
                {title ? <div className="km-page-title km-truncate">{title}</div> : null}
                {subtitle ? <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }} className="km-truncate">{subtitle}</div> : null}
              </div>
              <div style={{ justifySelf: 'end' }}>
                {right ? (
                  <button
                    type="button"
                    onClick={right.onClick}
                    disabled={right.disabled}
                    style={{
                      fontSize: 15, fontWeight: 500, padding: '6px 2px',
                      color: right.tone === 'danger' ? 'var(--red)' : 'var(--text)',
                      opacity: right.disabled ? 0.35 : 1,
                    }}
                  >
                    {right.label}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="km-scroll" style={{ flex: 1, padding: padded ? '4px 16px 20px' : 0 }}>
          {typeof children === 'function' ? children({ close: requestClose }) : children}
        </div>
        {footer ? (
          <div style={{ flexShrink: 0, padding: '12px 16px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
            {typeof footer === 'function' ? footer({ close: requestClose }) : footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

// Close button for custom sheet headers.
export function SheetClose({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="km-icon-btn km-icon-btn--sm" style={{ background: 'var(--lg-fill)' }} aria-label="Close">
      <Icon name="x" size={16} />
    </button>
  );
}
