// LinkSheet — link a household / circle member (spouse, partner, assistant,
// family office…) to this client. Both cards show the link.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import Avatar from '../ui/Avatar';
import { ChipSelect, TextInput } from '../ui/kit';
import { toast } from '../ui/toast';
import { addLink } from '../../api/clients';
import ClientPicker from './ClientPicker';
import { RELATIONS, displayName } from './clientKit';

export default function LinkSheet({ client, open, onClose, onLinked }) {
  const [relation, setRelation] = useState('spouse');
  const [other, setOther] = useState(null);
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setRelation('spouse'); setOther(null); setNote(''); } }, [open]);
  const exclude = [client.id, ...((client.links || []).map((l) => l.client.id))];

  const save = async (close) => {
    if (!other || saving) return;
    setSaving(true);
    try {
      await addLink(client.id, { relatedClientId: other.id, relation, notes: note.trim() || null });
      toast.success(`Linked ${displayName(other)}`);
      onLinked?.();
      close();
    } catch (e) { toast.error(e.message || 'Couldn’t link'); }
    setSaving(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Link someone" zIndex={450}>
      {({ close }) => (
        <div style={{ paddingBottom: 6 }}>
          <span className="kc-eyebrow" style={{ display: 'block', margin: '4px 2px 8px' }}>{displayName(client)}’s…</span>
          <ChipSelect multi={false} options={RELATIONS} value={[relation]} onChange={(v) => setRelation(v[0] || relation)} />
          <span className="kc-eyebrow" style={{ display: 'block', margin: '18px 2px 8px' }}>Who</span>
          {other ? (
            <div className="kc-dupe" style={{ background: 'var(--tint)', borderColor: 'rgba(var(--accent-rgb), 0.35)', marginTop: 0 }}>
              <Avatar name={displayName(other)} seed={other.id} src={other.avatarUrl} size={30} />
              <span style={{ flex: 1, fontWeight: 500 }}>{displayName(other)}</span>
              <button type="button" className="kc-link" onClick={() => setPick(true)}>Change</button>
            </div>
          ) : (
            <button type="button" className="km-pill km-press" onClick={() => setPick(true)}><Icon name="search" size={14} /> Choose a person</button>
          )}
          <TextInput style={{ marginTop: 14 }} label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Handles the paperwork" />
          <button type="button" className="km-btn km-btn--block km-btn--lg" style={{ marginTop: 18 }} disabled={!other || saving} onClick={() => save(close)}>
            {saving ? 'Linking…' : 'Link'}
          </button>
          <ClientPicker open={pick} onClose={() => setPick(false)} onPick={setOther} title="Choose a person" exclude={exclude} />
        </div>
      )}
    </Sheet>
  );
}
