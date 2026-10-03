// Inbox pop-ups: row actions (long-press / right-click), the iOS "Delete
// Conversation?" alert, and the Recently Deleted / Blocked lists.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Sheet from '../ui/Sheet';
import Avatar from '../ui/Avatar';
import { Group, Row, Spinner, EmptyState } from '../ui/kit';
import { toast } from '../ui/toast';
import { listConversations } from '../../api/conversations';
import { useOverlayDepth, sheetZ } from '../ui/depth';
import { convName, fmtInboxTime, isUnnamed, isUnread, previewOf } from './inboxUtils';
import { inbox } from './useInbox';

export function RowActionsSheet({ conv, onClose, onOpen, onOpenCard, onDelete }) {
  const open = !!conv;
  const [shown, setShown] = useState(conv);
  useEffect(() => { if (conv) setShown(conv); }, [conv]);
  const c = conv || shown;
  if (!c) return null;
  const unread = isUnread(c);
  const act = (fn) => () => { onClose(); setTimeout(fn, 120); };
  return (
    <Sheet open={open} onClose={onClose} title={convName(c)} left={false} right={{ label: 'Done', onClick: onClose }}>
      <Group>
        <Row icon="message" title="Open Conversation" onClick={act(() => onOpen(c))} />
        <Row icon={unread ? 'checkCircle' : 'circle'} title={unread ? 'Mark as Read' : 'Mark as Unread'} onClick={act(() => (unread ? inbox.markRead(c.id) : inbox.markUnread(c.id)))} />
        <Row icon="pin" title={c.pinned ? 'Unpin' : 'Pin'} onClick={act(() => inbox.setPinned(c.id, !c.pinned))} />
        <Row icon="bell" iconBg="rgba(255, 180, 64, 0.16)" iconColor="var(--amber)" title={c.muted ? 'Show Alerts' : 'Hide Alerts'} onClick={act(() => inbox.setMuted(c.id, !c.muted))} />
        {c.clientId ? <Row icon="user" title="Client Card" chevron onClick={act(() => onOpenCard(c))} style={{ borderBottom: 0 }} /> : null}
      </Group>
      <Group style={{ marginTop: 14 }}>
        <Row icon="shield" iconBg="rgba(255, 107, 94, 0.14)" iconColor="var(--red)" danger title="Block" onClick={act(() => inbox.block(c))} />
        <Row icon="trash" iconBg="rgba(255, 107, 94, 0.14)" iconColor="var(--red)" danger title="Delete Conversation" onClick={act(() => onDelete(c))} style={{ borderBottom: 0 }} />
      </Group>
    </Sheet>
  );
}

// Centered iOS alert (RevMatch delete confirmation).
export function DeleteAlert({ conv, onCancel, onConfirm }) {
  const z = sheetZ(useOverlayDepth()) + 5;
  useEffect(() => {
    if (!conv) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onConfirm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conv, onCancel, onConfirm]);
  if (!conv) return null;
  return createPortal(
    <div className="km-ialert-root" style={{ zIndex: z }} onClick={onCancel}>
      <div className="km-ialert" role="alertdialog" aria-modal="true" aria-labelledby="km-ialert-t" onClick={(e) => e.stopPropagation()}>
        <div className="km-ialert-body">
          <div id="km-ialert-t" className="km-ialert-title">Delete Conversation?</div>
          <div className="km-ialert-msg">
            {convName(conv)}
            <br />
            It’s removed from your inbox — find it in Recently Deleted. The client keeps every message on their phone.
          </div>
        </div>
        <div className="km-ialert-btns">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="km-ialert-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const LIST_COPY = {
  archived: {
    title: 'Recently Deleted',
    action: 'Restore',
    patch: { archived: false },
    empty: ['No deleted conversations', 'Swipe left on a conversation and tap Delete — it lands here, ready to restore.'],
    done: 'Restored to your inbox',
  },
  blocked: {
    title: 'Blocked',
    action: 'Unblock',
    patch: { blocked: false },
    empty: ['No blocked numbers', 'Blocked threads stop notifying you. Blocking never deletes messages.'],
    done: 'Unblocked',
  },
};

export function ConversationListSheet({ kind, onClose, onOpen }) {
  const copy = LIST_COPY[kind] || LIST_COPY.archived;
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!kind) return undefined;
    let alive = true;
    setRows(null);
    listConversations({ tab: 'all', limit: 200, ...(kind === 'blocked' ? { blocked: 1 } : { archived: 1 }) })
      .then((r) => { if (alive) setRows((r && r.conversations) || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [kind]);

  const restore = async (c) => {
    setBusy(c.id);
    try {
      await inbox.restore(c, copy.patch);
      setRows((xs) => (xs || []).filter((x) => x.id !== c.id));
      toast.success(copy.done);
    } catch {
      toast.error('Couldn’t restore — try again');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={!!kind} onClose={onClose} title={copy.title} left={false} right={{ label: 'Done', onClick: onClose }}>
      {rows === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
      ) : !rows.length ? (
        <EmptyState icon={kind === 'blocked' ? 'shield' : 'trash'} title={copy.empty[0]} sub={copy.empty[1]} />
      ) : (
        <Group>
          {rows.map((c, i) => (
            <div key={c.id} className="km-ilist-row" style={i === rows.length - 1 ? { borderBottom: 0 } : undefined}>
              <button type="button" className="km-ilist-main km-press" onClick={() => kind === 'archived' && onOpen ? (onClose(), setTimeout(() => onOpen(c), 160)) : null}>
                <Avatar name={isUnnamed(c) ? '' : convName(c)} seed={c.clientId || c.handle} src={c.client && c.client.avatarUrl} size={40} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{convName(c)}</span>
                  <span className="km-truncate" style={{ display: 'block', fontSize: 12.5, color: 'var(--faint)', marginTop: 2 }}>
                    {kind === 'blocked' ? `Blocked · ${fmtInboxTime(c.updatedAt)}` : `${fmtInboxTime(c.lastMessageAt)} · ${previewOf(c)}`}
                  </span>
                </span>
              </button>
              <button type="button" className="km-ilist-pill km-press" disabled={busy === c.id} onClick={() => restore(c)}>
                {busy === c.id ? '…' : copy.action}
              </button>
            </div>
          ))}
        </Group>
      )}
    </Sheet>
  );
}
