import { useState, useCallback, useRef, useEffect } from 'react';

// useSheetClose — delayed-unmount close for sheets/overlays.
//
// Nearly every sheet in the app animates IN but vanished instantly on
// close (plain conditional unmount — audit 2026-07-02 found ~20 of them).
// This hook keeps the element mounted while an exit animation plays, then
// fires the real onClose.
//
// Usage:
//   const { closing, requestClose } = useSheetClose(onClose);
//   <div onClick={requestClose}>                     // backdrop
//     <div style={{ animation: closing
//         ? 'km-sheet-out 0.22s cubic-bezier(.2,.8,.2,1) forwards'
//         : 'km-cc-in 0.28s cubic-bezier(.2,.9,.3,1) both' }}>
//
// Pair with the shared exit keyframes in styles/animations.css
// (km-cc-out / km-sheet-out / km-fade-out-soft). Under
// prefers-reduced-motion the close is immediate.
//
// `open` (optional): components that STAY MOUNTED across open/close
// cycles (they take an `open` prop and return null themselves) MUST pass
// it — reopening resets `closing`, otherwise the sheet would come back
// stuck on its exit frame (invisible).
export function useSheetClose(onClose, duration = 220, open = undefined) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (open) {
      clearTimeout(timerRef.current);
      setClosing(false);
    }
  }, [open]);

  const requestClose = useCallback(() => {
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* noop */ }
    if (reduced) {
      closeRef.current?.();
      return;
    }
    setClosing((was) => {
      if (was) return was; // already closing — don't restart the timer
      timerRef.current = setTimeout(() => { closeRef.current?.(); }, duration);
      return true;
    });
  }, [duration]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { closing, requestClose };
}

export default useSheetClose;
