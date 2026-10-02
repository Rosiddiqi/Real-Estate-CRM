// "Move {name} to Lost?" — the ONLY way a deal reaches Lost (RevMatch rule).
// Side-aware preset reasons + free text; the note stays on the card so the
// agent can see the pattern over time.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import { usePipelineConfig } from './config';

export default function LostReasonSheet({ deal, open, onClose, onConfirm }) {
  const { cfg } = usePipelineConfig();
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setPreset(null); setBusy(false); } }, [open]);
  if (!deal) return null;
  const presets = (cfg && (cfg.lostReasons[deal.side] || cfg.lostReasons.buyer)) || [];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Move ${deal.name || 'this deal'} to Lost?`}
      left={false}
      zIndex={520}
      footer={(
      <div className="km-pl-btnrow" style={{ marginTop: 0 }}>
        <button type="button" className="km-pl-btn km-press" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="km-pl-btn km-pl-btn--danger km-press"
          style={{ flex: 1.4 }}
          disabled={!reason || busy}
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(reason.trim()); } finally { setBusy(false); }
          }}
        >
          {busy ? 'Marking…' : 'Mark as Lost'}
        </button>
      </div>
      )}
    >
      <div className="km-pl-serena">
        <b>SERENA</b>
        Before I close this out — what happened? I’ll keep the note on the card so you can see the pattern over time.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {presets.map((r) => (
          <button
            key={r}
            type="button"
            className={`km-pl-reason km-press ${preset === r ? 'km-pl-reason--on' : ''}`}
            onClick={() => { setPreset(r); setReason(r); }}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        className="km-input"
        rows={3}
        value={reason}
        placeholder="Add detail (optional)"
        onChange={(e) => { setReason(e.target.value); setPreset(null); }}
        style={{ minHeight: 84 }}
      />
    </Sheet>
  );
}
