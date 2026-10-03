// Manage one scheduled message: preview, edit text, edit time, send now, delete.
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Icon from '../ui/Icon';
import { confirm } from '../ui/toast';
import ScheduleSheet from './ScheduleSheet';
import { scheduledCaption, serviceOf } from './threadUtils';

export default function ScheduledSheet({ item, initialAction, onClose, onUpdate, onCancel, onSendNow }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [retime, setRetime] = useState(false);
  const open = !!item;

  useEffect(() => {
    if (!item) return;
    setText(item.body || '');
    setEditing(initialAction === 'edit');
    setRetime(initialAction === 'retime');
  }, [item, initialAction]);

  if (!item) return null;
  const channel = serviceOf(item) === 'sms' ? 'sms' : 'imsg';

  const save = async () => {
    await onUpdate(item.id, { body: text });
    setEditing(false);
    onClose();
  };

  return (
    <>
      <Sheet open={open && !retime} onClose={onClose} title="Scheduled Message">
        <div className="km-card" style={{ padding: '14px 16px', marginTop: 4 }}>
          {editing ? (
            <textarea className="km-input" rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
          ) : (
            <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{item.body || '(attachment)'}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5, fontWeight: 500, color: channel === 'sms' ? 'var(--dim)' : 'var(--text)' }}>
            <Icon name="clock" size={13} stroke={2.2} />
            {scheduledCaption(item.scheduledFor).replace('Will be sent', 'Sends')}
          </div>
        </div>
        <div className="km-list" style={{ padding: 0, marginTop: 14 }}>
          {editing ? (
            <>
              <Action icon="check" label="Save Message" onClick={save} />
              <Action icon="x" label="Cancel Editing" onClick={() => { setEditing(false); setText(item.body || ''); }} last />
            </>
          ) : (
            <>
              <Action icon="edit" label="Edit Message" onClick={() => setEditing(true)} />
              <Action icon="clock" label="Edit Time" onClick={() => setRetime(true)} />
              <Action icon="send" label="Send Now" onClick={async () => { onClose(); await onSendNow(item.id); }} />
              <Action
                icon="trash"
                label="Delete"
                danger
                last
                onClick={async () => {
                  if (await confirm({ title: 'Delete this scheduled message?', confirmLabel: 'Delete Message', destructive: true })) {
                    onClose();
                    await onCancel(item.id);
                  }
                }}
              />
            </>
          )}
        </div>
      </Sheet>
      <ScheduleSheet
        open={open && retime}
        mode="edit"
        initial={item.scheduledFor}
        preview={item.body}
        channel={channel}
        onClose={() => { setRetime(false); if (initialAction === 'retime') onClose(); }}
        onConfirm={async (when) => { await onUpdate(item.id, { scheduledFor: when.toISOString() }); setRetime(false); onClose(); }}
      />
    </>
  );
}

function Action({ icon, label, onClick, danger, last }) {
  return (
    <button type="button" className="km-row km-press" onClick={onClick} style={{ width: '100%', padding: '14px 16px', textAlign: 'left', borderBottom: last ? 0 : undefined }}>
      <Icon name={icon} size={18} color={danger ? 'var(--red)' : 'var(--text)'} />
      <span style={{ flex: 1, fontSize: 15.5, fontWeight: 500, color: danger ? 'var(--red)' : 'var(--text)' }}>{label}</span>
    </button>
  );
}
