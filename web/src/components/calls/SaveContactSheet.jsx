// SaveContactSheet — turn an unknown caller into a client (RevMatch
// SaveContactSheet). Every earlier call from the number is linked to them.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import { TextInput, ChipSelect, Field } from '../ui/kit';
import { toast } from '../ui/toast';
import { api } from '../../api/client';
import { formatPhone } from '../../lib/format';

const TYPES = [
  { value: 'buyer', label: 'Buyer' }, { value: 'seller', label: 'Seller' }, { value: 'investor', label: 'Investor' },
  { value: 'renter', label: 'Renter' }, { value: 'sphere', label: 'Sphere' },
];

export default function SaveContactSheet({ open, phone, onClose, onSaved }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [type, setType] = useState(['buyer']);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFirst(''); setLast(''); setType(['buyer']); } }, [open]);

  const save = async () => {
    if (!first.trim() || busy) return;
    setBusy(true);
    try {
      const { client } = await api.post('/calls/save-contact', { phone, firstName: first.trim(), lastName: last.trim(), type: type[0] || 'buyer' });
      toast.success(`${first.trim()} saved`);
      onSaved?.(client);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Couldn’t save the contact');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Save contact" right={{ label: busy ? 'Saving…' : 'Save', onClick: save, disabled: !first.trim() || busy }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
        <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums', padding: '4px 0 2px' }}>{formatPhone(phone)}</div>
        <div className="km-field-row">
          <TextInput label="First name" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus placeholder="Required" />
          <TextInput label="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        <Field label="They are a">
          <ChipSelect options={TYPES} value={type} onChange={(v) => setType(v.length ? v : type)} multi={false} />
        </Field>
        <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Earlier calls from this number move onto their timeline.</div>
      </div>
    </Sheet>
  );
}
