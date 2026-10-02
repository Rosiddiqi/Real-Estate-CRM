// Subscribe to realtime events for the lifetime of a component.
//
//   useSocket('message_received', (payload) => {...});
//   useSocket(['deal_updated', 'deal_created'], refetch);
//   useResync(refetch);   // silent refetch after reconnect / app foreground
import { useEffect, useRef, useState } from 'react';
import { ws } from '../api/ws';

export function useSocket(events, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(events) ? events.join('|') : events;
  useEffect(() => {
    const names = key.split('|').filter(Boolean);
    const offs = names.map((name) => ws.on(name, (payload, raw) => ref.current && ref.current(payload, raw, name)));
    return () => offs.forEach((off) => off());
  }, [key]);
}

export function useResync(handler) {
  useSocket('resync', handler);
}

export function useSocketStatus() {
  const [status, setStatus] = useState(ws.status);
  useEffect(() => ws.on('status', setStatus), []);
  return status;
}

export default useSocket;
