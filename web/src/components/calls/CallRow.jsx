// CallRow — one recents row (RevMatch CallRow): avatar, name (or formatted
// number), direction glyph + Incoming/Outgoing/Missed · duration or summary,
// time; ⓘ opens the client card, "+ Save" for unknown numbers. Tapping the
// row calls back.
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { classify, callName, DirectionGlyph, fmtDur, KIND_LABEL, shortTime } from './callUtil';

export default function CallRow({ call, onCall, onInfo, onSave, index = 0 }) {
  const kind = classify(call);
  const name = callName(call);
  const missed = kind === 'missed';
  const detail = call.summary && kind !== 'missed' ? call.summary : (fmtDur(call.durationSec) || (call.status === 'cancelled' ? 'Cancelled' : call.status === 'no_answer' && call.direction === 'outbound' ? 'No answer' : null));
  return (
    <div className="km-ph-row km-row-in" data-row-id={call.id} style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}>
      <button type="button" className="km-ph-row-main km-press" onClick={() => onCall(call)} aria-label={`Call ${name}`}>
        <Avatar name={call.client ? name : null} seed={call.clientId || call.otherNumber} src={call.client?.avatarUrl} size={44} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className={`km-ph-name km-truncate ${missed ? 'km-ph-name--missed' : ''}`} style={{ display: 'block' }}>
            {name}
            {call.client?.isWhale ? <Icon name="crown" size={12} color="var(--amber)" stroke={2} style={{ marginLeft: 6, verticalAlign: '-1px' }} /> : null}
          </span>
          <span className="km-ph-meta">
            <DirectionGlyph kind={kind} />
            <span className="km-truncate">{[KIND_LABEL[kind], detail].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      </button>
      <div className="km-ph-right">
        {call.clientId ? (
          <button type="button" className="km-ph-info" onClick={() => onInfo(call)} aria-label={`${name} details`}>
            <Icon name="info" size={21} stroke={1.9} />
          </button>
        ) : call.otherNumber ? (
          <button type="button" className="km-ph-save" onClick={() => onSave(call)}>+ Save</button>
        ) : null}
        <span className="km-ph-time">{shortTime(call.startedAt)}</span>
      </div>
    </div>
  );
}
