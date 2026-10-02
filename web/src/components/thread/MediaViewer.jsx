// Full-screen in-app viewer (photos page through the thread; video plays with
// native controls). Drag down to dismiss, swipe sideways to page, double-tap
// to zoom, Esc / ← / → on desktop. Never kicks the user out to a browser tab.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mediaUrl } from '../../api/client';
import Icon from '../ui/Icon';

export default function MediaViewer({ items, index = 0, onClose }) {
  const [i, setI] = useState(index);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [zoom, setZoom] = useState(1);
  const start = useRef(null);
  const lastTap = useRef(0);
  const item = items[i] || items[0];

  const close = useCallback(() => onClose && onClose(), [onClose]);
  const go = useCallback((d) => { setZoom(1); setI((v) => Math.max(0, Math.min(items.length - 1, v + d))); }, [items.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, go]);

  const onDown = (e) => {
    if (item && item.kind === 'video' && e.target.tagName === 'VIDEO') return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e) => {
    if (!start.current || zoom > 1) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };
  const onUp = (e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    setDrag({ x: 0, y: 0, active: false });
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const now = Date.now();
      if (now - lastTap.current < 300 && item && item.kind !== 'video') { setZoom((z) => (z > 1 ? 1 : 2.5)); lastTap.current = 0; }
      else lastTap.current = now;
      return;
    }
    if (zoom > 1) return;
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) close();
    else if (dx < -55 && Math.abs(dx) > Math.abs(dy)) go(1);
    else if (dx > 55 && Math.abs(dx) > Math.abs(dy)) go(-1);
  };

  if (!item) return null;
  const vertical = Math.abs(drag.y) > Math.abs(drag.x);
  const fade = drag.active && vertical ? Math.max(0.3, 1 - Math.abs(drag.y) / 500) : 1;
  const transform = zoom > 1
    ? `scale(${zoom})`
    : drag.active ? (vertical ? `translate3d(0, ${drag.y}px, 0) scale(${Math.max(0.85, 1 - Math.abs(drag.y) / 1200)})` : `translate3d(${drag.x}px, 0, 0)`) : 'none';

  return createPortal(
    <div
      className="km-viewer"
      style={{ background: `rgba(0,0,0,${fade})` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { start.current = null; setDrag({ x: 0, y: 0, active: false }); }}
    >
      <div className="km-viewer-top" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="km-lg km-lg--clear km-lg--dim km-press" onClick={close} aria-label="Close" style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Icon name="x" size={19} stroke={2.2} />
        </button>
        {items.length > 1 ? <span className="km-viewer-count km-lg km-lg--clear km-lg--dim">{i + 1} / {items.length}</span> : <span />}
        <a className="km-lg km-lg--clear km-lg--dim km-press" href={mediaUrl(item.url)} download target="_blank" rel="noopener noreferrer" aria-label="Save" style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Icon name="download" size={18} stroke={2.1} />
        </a>
      </div>
      {item.kind === 'video' ? (
        <video key={item.url} src={mediaUrl(item.url)} controls playsInline style={{ transform }} />
      ) : (
        <img key={item.url} src={mediaUrl(item.url)} alt={item.fileName || 'Photo'} draggable={false} style={{ transform, transition: drag.active ? 'none' : undefined }} />
      )}
    </div>,
    document.body,
  );
}
