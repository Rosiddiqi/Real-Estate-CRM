// Stage dropdown — the alternative to drag. Lists the stages of the deal's
// side (or the New Dev lane) with side-specific labels, then Lost (which
// opens the reasons sheet instead of moving).
import { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import { StageDot } from './bits';
import { colorFor, labelFor, stagesFor } from './config';

export default function StageDropdown({ deal, cfg, onChange, onLost, direction = 'up' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [open]);
  if (!cfg) return null;
  const list = stagesFor(cfg, { side: deal.side, track: deal.track });
  const cur = labelFor(cfg, deal.stage, deal.side);
  return (
    <div className="km-pl-stagewrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="km-pl-stagebtn km-press" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <StageDot color={colorFor(cfg, deal.stage)} />
          <span className="km-truncate">{cur.label}</span>
          <span className="km-truncate" style={{ color: 'var(--faint)', fontSize: 11 }}>· {cur.sub}</span>
        </span>
        <Icon name={open ? (direction === 'up' ? 'chevronDown' : 'chevronUp') : (direction === 'up' ? 'chevronUp' : 'chevronDown')} size={13} color="var(--faint)" />
      </button>
      {open ? (
        <div className={`km-pl-stagemenu ${direction === 'down' ? 'km-pl-stagemenu--down' : ''}`} role="listbox">
          {list.map((s) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={s.key === deal.stage}
              className={`km-pl-stagerow ${s.key === deal.stage ? 'km-pl-stagerow--on' : ''}`}
              onClick={() => { setOpen(false); if (s.key !== deal.stage) onChange(s.key); }}
            >
              <StageDot color={s.color} />
              <span style={{ fontWeight: s.key === deal.stage ? 500 : 400 }}>{s.label}</span>
              <span className="km-truncate" style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 'auto' }}>{s.sub}</span>
              {s.key === 'closed' ? <Icon name="key" size={12} color="var(--green)" /> : null}
            </button>
          ))}
          {deal.stage !== 'lost' ? (
            <button type="button" className="km-pl-stagerow km-pl-stagerow--lost" onClick={() => { setOpen(false); onLost(); }}>
              <StageDot color={cfg.lost.color} />
              <span style={{ fontWeight: 500 }}>Lost</span>
              <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 'auto' }}>Asks why first</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
