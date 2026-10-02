// Composer drafts — a composed message is NEVER lost (RevMatch hard rule).
// One draft per thread key: { t: text, a: attachments, l: listing, s: service, at }.
// Pruned after 30 days / capped at 200 entries. All storage access guarded.
const PREFIX = 'km_draft_';
const MAX_AGE = 30 * 864e5;
const CAP = 200;

const empty = () => ({ text: '', attachments: [], listing: null, service: null });

export function loadDraft(key) {
  if (!key) return empty();
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return empty();
    const d = JSON.parse(raw);
    if (!d || (d.at && Date.now() - d.at > MAX_AGE)) return empty();
    return {
      text: typeof d.t === 'string' ? d.t : '',
      attachments: Array.isArray(d.a) ? d.a : [],
      listing: d.l || null,
      service: d.s || null,
    };
  } catch {
    return empty();
  }
}

export function saveDraft(key, draft) {
  if (!key) return;
  try {
    const text = (draft && draft.text) || '';
    const atts = (draft && draft.attachments) || [];
    const listing = (draft && draft.listing) || null;
    if (!text.trim() && !atts.length && !listing) {
      localStorage.removeItem(PREFIX + key);
      return;
    }
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: text, a: atts, l: listing, s: draft.service || null, at: Date.now() }));
    prune();
  } catch {
    try { prune(100); } catch { /* storage unavailable */ }
  }
}

export function clearDraft(key) {
  if (!key) return;
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

let lastPrune = 0;
function prune(cap = CAP) {
  if (Date.now() - lastPrune < 60_000 && cap === CAP) return;
  lastPrune = Date.now();
  const rows = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try { rows.push({ k, at: JSON.parse(localStorage.getItem(k)).at || 0 }); } catch { rows.push({ k, at: 0 }); }
  }
  rows.sort((a, b) => b.at - a.at);
  rows.forEach((r, i) => {
    if (i >= cap || Date.now() - r.at > MAX_AGE) localStorage.removeItem(r.k);
  });
}

// Does a thread have a pending draft? (inbox rows show "Draft:" like iMessage)
export function hasDraft(key) {
  const d = loadDraft(key);
  return !!(d.text.trim() || d.attachments.length || d.listing);
}
