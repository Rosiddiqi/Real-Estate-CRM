// "Parse my ICA" — read an independent-contractor agreement (pasted text, a
// PDF or a photo) into pay-plan terms. AI is a co-pilot here: the result is a
// DRAFT the agent reviews in the Pay Plan sheet before saving. Without AI (no
// key, budget, outage) a deterministic text parser pulls the common terms.
const fs = require('node:fs');
const path = require('node:path');
const ai = require('../../ai/claude');
const config = require('../../config');

const n = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  properties: {
    brokerage: n('string'),
    office: n('string'),
    role: n('string'),
    planType: { type: 'string', enum: ['split_cap', 'tiered', 'flat_fee', '100pct'] },
    agentSplit: n('number'),
    capAmount: n('number'),
    capAnniversary: n('string'),
    postCapSplit: n('number'),
    transactionFee: n('number'),
    postCapTransactionFee: n('number'),
    franchisePct: n('number'),
    franchiseCap: n('number'),
    teamLeadPct: n('number'),
    defaultBuyerRate: n('number'),
    defaultListingRate: n('number'),
    tiers: { type: 'array', items: { type: 'object', properties: { fromGci: { type: 'number' }, agentSplit: { type: 'number' } } } },
    summary: { type: 'string' },
  },
};

const SYSTEM = `You read real-estate agent independent-contractor agreements (ICAs) and brokerage commission schedules and extract the agent's pay plan.
Return JSON only, matching the schema. Conventions:
- Splits and percentages are FRACTIONS: a 70/30 split in the agent's favor → agentSplit 0.7; a 6% royalty → franchisePct 0.06; 2.5% commission → 0.025.
- capAmount is the annual company-dollar cap in whole dollars; capAnniversary is "MM-DD" (the date the cap year resets), or null.
- postCapSplit is the agent's share after capping (usually 1). Fees are whole dollars per transaction.
- planType: split_cap (split until a cap), tiered (split steps up by GCI → fill tiers [{fromGci, agentSplit}]), flat_fee (flat fee per deal, no split), 100pct (agent keeps 100%, pays fees).
- defaultBuyerRate / defaultListingRate only if the document states typical commission rates; else null.
- Use null for anything the document does not state. Never guess numbers.
- summary: one plain sentence describing the plan.`;

function num(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : null;
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Deterministic fallback: common phrasings in ICAs / commission schedules.
function heuristicParse(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const draft = {};
  const found = [];
  let m = /(\d{2,3})\s*\/\s*(\d{1,2})\s*(?:commission\s+)?split/i.exec(t) || /split\D{0,20}(\d{2,3})\s*\/\s*(\d{1,2})/i.exec(t);
  if (m) { draft.agentSplit = Number(m[1]) / 100; found.push('agentSplit'); }
  if (draft.agentSplit == null) {
    m = /agent\D{0,40}(?:receive|retain|keep|split)s?\D{0,20}(\d{2,3}(?:\.\d+)?)\s*%/i.exec(t);
    if (m) { draft.agentSplit = Number(m[1]) / 100; found.push('agentSplit'); }
  }
  m = /(?:annual\s+)?cap(?:ped)?(?:\s+(?:of|at|is|amount))?\D{0,25}\$\s?([\d,]{3,})/i.exec(t);
  if (m) { draft.capAmount = num(m[1]); found.push('capAmount'); }
  m = /(?:after|once|post)[\s-]+(?:the\s+)?cap[^.]{0,80}?\$\s?([\d,]+)/i.exec(t);
  if (m) { draft.postCapTransactionFee = num(m[1]); found.push('postCapTransactionFee'); }
  m = /transaction\s+fee\D{0,25}\$\s?([\d,]+)/i.exec(t);
  if (m) { draft.transactionFee = num(m[1]); found.push('transactionFee'); }
  m = /(?:royalty|franchise)(?:\s+fee)?\D{0,25}(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
  if (m) { draft.franchisePct = Number(m[1]) / 100; found.push('franchisePct'); }
  m = /(?:royalty|franchise)[^.]{0,100}?cap(?:ped)?\D{0,20}\$\s?([\d,]+)/i.exec(t);
  if (m) { draft.franchiseCap = num(m[1]); found.push('franchiseCap'); }
  m = new RegExp(`anniversary[^.]{0,60}?(${MONTHS.join('|')})\\s+(\\d{1,2})`, 'i').exec(t);
  if (m) {
    draft.capAnniversary = `${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    found.push('capAnniversary');
  } else {
    m = /anniversary[^.]{0,40}?(\d{1,2})\/(\d{1,2})/i.exec(t);
    if (m) { draft.capAnniversary = `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; found.push('capAnniversary'); }
  }
  m = /team\D{0,30}(\d{1,2})\s*%/i.exec(t);
  if (m) { draft.teamLeadPct = Number(m[1]) / 100; found.push('teamLeadPct'); }
  m = /(eXp|Compass|Douglas Elliman|Sotheby'?s(?: International Realty)?|Coldwell Banker|Keller Williams|RE\/MAX|Corcoran|The Agency|Christie'?s(?: International Real Estate)?|Berkshire Hathaway(?: HomeServices)?|Engel & V[oö]lkers)/i.exec(t);
  if (m) { draft.brokerage = m[1]; found.push('brokerage'); }
  if (draft.capAmount && draft.agentSplit != null) draft.planType = 'split_cap';
  else if (draft.agentSplit === 1) draft.planType = '100pct';
  return { draft, found };
}

function readUpload(url) {
  if (!url) return null;
  const rel = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/uploads\//, '');
  if (rel.includes('..')) return null;
  const file = path.join(config.uploadsDir, rel);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  if (data.length > 20 * 1024 * 1024) return null;
  if (ext === '.pdf') return { kind: 'pdf', data: data.toString('base64') };
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    const mt = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
    return { kind: 'image', mediaType: mt, data: data.toString('base64') };
  }
  if (['.txt', '.md', '.csv'].includes(ext)) return { kind: 'text', text: data.toString('utf8').slice(0, 60000) };
  return null;
}

function clean(draft) {
  const out = {};
  const frac = (v) => (v == null ? null : v > 1 ? v / 100 : v);
  for (const [k, v] of Object.entries(draft || {})) {
    if (v == null || v === '') continue;
    if (['agentSplit', 'postCapSplit', 'franchisePct', 'teamLeadPct', 'defaultBuyerRate', 'defaultListingRate'].includes(k)) out[k] = frac(Number(v));
    else if (['capAmount', 'transactionFee', 'postCapTransactionFee', 'franchiseCap'].includes(k)) out[k] = Math.round(Number(v));
    else if (k === 'capAnniversary') { if (/^\d{2}-\d{2}$/.test(v)) out[k] = v; }
    else if (k === 'tiers') { if (Array.isArray(v) && v.length) out.tiers = v.map((x) => ({ fromGci: Math.round(Number(x.fromGci) || 0), agentSplit: frac(Number(x.agentSplit)) })); }
    else out[k] = v;
  }
  return out;
}

async function parseIca({ workspaceId, text, url }) {
  const file = readUpload(url);
  const plainText = text || (file && file.kind === 'text' ? file.text : '');
  if (ai.available()) {
    try {
      const content = [];
      if (file && file.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
      if (file && file.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } });
      if (plainText) content.push({ type: 'text', text: `Agreement text:\n\n${plainText.slice(0, 60000)}` });
      if (content.length) {
        content.push({ type: 'text', text: 'Extract the pay plan from this agreement.' });
        const out = await ai.json({ system: SYSTEM, messages: [{ role: 'user', content }], schema: SCHEMA, effort: 'low', feature: 'ica_parse', workspaceId });
        if (out) {
          const { summary, ...rest } = out;
          const draft = clean(rest);
          return { draft, found: Object.keys(draft), source: 'ai', summary: summary || null };
        }
      }
    } catch (err) {
      console.warn('[pipeline] ICA parse via AI failed, falling back:', err.message);
    }
  }
  if (plainText) {
    const { draft, found } = heuristicParse(plainText);
    return { draft: clean(draft), found, source: 'heuristic', summary: found.length ? `Read ${found.length} term${found.length === 1 ? '' : 's'} from the text — check the rest by hand.` : null };
  }
  return { draft: {}, found: [], source: 'none', summary: null, needsText: true };
}

module.exports = { parseIca, heuristicParse };
