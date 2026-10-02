// Overlay depth: AppShell wraps the Nth overlay in <OverlayDepth.Provider value={N}>.
// PushPanel / Sheet derive their z-index from it so a deeper overlay is always
// above the one that opened it (explicit zIndex props are treated as minimums).
import { createContext, useContext } from 'react';

export const OverlayDepth = createContext(0);
export const useOverlayDepth = () => useContext(OverlayDepth);
export const panelZ = (depth, min = 0) => Math.max(min, 200 + depth * 20);
export const sheetZ = (depth, min = 0) => Math.max(min, 210 + depth * 20);
