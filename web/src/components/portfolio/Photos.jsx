// PhotoStrip (add / remove / tap-to-make-cover, uploads via /api/media/upload)
// and PhotoLightbox (fullscreen scroll-snap pager) — RevMatch garage photos.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { toast } from '../ui/toast';
import { mediaUrl } from '../../api/client';
import { uploadFiles } from '../../api/system';

// An <img> that degrades to a quiet tile when the photo can't load (offline,
// expired link, blocked host) instead of the browser's broken-image glyph.
export function SafeImg({ src, alt = '', ...rest }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  if (bad || !src) return <span className="kc-img-fallback" aria-hidden="true"><Icon name="image" size={18} color="var(--faint)" /></span>;
  return <img src={src} alt={alt} onError={() => setBad(true)} {...rest} />;
}

export function PhotoStrip({ photos = [], onChange, label = 'Photos', hint }) {
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const add = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const up = await uploadFiles(files);
      onChange([...photos, ...up.map((u) => u.url).filter(Boolean)]);
    } catch (err) {
      toast.error(err.message || 'Couldn’t upload — try again.');
    }
    setBusy(false);
  };
  return (
    <div>
      {label ? <div className="kc-eyebrow" style={{ margin: '0 2px 8px' }}>{label}</div> : null}
      <div className="kc-photostrip" data-hscroll="">
        <button type="button" className="kc-thumb kc-thumb--add km-press" onClick={() => input.current?.click()} disabled={busy} aria-label="Add photos">
          {busy ? <Spinner size={18} /> : <Icon name="camera" size={20} stroke={2} />}
          {busy ? 'UPLOADING' : '+ ADD'}
        </button>
        {photos.map((u, i) => (
          <div key={u} className="kc-thumb" style={i === 0 ? { boxShadow: '0 0 0 1.5px var(--blue)' } : undefined}>
            <button type="button" onClick={() => i && onChange([u, ...photos.filter((x) => x !== u)])} aria-label={i ? 'Make cover photo' : 'Cover photo'} style={{ width: '100%', height: '100%', display: 'block' }}>
              <SafeImg src={mediaUrl(u)} loading="lazy" />
            </button>
            <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', padding: '2px 5px', borderRadius: 5, background: i === 0 ? 'var(--blue)' : 'rgba(0,0,0,0.55)', color: '#fff', pointerEvents: 'none' }}>{i === 0 ? 'COVER' : 'TAP = COVER'}</span>
            <button type="button" className="kc-thumb-x" onClick={() => onChange(photos.filter((x) => x !== u))} aria-label="Remove photo"><Icon name="x" size={11} stroke={2.6} /></button>
          </div>
        ))}
      </div>
      {hint ? <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>{hint}</div> : null}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={add} />
    </div>
  );
}

export function PhotoLightbox({ photos, index = 0, onClose }) {
  const ref = useRef(null);
  const [i, setI] = useState(index);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.clientWidth * index;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && el) el.scrollBy({ left: el.clientWidth, behavior: 'smooth' });
      if (e.key === 'ArrowLeft' && el) el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="kc-lightbox" role="dialog" aria-label="Photos">
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 12px)', left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 14px', zIndex: 2 }}>
        <span className="km-lg km-lg--clear km-lg--dim" style={{ padding: '5px 12px', borderRadius: 999, fontSize: 13, color: '#fff' }}>{i + 1} of {photos.length}</span>
        <button type="button" className="km-lg km-lg--clear km-lg--dim" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Icon name="x" size={20} stroke={2.2} />
        </button>
      </div>
      <div ref={ref} className="kc-carousel" onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((u) => <div key={u} style={{ height: '100%' }}><SafeImg src={mediaUrl(u)} /></div>)}
      </div>
    </div>,
    document.body,
  );
}
