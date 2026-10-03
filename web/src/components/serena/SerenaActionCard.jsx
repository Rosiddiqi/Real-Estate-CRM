// SerenaActionCard — the receipt for something Serena DID (RevMatch
// SerenaActionCard): category accent rail, eyebrow, title, meta, one-tap Undo
// and Open →. Undone cards strike through and lose their buttons.
import Icon from '../ui/Icon';
import { Spinner } from '../ui/kit';
import { serena } from './serenaStore';

const CATS = {
  calendar: { accent: 'var(--srn-violet)', icon: 'calendar' },
  todo: { accent: 'var(--text)', icon: 'checklist' },
  note: { accent: 'var(--green)', icon: 'file' },
  contact: { accent: 'var(--green)', icon: 'user' },
  search: { accent: 'var(--text)', icon: 'target' },
  portfolio: { accent: 'var(--cyan)', icon: 'house' },
  pipeline: { accent: 'var(--text)', icon: 'pipeline' },
  call: { accent: 'var(--green)', icon: 'phone' },
  memory: { accent: 'var(--srn-violet)', icon: 'sparkle' },
  drafts: { accent: 'var(--srn-violet)', icon: 'message' },
};

export default function SerenaActionCard({ card, onOpen }) {
  const cat = CATS[card.category] || { accent: 'var(--dim)', icon: 'check' };
  const undone = !!card.undone;
  const canOpen = !!card.open && !undone;
  return (
    <div className={`km-srn-card ${undone ? 'is-undone' : ''}`} style={{ '--accent': cat.accent }}>
      <div className="km-srn-card-head">
        <span className="km-srn-card-chip"><Icon name={undone ? 'undo' : cat.icon} size={13} stroke={2.2} /></span>
        <span className="km-srn-card-eyebrow km-truncate">{undone ? `Undone · ${String(card.label || card.category || '').split(' · ')[0]}` : (card.label || card.category)}</span>
        {!undone ? <Icon name="checkCircle" size={18} color="var(--accent)" stroke={2} /> : null}
      </div>
      <div className="km-srn-card-title km-selectable">{card.title}</div>
      {card.meta ? <div className="km-srn-card-meta km-selectable">{card.meta}</div> : null}
      {card.undoError ? <div className="km-srn-err">Undo failed: {card.undoError}</div> : null}
      {!undone && (card.undoable || canOpen) ? (
        <div className="km-srn-card-actions">
          {card.undoable ? (
            <button type="button" className="km-srn-ghost" disabled={card.undoing} onClick={() => serena.undo(card.id)}>
              {card.undoing ? <Spinner size={12} /> : <Icon name="undo" size={13} stroke={2.2} />}
              {card.undoing ? 'Undoing…' : 'Undo'}
            </button>
          ) : null}
          {canOpen ? (
            <button type="button" className="km-srn-ghost km-srn-ghost--blue" onClick={() => onOpen?.(card.open)}>
              Open <Icon name="arrowRight" size={13} stroke={2.2} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
